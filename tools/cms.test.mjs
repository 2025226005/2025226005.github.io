import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { parse as parseYaml } from 'yaml';
import { root, readContent, renderPage, safeUrl, citationHtml } from './build.mjs';
import { createConfig } from '../admin/collections.js';
import { htmlToCitation } from './citations.mjs';

const data = await readContent();
const script = await fs.readFile(path.join(root, 'site.js'), 'utf8');
const member = { name: '테스트 학생 Test Student', role: 'Undergraduate Researcher', photo: '/uploads/cms/test.jpg', details: 'B.S. Civil Engineering\nEmail: student@example.com' };
const asDocument = html => parseHTML(html).document;

test('new year and student render independently without changing earlier years', async () => {
  const copy = structuredClone(data);
  const newYear = copy.years[0].year + 1;
  copy.years.unshift({ year: newYear, members: [member] });
  const html = await renderPage('people_undergraduate.html', root, copy);
  const document = asDocument(html);
  assert.equal(document.querySelector('[data-year-panel]').dataset.yearPanel, String(newYear));
  assert.equal(document.querySelectorAll('[data-year-panel]:not([hidden])').length, 1);
  const newPanel = document.querySelector(`[data-year-panel="${newYear}"]`);
  assert.match(newPanel.textContent, /Test Student/);
  assert.equal(newPanel.querySelector('img').getAttribute('src'), 'uploads/cms/test.jpg');
  for (const year of data.years) {
    const panel = document.querySelector(`[data-year-panel="${year.year}"]`);
    assert.deepEqual([...panel.querySelectorAll('h3')].map(e => e.textContent), year.members.map(m => m.name));
    assert.ok(panel.hidden);
  }
  let url;
  const location = new URL(`https://ssail.korea.ac.kr/people_undergraduate.html?year=${data.years[0].year}`);
  vm.runInNewContext(script, { document, location, URL, URLSearchParams, history: { replaceState: (s,t,v) => { url = String(v); } }, matchMedia: () => ({ matches: false }) });
  assert.ok(newPanel.hidden);
  const oldPanel = document.querySelector(`[data-year-panel="${data.years[0].year}"]`);
  assert.equal(oldPanel.hidden, false);
  document.querySelector(`button[data-year="${newYear}"]`).click();
  assert.equal(newPanel.hidden, false);
  assert.ok(oldPanel.hidden);
  assert.equal(document.querySelectorAll('[data-year-panel]:not([hidden])').length, 1);
  assert.equal(document.querySelector(`button[data-year="${newYear}"]`).getAttribute('aria-selected'), 'true');
  assert.ok(url.endsWith(`year=${newYear}`));
  assert.equal(document.querySelector('.nav-dropdown-menu a[href^="people_undergraduate"]').getAttribute('href'), 'people_undergraduate.html');
});

test('unknown year falls back to newest and empty year is supported', async () => {
  const copy = structuredClone(data);
  copy.years[0].members = [];
  const document = asDocument(await renderPage('people_undergraduate.html', root, copy));
  vm.runInNewContext(script, { document, location: new URL('https://ssail.korea.ac.kr/people_undergraduate.html?year=invalid'), URL, URLSearchParams, history: { replaceState() {} }, matchMedia: () => ({ matches: false }) });
  assert.equal(document.querySelector('[data-year-panel]:not([hidden])').dataset.yearPanel, String(copy.years[0].year));
  assert.match(document.querySelector('[data-year-panel]').textContent, /announced soon/);
});

test('new publication keeps category, rich text and safe link', async () => {
  const copy = structuredClone(data);
  copy.publications.unshift({ title: 'New study', category: 'conference', year: 2027, order: 0, citation: 'Kim (2027). **New study**. *Conference*. [Paper](https://example.com/paper)' });
  const document = asDocument(await renderPage('publications.html', root, copy));
  const sections = [...document.querySelectorAll('.publication-section')];
  assert.match(sections[1].querySelector('li').textContent, /New study/);
  assert.equal(sections[1].querySelector('li em').textContent, 'Conference');
  assert.equal(sections[1].querySelector('li a').getAttribute('href'), 'https://example.com/paper');
  assert.equal(sections[0].querySelectorAll('li').length, data.publications.filter(p => p.category === 'journal').length);
});

test('citation conversion preserves literal award brackets and adjacent emphasis', () => {
  const original = 'vol. 48<em>.</em> &lt;<em>Best Presentation Award,</em><em> 1st Place&gt;</em> <em>&lt;Best Paper Award&gt;</em>';
  const rendered = asDocument(citationHtml(htmlToCitation(original)));
  assert.equal([...rendered.childNodes].map(n => n.textContent).join(''), 'vol. 48. <Best Presentation Award, 1st Place> <Best Paper Award>');
  assert.equal([...rendered.querySelectorAll('em')].map(e => e.textContent).join('').replace(/\s/g, ''), '.BestPresentationAward,1stPlace><BestPaperAward>');
});

test('news keeps full body separate from home summary', async () => {
  const copy = structuredClone(data);
  const body = 'First line.\n두 번째 줄 전체 내용입니다.\n' + 'Long full content. '.repeat(100);
  copy.news.unshift({ title: 'New award', date_label: 'Jan 2027', order: 0, body, summary: 'Short home introduction', link: 'https://example.com' });
  const news = asDocument(await renderPage('news.html', root, copy));
  const home = asDocument(await renderPage('index.html', root, copy));
  assert.equal(news.querySelector('.news-item p').textContent, body);
  assert.equal(home.querySelector('.news-preview p').textContent, 'Short home introduction');
  assert.equal(news.querySelector('.news-item a').getAttribute('href'), 'https://example.com');
});

