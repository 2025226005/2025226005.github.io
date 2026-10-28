export const ORDER_FILE = 'content/order.json';
export const COLLECTIONS = {
  undergraduates: { folder: 'content/undergraduates', label: 'Undergraduate researchers' },
  current: { file: 'content/current.json', label: 'Current members' },
  alumni: { folder: 'content/alumni', label: 'Alumni' },
  publications: { folder: 'content/publications', label: 'Publications & presentations' },
  news: { folder: 'content/news', label: 'Lab news' }
};
export const CATEGORY_LABELS = { journal: 'Journal publications', conference: 'Conference publications & abstracts', poster: 'Posters' };
export function collectionForPath(path) {
  return Object.keys(COLLECTIONS).find(key => COLLECTIONS[key].file === path ||
    COLLECTIONS[key].folder && new RegExp('^' + COLLECTIONS[key].folder + '/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\\.json$').test(path));
}
export function validateOrder(value) {
  if (!value || value.version !== 1 || !value.lists || typeof value.lists !== 'object' || Array.isArray(value.lists)) throw new Error('Invalid website order file.');
  for (const [kind, paths] of Object.entries(value.lists)) {
    if (!COLLECTIONS[kind]?.folder || !Array.isArray(paths) || new Set(paths).size !== paths.length || paths.some(p => typeof p !== 'string' || collectionForPath(p) !== kind)) throw new Error('Invalid order list: ' + kind);
  }
  return value;
}
export const emptyOrder = () => ({ version: 1, lists: {} });
export function legacyCompare(a, b, kind) {
  return (kind === 'undergraduates' ? b.year - a.year : (a.order ?? 0) - (b.order ?? 0)) || a.path.localeCompare(b.path);
}
export function orderedRecords(records, paths, kind) {
  const sorted = [...records].sort((a, b) => legacyCompare(a, b, kind));
  if (!paths) return sorted;
  const ranks = new Map(paths.map((p, i) => [p, i]));
  // Entries added by an older editor are not lost: unlisted items go first.
  return sorted.sort((a, b) => (ranks.get(a.path) ?? -1) - (ranks.get(b.path) ?? -1));
}
export function assertPermutation(before, after) {
  if (!Array.isArray(after) || before.length !== after.length || new Set(after).size !== after.length || after.some(id => !before.includes(id))) throw new Error('The item list changed. Reload it before saving the order.');
}
export function moveItem(ids, id, target) {
  const next = [...ids];
  const from = next.indexOf(id);
  if (from < 0 || target < 0 || target >= next.length) return next;
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}
export function orderViews(snapshot) {
  const { kind, records } = snapshot;
  const entries = list => list.map(r => ({ id: r.path, title: String(r.title || r.year), subtitle: r.date_label || (r.year ? String(r.year) : '') }));
  if (kind === 'publications') return Object.entries(CATEGORY_LABELS).map(([category, label]) => ({ id: 'entries:' + category, label, items: entries(records.filter(r => r.category === category)) }));
  const views = kind === 'current' ? [] : [{ id: 'entries', label: kind === 'undergraduates' ? 'Year tabs' : kind === 'alumni' ? 'School groups' : 'News articles', items: entries(records) }];
  if (['current', 'undergraduates', 'alumni'].includes(kind)) {
    for (const record of records) views.push({ id: 'members:' + record.path, label: kind === 'current' ? 'Members' : 'Members — ' + (record.year || record.title),
      items: (record.members || []).map((m, i) => ({ id: 'member-' + i, title: m.name, subtitle: m.role || '' })) });
  }
  return views;
}
