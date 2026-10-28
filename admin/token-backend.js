// Keep Decap's GitHub file/media implementation; replace only OAuth sign-in.
import { COLLECTIONS } from './order-model.js';
import { createOrderingService } from './ordering.js';
export function tokenSetupUrl(repo) {
  const url = new URL('https://github.com/settings/personal-access-tokens/new');
  url.search = new URLSearchParams({ name: 'SSAIL Website Admin', target_name: repo.split('/')[0], expires_in: '90', contents: 'write' });
  return url.href;
}
export function clearSavedLogin(storage) {
  // Decap persists returned user metadata. Our backend never returns the token.
  // Discard that metadata on reload so a fresh, in-memory sign-in is required.
  for (const name of ['decap-cms-user', 'netlify-cms-user']) storage.removeItem(name);
}
export function registerTokenBackend(CMS, { h, createClass }, repo, hooks = {}) {
  const github = CMS.getBackend('github');
  if (!github?.init || typeof h !== 'function' || typeof createClass !== 'function') throw new Error('Could not load the GitHub editor. Check the CMS version and reload.');
  const Login = createClass({
    displayName: 'SSAILTokenLogin',
    getInitialState() { return { token: '', message: '' }; },
    submit(event) {
      event.preventDefault();
      if (this.props.inProgress) return;
      const token = this.state.token.trim();
      if (!/^github_pat_[a-zA-Z0-9_]+$/.test(token)) {
        this.setState({ message: 'Enter a fine-grained personal access token issued by GitHub.' });
        return;
      }
      this.setState({ token: '', message: '' });
      this.props.onLogin({ token });
    },
    render() {
      return h('main', { className: 'ssail-login' },
        h('div', { className: 'ssail-login-brand' }, 'SSAIL ADMIN'),
        h('h1', null, 'Website administration'),
        h('p', null, 'Enter the GitHub access token for this website repository.'),
        h('form', { onSubmit: this.submit, autoComplete: 'off' },
          h('label', { htmlFor: 'ssail-token' }, 'GitHub access token'),
          h('input', { id: 'ssail-token', type: 'password', name: 'ssail-token', value: this.state.token,
            onChange: event => this.setState({ token: event.target.value }), autoComplete: 'off', autoCapitalize: 'none', spellCheck: false,
            required: true, placeholder: 'github_pat_…', disabled: this.props.inProgress, 'aria-describedby': 'ssail-token-help' }),
          h('p', { id: 'ssail-token-help', className: 'ssail-login-help' }, 'The token stays in memory for this window only. Enter it again after reloading or closing the page.'),
          h('button', { type: 'submit', disabled: this.props.inProgress }, this.props.inProgress ? 'Connecting…' : 'Open editor'),
          (this.state.message || this.props.error) && h('p', { role: 'alert', className: 'ssail-login-error' }, this.state.message || 'Could not sign in. Check the token’s expiration, selected repository and Contents write permission.')
        ),
        h('details', null, h('summary', null, 'First visit? Create an access token'),
          h('ol', null,
            h('li', null, h('a', { href: tokenSetupUrl(repo), target: '_blank', rel: 'noopener noreferrer' }, 'Create a token on GitHub')),
            h('li', null, 'Under Repository access, choose Only select repositories, then select ', repo.split('/')[1], '.'),
            h('li', null, 'Set Contents to Read and write under Repository permissions, then click Generate token.'),
            h('li', null, 'Copy the generated token and paste it above.')
          )
        ),
        h('p', null, h('a', { href: './guide.html', target: '_blank', rel: 'noopener noreferrer' }, 'Editor guide'), ' · ', h('a', { href: '../index.html' }, 'Back to website'))
      );
    }
  });
  CMS.registerBackend('github-token', class {
    constructor(config, options) {
      // Delegate the full content/media lifecycle to the pinned GitHub backend.
      const backend = github.init(config, options);
      const authenticate = backend.authenticate.bind(backend);
      const logout = backend.logout.bind(backend);
      const persistEntry = backend.persistEntry.bind(backend);
      backend.ordering = createOrderingService(() => backend.api, config.backend?.branch || 'main');
      backend.persistEntry = (entry, options) => options?.newEntry && COLLECTIONS[options.collectionName]?.folder
        ? backend.ordering.persistNew(entry, options) : persistEntry(entry, options);
      for (const method of ['entriesByFolder', 'allEntriesByFolder']) {
        if (!backend[method]) continue;
        const original = backend[method].bind(backend);
        backend[method] = (folder, ...args) => {
          const kind = Object.keys(COLLECTIONS).find(key => COLLECTIONS[key].folder === folder);
          return kind ? backend.ordering.entries(kind) : original(folder, ...args);
        };
      }
      const reset = async () => {
        try { await logout(); } finally {
          if (backend.api) backend.api.token = '';
          backend.api = null;
          backend.token = null;
          backend._currentUserPromise = undefined;
          backend._userIsOriginMaintainerPromises = undefined;
          backend.ordering.clear();
          hooks.onSessionChanged?.();
        }
      };
      backend.authComponent = () => Login;
      backend.authenticate = async credentials => {
        const token = credentials?.token?.trim();
        if (typeof token !== 'string' || !/^github_pat_[a-zA-Z0-9_]+$/.test(token)) throw new Error('Enter a fine-grained GitHub access token.');
        // An unsuccessful earlier login must not cache the previous account.
        backend._currentUserPromise = undefined;
        backend._userIsOriginMaintainerPromises = undefined;
        try {
          const user = await authenticate({ token });
          if (!user?.login) throw new Error('Invalid GitHub user');
          hooks.onSessionChanged?.();
          // Decap stores this object in localStorage: deliberately omit token.
          return { login: user.login, name: user.name || user.login, email: user.email, avatar_url: user.avatar_url, useOpenAuthoring: false };
        } catch {
          await reset();
          throw new Error('Could not sign in. Check the token’s expiration, selected website repository and Contents write permission.');
        }
      };
      backend.restoreUser = async () => { throw new Error('Enter your access token again.'); };
      backend.logout = reset;
      hooks.onBackend?.(backend);
      return backend;
    }
  });
}