test('all currently stored entries render without omitted fields', async () => {
  for (const file of ['people.html', 'people_alumni.html', 'people_undergraduate.html', 'publications.html', 'news.html', 'index.html']) {
    const html = await renderPage(file, root, data);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.doesNotMatch(html, /undefined|\[object Object\]/);
  }
});

test('URLs and authored content cannot inject scripts or escape uploads', async () => {
  for (const url of ['javascript:alert(1)', '//evil.example/x', '/uploads/../secret', '/uploads/%2e%2e/secret', '/uploads/%5c..%5csecret', '/uploads/x%22onerror%3D%22bad']) assert.throws(() => safeUrl(url, true));
  assert.equal(safeUrl('/uploads/cms/김학생.jpg', true), 'uploads/cms/김학생.jpg');
  assert.equal(safeUrl('uploads/cms/photo%20one.jpg', true), 'uploads/cms/photo%20one.jpg');
  const rendered = asDocument(citationHtml('**safe** <script>alert(1)</script> <img src=x onerror=alert(1)> [bad](javascript:alert(1)) <a href="https://example.com" onclick="bad()">good</a>'));
  assert.equal(rendered.querySelectorAll('script,img,[onclick],a[href^="javascript"]').length, 0);
  assert.equal(rendered.querySelector('strong').textContent, 'safe');
  const copy = structuredClone(data);
  copy.current.members = [{ ...member, name: '<img src=x onerror=alert(1)>', details: 'Email: test@example.com\n<script>bad()</script>' }];
  const doc = asDocument(await renderPage('people.html', root, copy));
  assert.equal(doc.querySelector('.person-card h3').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(doc.querySelectorAll('.person-card script,.person-card [onerror]').length, 0);
});

test('content reader sorts years, supports empty lists and rejects duplicate years', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssail-cms-test-'));
  t.after(async () => { if (path.basename(dir).startsWith('ssail-cms-test-') && path.dirname(dir) === path.resolve(os.tmpdir())) await fs.rm(dir, { recursive: true, force: true }); });
  const write = async (name, value) => { const file = path.join(dir, 'content', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); };
  await Promise.all(['alumni','publications','news'].map(name => fs.mkdir(path.join(dir, 'content', name), { recursive: true })));
  await write('current.json', { members: [] });
  await write('undergraduates/2027.json', { year: 2027 });
  await write('undergraduates/2026.json', { year: 2026, members: null });
  assert.deepEqual((await readContent(dir)).years.map(y => [y.year,y.members]), [[2027,[]],[2026,[]]]);
  await write('news/old.json', { title: 'Old', date_label: '2025', order: 1, body: 'Old full article' });
  await write('news/new.json', { title: 'New', date_label: '2026', order: -123456789, body: 'New full article' });
  await write('order.json', { version: 1, lists: { undergraduates: ['content/undergraduates/2026.json','content/undergraduates/2027.json'], news: ['content/news/old.json','content/news/new.json'] } });
  const reordered = await readContent(dir);
  assert.deepEqual(reordered.years.map(y => y.year), [2026,2027]);
  assert.deepEqual(reordered.news.map(n => n.title), ['Old','New']);
  const home = asDocument(await renderPage('index.html', root, reordered));
  const news = asDocument(await renderPage('news.html', root, reordered));
  assert.equal(home.querySelector('.news-preview h3').textContent, 'Old');
  assert.equal(news.querySelector('.news-item h2').textContent, 'Old');
  const yearPage = asDocument(await renderPage('people_undergraduate.html', root, reordered));
  assert.equal(yearPage.querySelector('[data-year-panel]:not([hidden])').dataset.yearPanel, '2026');
  await write('undergraduates/duplicate.json', { year: 2027, members: [] });
  await assert.rejects(readContent(dir), /Duplicate year/);
});

test('collection grouping conforms to the CMS nonempty-list requirement', () => {
  const config = createConfig({ repo: '2025226005/2025226005.github.io', branch: 'main' });
  for (const collection of config.collections) {
    assert.ok(collection.view_groups === undefined || collection.view_groups.length >= 1,
      `${collection.name}: view_groups must be omitted or have at least one item`);
  }
});

test('admin fields and deployment use the content repository and generated artifact', async () => {
  const settings = JSON.parse(await fs.readFile(path.join(root, 'admin/config.json'), 'utf8'));
  const config = createConfig(settings);
  assert.equal(config.backend.name, 'github-token');
  assert.equal(config.backend.base_url, undefined);
  assert.equal(settings.auth_url, undefined);
  assert.equal(config.backend.repo, '2025226005/2025226005.github.io');
  assert.equal(config.load_config_file, false);
  assert.equal(config.local_backend, undefined);
  assert.equal(config.collections.find(c => c.name === 'undergraduates').slug, '{{fields.year}}');
  assert.equal(config.media_folder, 'uploads/cms');
  for (const c of config.collections) {
    if (c.folder) assert.ok((await fs.stat(path.join(root, c.folder))).isDirectory());
    for (const file of c.files || []) await fs.access(path.join(root, file.file));
  }
  const workflow = parseYaml(await fs.readFile(path.join(root, '.github/workflows/pages.yml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, [settings.branch]);
  assert.equal(workflow.jobs.build.steps.find(s => s.uses?.startsWith('actions/upload-pages-artifact')).with.path, '_site');
  assert.equal(workflow.jobs.deploy.needs, 'build');
  assert.ok(workflow.jobs.deploy.if.includes("github.event_name != 'pull_request'"));
  assert.ok(workflow.jobs.deploy.if.includes("github.ref == 'refs/heads/main'"));
});
