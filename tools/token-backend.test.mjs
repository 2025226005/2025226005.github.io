import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSavedLogin, registerTokenBackend, tokenSetupUrl } from '../admin/token-backend.js';
const token = 'github_pat_TEST_ONLY_NOT_A_REAL_TOKEN';
function fixture() {
  let registered;
  let authPage;
  const calls = [];
  const base = {
    api: null, token: null,
    async authenticate(credentials) {
      this.token = credentials.token;
      this.api = { token: credentials.token };
      if (credentials.token.includes('DENIED')) throw new Error('upstream sensitive response');
      return { login: 'test-owner', name: 'Test Owner', email: 'test@example.com', token: credentials.token };
    },
    logout() { this.token = null; },
    persistEntry(...args) { calls.push(['entry', ...args]); },
    persistMedia(...args) { calls.push(['media', ...args]); },
    getToken() { return this.token; }
  };
  const CMS = {
    getBackend(name) { assert.equal(name, 'github'); return { init: () => base }; },
    registerBackend(name, Class) { assert.equal(name, 'github-token'); registered = Class; }
  };
  const ui = {
    h: (type, props, ...children) => ({ type, props, children }),
    createClass: spec => { authPage = spec; return spec; }
  };
  registerTokenBackend(CMS, ui, '2025226005/2025226005.github.io');
  return { backend: new registered({}, {}), calls, get page() { return authPage; } };
}
test('token link requests only Contents permission with configured owner', () => {
  const url = new URL(tokenSetupUrl('2025226005/2025226005.github.io'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('target_name'), '2025226005');
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.equal(url.searchParams.get('expires_in'), '90');
  assert.equal(url.searchParams.has('workflows'), false);
});
test('sign-in reuses GitHub entry/media writes and omits token from stored user', async () => {
  const { backend, calls } = fixture();
  const user = await backend.authenticate({ token });
  assert.equal(user.login, 'test-owner');
  assert.equal(user.token, undefined);
  assert.ok(!JSON.stringify(user).includes(token));
  assert.equal(backend.getToken(), token);
  backend.persistEntry({ dataFiles: [{ path: 'content/news/new.json' }], assets: [] }, { newEntry: true });
  backend.persistMedia({ path: 'uploads/cms/new.jpg' }, {});
  assert.equal(calls[0][0], 'entry');
  assert.equal(calls[1][0], 'media');
  const api = backend.api;
  await backend.logout();
  assert.equal(backend.getToken(), null);
  assert.equal(api.token, '');
  assert.equal(backend.api, null);
});
test('invalid/denied tokens cannot restore a session and failures clear credentials', async () => {
  const { backend } = fixture();
  await assert.rejects(backend.authenticate({ token: 'not-a-fine-grained-token' }), /fine-grained/i);
  await assert.rejects(backend.authenticate({ token: 'github_pat_DENIED' }), error => !error.message.includes('upstream') && !error.message.includes('github_pat_'));
  assert.equal(backend.api, null);
  assert.equal(backend.token, null);
  await assert.rejects(backend.restoreUser({ login: 'test-owner' }), /again/);
});
test('login form masks and clears token before submitting without browser storage', () => {
  const { page } = fixture();
  let submitted;
  const component = {
    state: { token: '  ' + token + '  ', message: '' },
    props: { onLogin: credentials => { submitted = credentials; } },
    setState(value) { Object.assign(this.state, value); },
    submit() {}
  };
  const tree = page.render.call(component);
  const find = (node, type) => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === type) return node;
    return node.children?.map(child => find(child, type)).find(Boolean);
  };
  assert.equal(find(tree, 'input').props.type, 'password');
  assert.equal(find(tree, 'form').props.autoComplete, 'off');
  let prevented = false;
  page.submit.call(component, { preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(submitted.token, token);
  assert.equal(component.state.token, '');
});
test('reload removes only Decap saved login metadata', () => {
  const values = new Map([['decap-cms-user', 'old-login'], ['netlify-cms-user','old-login'], ['unrelated', 'keep']]);
  clearSavedLogin({ removeItem: key => values.delete(key) });
  assert.deepEqual([...values], [['unrelated', 'keep']]);
});
