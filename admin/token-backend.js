// Keep Decap's GitHub file/media implementation; replace only OAuth sign-in.
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
export function registerTokenBackend(CMS, { h, createClass }, repo) {
  const github = CMS.getBackend('github');
  if (!github?.init || typeof h !== 'function' || typeof createClass !== 'function') throw new Error('관리 화면 버전을 확인해 주세요. GitHub 편집 모듈을 불러오지 못했습니다.');
  const Login = createClass({
    displayName: 'SSAILTokenLogin',
    getInitialState() { return { token: '', message: '' }; },
    submit(event) {
      event.preventDefault();
      if (this.props.inProgress) return;
      const token = this.state.token.trim();
      if (!/^github_pat_[a-zA-Z0-9_]+$/.test(token)) {
        this.setState({ message: 'GitHub에서 발급한 Fine-grained token을 입력해 주세요.' });
        return;
      }
      this.setState({ token: '', message: '' });
      this.props.onLogin({ token });
    },
    render() {
      return h('main', { className: 'ssail-login' },
        h('div', { className: 'ssail-login-brand' }, 'SSAIL ADMIN'),
        h('h1', null, '홈페이지 관리'),
        h('p', null, '홈페이지 저장소용 GitHub 접근 키를 입력해 주세요.'),
        h('form', { onSubmit: this.submit, autoComplete: 'off' },
          h('label', { htmlFor: 'ssail-token' }, 'GitHub 관리 키'),
          h('input', { id: 'ssail-token', type: 'password', name: 'ssail-token', value: this.state.token,
            onChange: event => this.setState({ token: event.target.value }), autoComplete: 'off', autoCapitalize: 'none', spellCheck: false,
            required: true, placeholder: 'github_pat_…', disabled: this.props.inProgress, 'aria-describedby': 'ssail-token-help' }),
          h('p', { id: 'ssail-token-help', className: 'ssail-login-help' }, '키는 이 창을 사용하는 동안만 유지합니다. 새로고침하거나 창을 닫으면 다시 입력합니다.'),
          h('button', { type: 'submit', disabled: this.props.inProgress }, this.props.inProgress ? '연결 확인 중…' : '관리 화면 열기'),
          (this.state.message || this.props.error) && h('p', { role: 'alert', className: 'ssail-login-error' }, this.state.message || '키를 확인하지 못했습니다. 만료 여부, 선택한 저장소, Contents 쓰기 권한을 확인해 주세요.')
        ),
        h('details', null, h('summary', null, '처음 이용하시나요? 키 발급 방법'),
          h('ol', null,
            h('li', null, h('a', { href: tokenSetupUrl(repo), target: '_blank', rel: 'noopener noreferrer' }, 'GitHub에서 관리 키 만들기')),
            h('li', null, 'Repository access에서 Only select repositories를 선택하고 ', repo.split('/')[1], '을 선택합니다.'),
            h('li', null, 'Repository permissions의 Contents를 Read and write로 설정하고 Generate token을 누릅니다.'),
            h('li', null, '발급된 키를 복사해 위 입력란에 붙여 넣습니다.')
          )
        ),
        h('p', null, h('a', { href: './guide.html', target: '_blank', rel: 'noopener noreferrer' }, '설정 및 사용 안내'), ' · ', h('a', { href: '../index.html' }, '홈페이지로 돌아가기'))
      );
    }
  });
  CMS.registerBackend('github-token', class {
    constructor(config, options) {
      // Delegate the full content/media lifecycle to the pinned GitHub backend.
      const backend = github.init(config, options);
      const authenticate = backend.authenticate.bind(backend);
      const logout = backend.logout.bind(backend);
      const reset = async () => {
        try { await logout(); } finally {
          if (backend.api) backend.api.token = '';
          backend.api = null;
          backend.token = null;
          backend._currentUserPromise = undefined;
          backend._userIsOriginMaintainerPromises = undefined;
        }
      };
      backend.authComponent = () => Login;
      backend.authenticate = async credentials => {
        const token = credentials?.token?.trim();
        if (typeof token !== 'string' || !/^github_pat_[a-zA-Z0-9_]+$/.test(token)) throw new Error('Fine-grained GitHub 관리 키를 입력해 주세요.');
        // An unsuccessful earlier login must not cache the previous account.
        backend._currentUserPromise = undefined;
        backend._userIsOriginMaintainerPromises = undefined;
        try {
          const user = await authenticate({ token });
          if (!user?.login) throw new Error('Invalid GitHub user');
          // Decap stores this object in localStorage: deliberately omit token.
          return { login: user.login, name: user.name || user.login, email: user.email, avatar_url: user.avatar_url, useOpenAuthoring: false };
        } catch {
          await reset();
          throw new Error('관리 키로 연결할 수 없습니다. 키의 만료 여부, 홈페이지 저장소 선택과 Contents 쓰기 권한을 확인해 주세요.');
        }
      };
      backend.restoreUser = async () => { throw new Error('관리 키를 다시 입력해 주세요.'); };
      backend.logout = reset;
      return backend;
    }
  });
}
