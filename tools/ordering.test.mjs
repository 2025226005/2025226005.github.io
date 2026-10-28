import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseHTML } from 'linkedom';
import { createOrderingService } from '../admin/ordering.js';
import { ORDER_FILE, orderViews, validateOrder, orderedRecords } from '../admin/order-model.js';
import { installOrderingUI } from '../admin/reorder-ui.js';
import { createConfig } from '../admin/collections.js';
import { registerTokenBackend } from '../admin/token-backend.js';

// Git object semantics: uploads/commits are inert until a non-force ref update.
function repository(input = {}) {
  const files = new Map(Object.entries(input).map(([p,v]) => [p, JSON.stringify(v)]));
  const blobs = new Map(); const commits = new Map(); const writes = [];
  let head = 'initial', race, denied;
  const sha = raw => crypto.createHash('sha1').update(raw).digest('hex');
  const api = {
    repoURL: '/repos/test/site',
    async getDefaultBranch() { return { commit: { sha: head } }; },
    async request(path, options) {
      assert.equal(path, `${this.repoURL}/git/trees/${head}`);
      assert.equal(options.params.recursive, 1);
      return { tree: [...files].map(([path, raw]) => { const id = sha(raw); blobs.set(id, raw); return { type: 'blob', path, sha: id }; }) };
    },
    async readFile(path, id) { if (!blobs.has(id)) throw new Error('Read failed'); return blobs.get(id); },
    async uploadBlob(file) {
      if (denied) throw Object.assign(new Error('Permission denied'), { status: 403 });
      const raw = file.toBase64 ? await file.toBase64() : file.raw;
      file.sha = sha(raw); blobs.set(file.sha, raw); writes.push(file.path); return file;
    },
    async updateTree(parentSha, items, branch, subfolders) { assert.equal(branch, 'main'); assert.equal(subfolders, false); return { parentSha, items }; },
    async commit(message, tree) { const id = 'commit-' + commits.size; commits.set(id, tree); return { sha: id }; },
    async patchBranch(branch, id, options) {
      assert.equal(options.force, false);
      if (race) { head = 'other-editor'; throw Object.assign(new Error('Not fast forward'), { status: race }); }
      const tree = commits.get(id); assert.equal(tree.parentSha, head);
      tree.items.forEach(file => files.set(file.path, blobs.get(file.sha))); head = id;
    }
  };
  return { api, files, writes, service: createOrderingService(() => api, 'main'),
    json: p => JSON.parse(files.get(p)), advance() { head = 'external-change'; },
    race(status) { race = status; }, deny() { denied = true; } };
}
const newsPath = id => `content/news/${id}.json`;
const publicationPath = id => `content/publications/${id}.json`;
const article = (title, order = 1) => ({ title, order, date_label: '2026', body: 'The complete article.\nFull second paragraph.', summary: 'Home introduction' });

test('successive new articles are first, even with an existing manual order; assets are atomic', async () => {
  const old = newsPath('old'), recent = newsPath('recent');
  const r = repository({ [old]: article('Old', 1), [recent]: article('Recent', 0), [ORDER_FILE]: { version: 1, lists: { news: [old, recent] } } });
  const original = new Map(r.files);
  for (const title of ['First', 'Second']) {
    await r.service.persistNew({ dataFiles: [{ path: newsPath(title), raw: JSON.stringify(article(title)) }],
      assets: [{ path: `uploads/cms/${title}.jpg`, toBase64: async () => 'binary-data' }] }, { collectionName: 'news', newEntry: true });
  }
  const snapshot = await r.service.read('news');
  assert.deepEqual(snapshot.records.map(x => x.title), ['Second', 'First', 'Old', 'Recent']);
  assert.equal(r.files.get(old), original.get(old)); assert.equal(r.files.get(recent), original.get(recent));
  assert.equal(r.json(newsPath('Second')).body, article('Second').body);
  assert.equal(r.files.get('uploads/cms/Second.jpg'), 'binary-data');
  assert.ok(r.json(newsPath('Second')).order < 0);
  assert.deepEqual((await r.service.entries('news')).map(x => JSON.parse(x.data).order), [0,1,2,3]);
});

