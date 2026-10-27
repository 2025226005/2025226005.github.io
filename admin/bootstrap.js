import { createConfig } from './collections.js';
import { clearSavedLogin, registerTokenBackend } from './token-backend.js';

const title = document.getElementById('status-title');
const message = document.getElementById('status-message');
function status(heading, text) { title.textContent = heading; message.textContent = text; }
async function start() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && local)) {
    status('게시된 홈페이지에서 열어 주세요', '게시된 HTTPS 홈페이지 주소 뒤에 /admin/을 붙여 접속하세요. 로컬 파일(file://)에서는 관리 키를 입력하지 않습니다.');
    return;
  }
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('관리자 설정 파일을 불러오지 못했습니다.');
  const settings = await response.json();
  if (!/^[\w.-]+\/[\w.-]+$/.test(settings.repo)) throw new Error('관리할 GitHub 저장소 설정을 확인해 주세요.');
  clearSavedLogin(window.localStorage);
  window.CMS_MANUAL_INIT = true;
  status('GitHub 관리 화면을 불러오는 중입니다', '잠시 후 홈페이지용 GitHub 관리 키를 입력하면 편집할 수 있습니다.');
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/decap-cms@3.17.1/dist/decap-cms.js';
  script.referrerPolicy = 'no-referrer';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('관리 화면을 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.'));
    document.head.append(script);
  });
  registerTokenBackend(window.CMS, window, settings.repo);
  window.CMS.init({ config: createConfig(settings) });
  document.getElementById('status').hidden = true;
}
start().catch(error => status('관리 화면을 열지 못했습니다', error.message));
