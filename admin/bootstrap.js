import { createConfig } from './collections.js?v=ordering-1';
import { clearSavedLogin, registerTokenBackend } from './token-backend.js?v=ordering-1';
import { installOrderingUI } from './reorder-ui.js';

const title = document.getElementById('status-title');
const message = document.getElementById('status-message');
function status(heading, text) { title.textContent = heading; message.textContent = text; }
async function start() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && local)) {
    status('Open the published website', 'Visit /admin/ on the published HTTPS website. Do not enter your token in a local file:// page.');
    return;
  }
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the editor settings.');
  const settings = await response.json();
  if (!/^[\w.-]+\/[\w.-]+$/.test(settings.repo)) throw new Error('Check the GitHub repository setting.');
  clearSavedLogin(window.localStorage);
  window.CMS_MANUAL_INIT = true;
  status('Loading the editor', 'You will be asked for your website’s GitHub access token.');
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/decap-cms@3.17.1/dist/decap-cms.js';
  script.referrerPolicy = 'no-referrer';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the editor. Check your connection and reload.'));
    document.head.append(script);
  });
  let orderingUI;
  registerTokenBackend(window.CMS, window, settings.repo, {
    onBackend(backend) { orderingUI?.destroy(); orderingUI = installOrderingUI({ backend, window, document }); },
    onSessionChanged() { orderingUI?.refresh(); }
  });
  window.CMS.init({ config: createConfig(settings) });
  document.getElementById('status').hidden = true;
}
start().catch(error => status('Could not open the editor', error.message));
