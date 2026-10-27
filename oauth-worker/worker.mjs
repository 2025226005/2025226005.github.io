// This runs on Cloudflare Workers, NEVER on GitHub Pages.
const COOKIE = '__Host-ssail_oauth';
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const cookie = value => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? 600 : 0}`;
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function fail(message, status = 400) {
  return new Response(message, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Set-Cookie': cookie('') } });
}
async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(payload, secret) {
  const body = b64(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return body + '.' + b64(signature);
}
async function verify(value, secret) {
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), unb64(parts[1]), encoder.encode(parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    if (!Number.isFinite(payload.expires) || payload.expires < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function configuration(env) {
  const base = new URL(env.PUBLIC_URL);
  if (base.protocol !== 'https:' || base.origin !== env.PUBLIC_URL) throw new Error('Invalid PUBLIC_URL');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) throw new Error('Invalid repository');
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || env.COOKIE_SECRET?.length < 32 || !env.COOKIE_SECRET) throw new Error('Missing secrets');
  const origins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  if (!origins.length || origins.some(o => new URL(o).protocol !== 'https:' || new URL(o).origin !== o)) throw new Error('Invalid allowed origins');
  return { base: base.origin, origins, callback: base.origin + '/callback' };
}
function successPage(token, origin) {
  const nonce = random();
  // Escape '<' even in trusted JSON so a token can never terminate this script.
  const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const payload = `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`;
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>SSAIL GitHub 로그인</title><body><p id="message">로그인이 완료되었습니다. 관리자 창으로 돌아가세요.</p><script nonce="${nonce}">
    const origin = ${literal(origin)};
    const parent = window.opener;
    if (parent) {
      function receive(event) {
        if (event.origin !== origin || event.source !== parent || event.data !== 'authorizing:github') return;
        window.removeEventListener('message', receive);
        parent.postMessage(${literal(payload)}, origin);
      }
      window.addEventListener('message', receive);
      parent.postMessage('authorizing:github', origin);
    } else {
      document.getElementById('message').textContent = '로그인 팝업을 연 관리자 창이 없습니다. /admin/에서 다시 로그인해 주세요.';
    }
  </script></body></html>`, { headers: {
    ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie(''),
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
  } });
}
export async function handleRequest(request, env, fetcher = fetch) {
  if (request.method !== 'GET') return fail('Method not allowed', 405);
  const url = new URL(request.url);
  if (!['/auth', '/callback'].includes(url.pathname)) return fail('SSAIL OAuth service. Use /admin/ on the website to sign in.', 404);
  let config;
  try { config = configuration(env); } catch { return fail('인증 서비스 설정이 완료되지 않았습니다. 배포 담당자에게 문의하세요.', 503); }
  if (url.origin !== config.base) return fail('Unexpected authentication host', 403);
  if (url.pathname === '/auth') {
    if (url.searchParams.get('provider') !== 'github') return fail('Unsupported provider');
    const origin = config.origins.find(o => new URL(o).host === url.searchParams.get('site_id'));
    if (!origin) return fail('허용되지 않은 홈페이지 주소입니다.', 403);
    const state = random();
    const verifier = random();
    const challenge = b64(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
    const session = await sign({ state, verifier, origin, expires: Date.now() + 600000 }, env.COOKIE_SECRET);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID, redirect_uri: config.callback,
      scope: 'public_repo', state, allow_signup: 'false', code_challenge: challenge, code_challenge_method: 'S256'
    });
    return new Response(null, { status: 302, headers: { ...headers, Location: authorize.href, 'Set-Cookie': cookie(session) } });
  }
  const stored = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const session = stored ? await verify(stored, env.COOKIE_SECRET) : null;
  if (!session || session.state !== url.searchParams.get('state') || !config.origins.includes(session.origin)) return fail('로그인 요청 확인에 실패했습니다. 관리자 페이지에서 다시 로그인해 주세요.');
  if (url.searchParams.has('error')) return fail('GitHub 로그인이 취소되었습니다. 관리자 페이지에서 다시 시도해 주세요.');
  const code = url.searchParams.get('code');
  if (!code) return fail('Missing authorization code');
  try {
    const response = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: config.callback, code_verifier: session.verifier }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return fail('GitHub 인증에 실패했습니다. 관리자 페이지에서 다시 시도해 주세요.', 502);
    const result = await response.json();
    if (typeof result.access_token !== 'string' || result.error || result.token_type?.toLowerCase() !== 'bearer') return fail('GitHub에서 유효한 인증을 받지 못했습니다. 다시 로그인해 주세요.', 401);
    // The public OAuth scope alone is not authorization: require push access to THIS repository.
    const repo = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
      headers: { Authorization: `Bearer ${result.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ssail-cms-auth', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000)
    });
    if (!repo.ok || !(await repo.json()).permissions?.push) return fail('이 홈페이지 저장소의 쓰기 권한이 있는 GitHub 계정만 관리할 수 있습니다.', 403);
    return successPage(result.access_token, session.origin);
  } catch { return fail('인증 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 로그인해 주세요.', 502); }
}
export default { fetch(request, env) { return handleRequest(request, env); } };