test('publications reorder within their category without changing citations or other categories', async () => {
  const records = Object.fromEntries(['a','b','c','d'].map((id,i) => [publicationPath(id), { title: id, category: i % 2 ? 'journal' : 'conference', year: 2026, order: i, citation: `Full **${id}** citation [Paper](https://example.com/${id})` }]));
  const r = repository(records); const before = new Map(r.files);
  const snapshot = await r.service.read('publications');
  await r.service.save(snapshot, 'entries:conference', [publicationPath('c'), publicationPath('a')]);
  assert.deepEqual((await r.service.read('publications')).records.map(x => x.title), ['c','b','a','d']);
  for (const [path, raw] of before) assert.equal(r.files.get(path), raw);
  assert.deepEqual(r.writes, [ORDER_FILE]);
  await r.service.persistNew({ dataFiles: [{ path: publicationPath('new'), raw: JSON.stringify({ title: 'New', year: 2027, category: 'journal', citation: 'Complete citation' }) }], assets: [] }, { collectionName: 'publications', newEntry: true });
  const views = orderViews(await r.service.read('publications'));
  assert.deepEqual(views.find(v => v.id === 'entries:journal').items.map(x => x.title), ['New','b','d']);
  assert.deepEqual(views.find(v => v.id === 'entries:conference').items.map(x => x.title), ['c','a']);
});

test('year tabs, alumni groups and every member list can be reordered without dropping data', async () => {
  const members = [{ name: 'A', role: 'Student', details: 'Full education\nEmail: a@example.com', photo: '/uploads/a.jpg', photo_alt: 'Portrait' }, { name: 'B', role: 'Student', details: 'Other details', photo: '/uploads/b.jpg' }];
  const r = repository({ 'content/undergraduates/2026.json': { year: 2026, members }, 'content/undergraduates/2025.json': { year: 2025, members: [] },
    'content/alumni/one.json': { title: 'School One', order: 1, members }, 'content/alumni/two.json': { title: 'School Two', order: 2, members: [] }, 'content/current.json': { members, extra: 'preserved' } });
  for (const kind of ['undergraduates','alumni','current']) {
    let snapshot = await r.service.read(kind);
    const view = orderViews(snapshot).find(v => v.id.startsWith('members:') && v.items.length);
    const path = view.id.slice(8); const before = r.json(path);
    await r.service.save(snapshot, view.id, ['member-1','member-0']);
    assert.deepEqual(r.json(path), { ...before, members: [...before.members].reverse() });
    if (kind !== 'current') {
      snapshot = await r.service.read(kind);
      await r.service.save(snapshot, 'entries', snapshot.records.map(x => x.path).reverse());
      assert.deepEqual((await r.service.read(kind)).records.map(x => x.path), snapshot.records.map(x => x.path).reverse());
    }
  }
});

test('stale snapshots, invalid permutations, concurrent saves and denied writes cannot overwrite content', async () => {
  for (const mode of ['stale', 409, 422, 'denied', 'invalid']) {
    const r = repository({ [newsPath('a')]: article('A'), [newsPath('b')]: article('B', 2) });
    const before = new Map(r.files); const snapshot = await r.service.read('news');
    if (mode === 'stale') r.advance(); else if (typeof mode === 'number') r.race(mode); else if (mode === 'denied') r.deny();
    await assert.rejects(r.service.save(snapshot, 'entries', mode === 'invalid' ? [newsPath('a'),newsPath('a')] : [newsPath('b'),newsPath('a')]));
    assert.deepEqual(r.files, before);
    if (['stale','invalid'].includes(mode)) assert.equal(r.writes.length, 0);
  }
});

test('new-entry failure leaves no article or image; normal edits reuse the original backend', async () => {
  const r = repository({ [newsPath('a')]: article('A') });
  const original = new Map(r.files); r.race(422);
  await assert.rejects(r.service.persistNew({ dataFiles: [{ path: newsPath('b'), raw: JSON.stringify(article('B')) }], assets: [{ path: 'uploads/cms/new.jpg', raw: 'image' }] }, { collectionName: 'news' }), /Nothing was overwritten/);
  assert.deepEqual(r.files, original);
  let Class, ordinaryEdits = 0;
  const base = { api: r.api, authenticate() {}, logout() {}, persistEntry() { ordinaryEdits++; } };
  registerTokenBackend({ getBackend: () => ({ init: () => base }), registerBackend: (_, c) => { Class = c; } }, { h() {}, createClass: x => x }, 'test/site');
  const backend = new Class({ backend: { branch: 'main' } }, {});
  await backend.persistEntry({ dataFiles: [] }, { newEntry: false, collectionName: 'news' });
  assert.equal(ordinaryEdits, 1);
});

