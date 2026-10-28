import { COLLECTIONS, moveItem, orderViews } from './order-model.js';

export function installOrderingUI({ backend, window, document }) {
  const service = backend.ordering;
  const toolbar = document.createElement('aside');
  toolbar.className = 'ssail-order-toolbar';
  toolbar.hidden = true;
  const openButton = document.createElement('button');
  openButton.type = 'button'; openButton.textContent = '↕ Reorder';
  toolbar.append(openButton); document.body.append(toolbar);
  const dialog = document.createElement('dialog');
  dialog.className = 'ssail-order-dialog';
  dialog.setAttribute('aria-labelledby', 'ssail-order-title');
  dialog.innerHTML = `<div class="ssail-order-heading"><h2 id="ssail-order-title">Reorder website items</h2><button type="button" data-close aria-label="Close reorder dialog">×</button></div>
    <p>Drag items or use the arrow buttons. New items are automatically added first.</p>
    <label for="ssail-order-view">Items to reorder</label><select id="ssail-order-view"></select>
    <p data-status role="status" aria-live="polite"></p><ol class="ssail-order-list"></ol>
    <footer><button type="button" data-reset>Reset</button><button type="button" data-save>Save order</button></footer>`;
  document.body.append(dialog);
  const select = dialog.querySelector('select');
  const list = dialog.querySelector('ol');
  const status = dialog.querySelector('[data-status]');
  const saveButton = dialog.querySelector('[data-save]');
  const resetButton = dialog.querySelector('[data-reset]');
  let snapshot, views = [], view, ids = [], original = [], busy = false, dragging;
  const dirty = () => ids.some((id, i) => id !== original[i]);
  function setBusy(value) { busy = value; updateControls(); }
  function updateControls() {
    select.disabled = busy || dirty();
    saveButton.disabled = busy || !dirty();
    resetButton.disabled = busy || !dirty();
    dialog.querySelector('[data-close]').disabled = busy;
    for (const row of list.querySelectorAll('li')) row.draggable = !busy;
    for (const button of list.querySelectorAll('button')) button.disabled = busy || button.dataset.edge === 'true';
  }
  function move(id, to) {
    if (busy) return;
    ids = moveItem(ids, id, to);
    render();
    status.textContent = dirty() ? 'Order changed. Click Save order to publish it.' : '';
  }
  function render() {
    list.replaceChildren();
    const lookup = new Map((view?.items || []).map(item => [item.id, item]));
    ids.forEach((id, index) => {
      const item = lookup.get(id);
      const row = document.createElement('li');
      row.draggable = !busy; row.dataset.id = id;
      const handle = document.createElement('span'); handle.className = 'ssail-drag-handle'; handle.textContent = '⠿'; handle.setAttribute('aria-hidden', 'true');
      const title = document.createElement('div'); title.className = 'ssail-order-item-text';
      const strong = document.createElement('strong'); strong.textContent = item.title;
      const small = document.createElement('small'); small.textContent = item.subtitle || '';
      title.append(strong, small);
      const controls = document.createElement('div'); controls.className = 'ssail-order-moves';
      for (const [symbol, label, target] of [['⇈', 'first', 0], ['↑', 'up', index - 1], ['↓', 'down', index + 1], ['⇊', 'last', ids.length - 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
        button.setAttribute('aria-label', `Move ${item.title} ${label}`); button.title = `Move ${label}`;
        button.dataset.edge = String(target < 0 || target >= ids.length || target === index);
        button.addEventListener('click', () => move(id, target)); controls.append(button);
      }
      row.addEventListener('dragstart', event => { if (busy) return event.preventDefault(); dragging = id; event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', event => { if (!busy && dragging) event.preventDefault(); });
      row.addEventListener('drop', event => { event.preventDefault(); if (dragging) move(dragging, index); dragging = undefined; });
      row.addEventListener('dragend', () => { dragging = undefined; });
      row.append(handle, title, controls); list.append(row);
    });
    updateControls();
  }
  function choose(id) {
    view = views.find(v => v.id === id) || views[0];
    if (!view) { ids = original = []; render(); status.textContent = 'No items to reorder yet.'; return; }
    select.value = view.id;
    ids = view.items.map(i => i.id); original = [...ids];
    render();
    status.textContent = ids.length ? '' : 'No items in this group yet.';
  }
  async function load(kind, selected) {
    setBusy(true); status.textContent = 'Loading the current website order…';
    try {
      snapshot = await service.read(kind); views = orderViews(snapshot);
      select.replaceChildren(...views.map(v => { const option = document.createElement('option'); option.value = v.id; option.textContent = v.label; return option; }));
      choose(selected);
    } finally { setBusy(false); }
  }
  function kindFromRoute() {
    const match = window.location.hash.match(/^#\/collections\/([^/?]+)\/?(?:\?.*)?$/);
    return match && COLLECTIONS[match[1]] ? match[1] : null;
  }
  function refresh() {
    toolbar.hidden = !kindFromRoute() || !backend.api || !backend.token;
    if ((!backend.api || !backend.token) && dialog.open) dialog.close();
  }
  function close() {
    if (busy || dirty() && !window.confirm('Discard unsaved order changes?')) return;
    dialog.close(); openButton.focus();
  }
  openButton.addEventListener('click', async () => {
    const kind = kindFromRoute(); if (!kind || !backend.api) return;
    ids = original = []; view = undefined; list.replaceChildren();
    dialog.showModal();
    try { await load(kind); } catch (error) { status.textContent = error.message; }
  });
  select.addEventListener('change', () => choose(select.value));
  resetButton.addEventListener('click', () => { ids = [...original]; render(); status.textContent = ''; });
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  saveButton.addEventListener('click', async () => {
    if (busy || !dirty()) return;
    setBusy(true); status.textContent = 'Saving order…';
    const selected = view.id;
    try {
      await service.save(snapshot, selected, ids);
      original = [...ids];
      try { await load(snapshot.kind, selected); }
      catch (error) { status.textContent = `Order saved, but the list could not refresh: ${error.message}`; return; }
      status.textContent = 'Order saved. The website updates after GitHub deployment completes.';
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  });
  window.addEventListener('hashchange', refresh);
  return { refresh, destroy() { window.removeEventListener('hashchange', refresh); toolbar.remove(); dialog.remove(); } };
}
