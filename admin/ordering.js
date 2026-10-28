import { COLLECTIONS, ORDER_FILE, assertPermutation, collectionForPath, emptyOrder, orderViews, orderedRecords, validateOrder } from './order-model.js';

// Uses the same authenticated Decap GitHub API. No additional account or token store.
export function createOrderingService(getApi, branch) {
  let queue = Promise.resolve();
  const cache = new Map();
  const serial = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  function api() { const value = getApi(); if (!value) throw new Error('Sign in before changing the website order.'); return value; }
  async function readBlob(client, file) {
    if (!cache.has(file.sha)) cache.set(file.sha, Promise.resolve(client.readFile(file.path, file.sha, { repoURL: client.repoURL })).then(JSON.parse).catch(error => { cache.delete(file.sha); throw error; }));
    return structuredClone(await cache.get(file.sha));
  }
  async function read(kind) {
    const definition = COLLECTIONS[kind];
    if (!definition) throw new Error('Unknown collection.');
    const client = api();
    const head = (await client.getDefaultBranch()).commit.sha;
    const tree = await client.request(`${client.repoURL}/git/trees/${head}`, { params: { recursive: 1 } });
    if (tree.truncated) throw new Error('The repository tree is incomplete. The order was not changed.');
    const files = tree.tree.filter(file => file.type === 'blob');
    const orderFile = files.find(f => f.path === ORDER_FILE);
    const index = orderFile ? validateOrder(await readBlob(client, orderFile)) : emptyOrder();
    const targets = files.filter(f => collectionForPath(f.path) === kind);
    const records = [];
    // Keep API concurrency bounded even for large publication collections.
    for (let i = 0; i < targets.length; i += 10) records.push(...await Promise.all(targets.slice(i, i + 10).map(async file => ({ ...await readBlob(client, file), path: file.path, sha: file.sha }))));
    return { kind, head, index, records: orderedRecords(records, index.lists[kind], kind) };
  }
  async function commit(snapshot, files, message) {
    const client = api();
    if ((await client.getDefaultBranch()).commit.sha !== snapshot.head) throw new Error('Someone changed the repository. Reload this list and try again; your changes have not been saved.');
    const uploaded = await Promise.all(files.map(file => client.uploadBlob(file)));
    const tree = await client.updateTree(snapshot.head, uploaded, branch, false);
    const saved = await client.commit(message, tree);
    try { await client.patchBranch(branch, saved.sha, { force: false }); }
    catch (error) {
      if ([409, 422].includes(error.status)) throw new Error('The repository changed while saving. Reload the list and try again. Nothing was overwritten.');
      throw error;
    }
    return saved;
  }
  const rawRecord = record => { const { path, sha, ...data } = record; return JSON.stringify(data, null, 2) + '\n'; };
  function save(snapshot, viewId, ids) {
    return serial(async () => {
      const view = orderViews(snapshot).find(v => v.id === viewId);
      if (!view) throw new Error('Unknown order view.');
      assertPermutation(view.items.map(i => i.id), ids);
      let files;
      if (viewId.startsWith('members:')) {
        const record = snapshot.records.find(r => r.path === viewId.slice('members:'.length));
        const members = ids.map(id => record.members[Number(id.slice('member-'.length))]);
        files = [{ path: record.path, raw: rawRecord({ ...record, members }) }];
      } else {
        const index = structuredClone(snapshot.index);
        const subset = new Set(ids);
        let n = 0;
        index.lists[snapshot.kind] = snapshot.records.map(r => subset.has(r.path) ? ids[n++] : r.path);
        files = [{ path: ORDER_FILE, raw: JSON.stringify(validateOrder(index), null, 2) + '\n' }];
      }
      return commit(snapshot, files, `Reorder ${COLLECTIONS[snapshot.kind].label}`);
    });
  }
  function persistNew(entry, options) {
    return serial(async () => {
      const kind = options.collectionName;
      const snapshot = await read(kind);
      const paths = entry.dataFiles.map(file => file.path);
      if (!paths.length || paths.some(path => collectionForPath(path) !== kind || snapshot.records.some(r => r.path === path))) throw new Error('This entry already exists or its path is invalid. Reload the collection before publishing.');
      const index = structuredClone(snapshot.index);
      index.lists[kind] = [...paths, ...snapshot.records.map(r => r.path)];
      for (const file of entry.dataFiles) {
        const data = JSON.parse(file.raw);
        // Also place the just-published entry first in Decap's cached list.
        data.order = -Date.now();
        file.raw = JSON.stringify(data, null, 2) + '\n';
      }
      for (const asset of entry.assets || []) if (!asset.path?.replace(/^\//, '').startsWith('uploads/')) throw new Error('Images must be saved inside uploads/.');
      const files = [...entry.dataFiles, ...(entry.assets || []), { path: ORDER_FILE, raw: JSON.stringify(validateOrder(index), null, 2) + '\n' }];
      return commit(snapshot, files, options.commitMessage || `Create ${COLLECTIONS[kind].label} entry`);
    });
  }
  async function entries(kind) {
    const snapshot = await read(kind);
    return snapshot.records.map((record, rank) => ({ file: { path: record.path, id: record.sha }, data: rawRecord({ ...record, order: rank }) }));
  }
  return { read, save, persistNew, entries, clear() { cache.clear(); } };
}