test('old sites need no index; unlisted entries go first and invalid indexes fail closed', () => {
  const records = [{ path: newsPath('a'), order: 1 }, { path: newsPath('b'), order: 2 }, { path: newsPath('new'), order: -123 }];
  assert.deepEqual(orderedRecords(records, undefined, 'news').map(x => x.path), [newsPath('new'),newsPath('a'),newsPath('b')]);
  assert.deepEqual(orderedRecords(records, [newsPath('b'),newsPath('a')], 'news').map(x => x.path), [newsPath('new'),newsPath('b'),newsPath('a')]);
  for (const lists of [{ news: [newsPath('a'),newsPath('a')] }, { news: ['content/current.json'] }, { current: [] }]) assert.throws(() => validateOrder({ version: 1, lists }));
});

test('admin defaults to English, hides numeric ordering and supports new-first draggable members', () => {
  const config = createConfig({ repo: 'test/site', branch: 'main' });
  assert.equal(config.locale, 'en');
  assert.doesNotMatch(JSON.stringify(config), /[가-힣]/);
  const inspect = fields => fields.forEach(field => {
    if (field.name === 'order') assert.equal(field.widget, 'hidden');
    if (field.name === 'members') { assert.equal(field.add_to_top, true); assert.equal(field.allow_reorder, true); }
    if (field.fields) inspect(field.fields);
  });
  for (const c of config.collections) { inspect(c.fields || []); for (const f of c.files || []) inspect(f.fields); }
});

test('list dialog supports arrow and drag ordering, save/reset, route visibility and sign-out', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const prototype = Object.getPrototypeOf(document.createElement('dialog'));
  prototype.showModal = function() { this.open = true; };
  prototype.close = function() { this.open = false; };
  // Linkedom does not implement native select.value setters.
  Object.defineProperty(Object.getPrototypeOf(document.createElement('select')), 'value', { configurable: true, get() { return this._value; }, set(value) { this._value = value; } });
  window.location = { hash: '#/collections/news' }; window.confirm = () => false;
  const r = repository({ [newsPath('a')]: article('<A>'), [newsPath('b')]: article('B',2), [newsPath('c')]: article('C',3) });
  const backend = { api: r.api, token: 'TEST', ordering: r.service };
  const ui = installOrderingUI({ backend, document, window }); ui.refresh();
  const toolbar = document.querySelector('aside'); const dialog = document.querySelector('dialog');
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const titles = () => [...dialog.querySelectorAll('strong')].map(x => x.textContent);
  assert.equal(toolbar.hidden, false);
  toolbar.querySelector('button').click(); await settle();
  assert.deepEqual(titles(), ['<A>','B','C']); assert.equal(dialog.querySelector('strong').children.length, 0);
  assert.equal(dialog.querySelector('li').draggable, true);
  dialog.querySelectorAll('li')[2].querySelector('button').click();
  assert.deepEqual(titles(), ['C','<A>','B']);
  dialog.querySelector('[data-close]').click(); assert.equal(dialog.open, true);
  dialog.querySelector('[data-reset]').click(); assert.deepEqual(titles(), ['<A>','B','C']);
  const rows = dialog.querySelectorAll('li');
  const start = new window.Event('dragstart'); start.dataTransfer = { setData() {} }; rows[2].dispatchEvent(start);
  rows[0].dispatchEvent(new window.Event('drop'));
  assert.deepEqual(titles(), ['C','<A>','B']);
  dialog.querySelector('[data-save]').click(); await settle();
  assert.deepEqual((await r.service.read('news')).records.map(x => x.title), ['C','<A>','B']);
  assert.match(dialog.querySelector('[data-status]').textContent, /Order saved/);
  assert.equal(dialog.querySelector('[data-save]').disabled, true);
  window.location.hash = '#/collections/news/new'; ui.refresh(); assert.equal(toolbar.hidden, true);
  backend.token = null; ui.refresh(); assert.equal(dialog.open, false);
  ui.destroy(); assert.equal(document.querySelector('dialog'), null);
});
