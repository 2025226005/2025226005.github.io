import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker, { handleRequest } from './worker.mjs';
const env = {
  PUBLIC_URL: 'https://auth.example.com', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-only-not-a-real-secret',
  COOKIE_SECRET: 'test-only-signing-secret-at-least-32-characters', GITHUB_REPO: '2025226005/2025226005.github.io',
  ALLOWED_ORIGINS: 'https://ssail.korea.ac.kr,https://2025226005.github.io'
};
const request = (url, cookie) => new Request(env.PUBLIC_URL + url, cookie ? { headers: { Cookie: cookie } } : undefined);
async function begin() {
  const response = await handleRequest(request('/auth?provider=github&site_id=ssail.korea.ac.kr&scope=repo'), env);
  assert.equal(response.status, 302);
  return { response, redirect: new URL(response.headers.get('Location')), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}
const callback = session => request('/callback?state=' + session.redirect.searchParams.get('state') + '&code=test-code', session.cookie);
function github(push = true) {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push([url, options]);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'test-token', token_type: 'bearer' });
    return Response.json({ permissions: { push } });
  } };
}

test('authorization pins scope and redirect, uses PKCE and secure state cookie', async () => {
  const { response, redirect } = await begin();
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.searchParams.get('scope'), 'public_repo');
  assert.equal(redirect.searchParams.get('redirect_uri'), env.PUBLIC_URL + '/callback');
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(redirect.searchParams.get('code_challenge').length, 43);
  for (const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=600']) assert.ok(response.headers.get('Set-Cookie').includes(flag));
  assert.doesNotMatch(response.headers.get('Location'), /test-only/);
  assert.notEqual((await begin()).redirect.searchParams.get('state'), redirect.searchParams.get('state'));
});
test('untrusted site, provider, method and unconfigured service fail closed', async () => {
  assert.equal((await handleRequest(request('/auth?provider=github&site_id=evil.example'), env)).status, 403);
  assert.equal((await handleRequest(request('/auth?provider=other&site_id=ssail.korea.ac.kr'), env)).status, 400);
  assert.equal((await handleRequest(new Request(env.PUBLIC_URL + '/auth', { method:'POST' }), env)).status, 405);
  assert.equal((await handleRequest(request('/auth'), { ...env, COOKIE_SECRET: '' })).status, 503);
  assert.equal((await handleRequest(new Request('https://other.example/auth'), env)).status, 403);
});
test('missing, forged, mismatched and expired state cannot reach GitHub', async t => {
  const session = await begin();
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('must not run'); };
  assert.equal((await handleRequest(request('/callback?code=x&state=x'), env, fetcher)).status, 400);
  assert.equal((await handleRequest(request('/callback?code=x&state=wrong', session.cookie), env, fetcher)).status, 400);
  assert.equal((await handleRequest(request('/callback?code=x&state=x', session.cookie + 'forged'), env, fetcher)).status, 400);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 700000);
  assert.equal((await handleRequest(callback(session), env, fetcher)).status, 400);
  assert.equal(calls, 0);
});
test('successful callback verifies repository permission and exact opener before delivering token', async () => {
  const session = await begin();
  const api = github();
  const response = await handleRequest(callback(session), env, api.fetch);
  assert.equal(response.status, 200);
  assert.equal(api.calls[1][0], 'https://api.github.com/repos/' + env.GITHUB_REPO);
  const body = api.calls[0][1].body;
  assert.equal(body.get('client_secret'), env.GITHUB_CLIENT_SECRET);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
  assert.equal(challenge, session.redirect.searchParams.get('code_challenge'));
  assert.ok(response.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.ok(!html.includes(env.GITHUB_CLIENT_SECRET));
  const sent = [];
  const parent = { postMessage: (data, origin) => sent.push([data,origin]) };
  let listener;
  vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], {
    window: { opener: parent, addEventListener: (name, fn) => { listener = fn; }, removeEventListener() {} }
  });
  assert.deepEqual(sent, [['authorizing:github','https://ssail.korea.ac.kr']]);
  listener({ origin:'https://evil.example', source:parent, data:'authorizing:github' });
  listener({ origin:'https://ssail.korea.ac.kr', source:{}, data:'authorizing:github' });
  assert.equal(sent.length, 1);
  listener({ origin:'https://ssail.korea.ac.kr', source:parent, data:'authorizing:github' });
  assert.equal(sent[1][1], 'https://ssail.korea.ac.kr');
  assert.deepEqual(JSON.parse(sent[1][0].replace('authorization:github:success:', '')), { token:'test-token',provider:'github' });
});
test('read-only users, rejected codes and network failures never receive a token', async () => {
  const session = await begin();
  const denied = await handleRequest(callback(session), env, github(false).fetch);
  assert.equal(denied.status, 403);
  assert.doesNotMatch(await denied.text(), /test-token/);
  const badCode = await handleRequest(callback(session), env, async () => Response.json({ error:'bad_verification_code' }));
  assert.equal(badCode.status, 401);
  const failed = await handleRequest(callback(session), env, async () => { throw new Error('private upstream detail'); });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private upstream/);
});
test('Cloudflare third context argument is not interpreted as a fetch function', async t => {
  const session = await begin();
  t.mock.method(globalThis, 'fetch', github().fetch);
  const response = await worker.fetch(callback(session), env, { waitUntil() {} });
  assert.equal(response.status, 200);
});
