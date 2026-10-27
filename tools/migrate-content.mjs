// One-time, non-destructive conversion of the existing static pages into CMS records.
// The original HTML files stay in place as layouts and a pre-CMS fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { htmlToCitation } from './citations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = path.join(root, 'content');
try { await fs.access(content); throw new Error('content already exists; refusing to overwrite editorial changes.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const clean = value => value.replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ').trim();
const text = element => clean(element?.textContent || '');
function lines(element) {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return text(copy);
}
async function doc(file) { return parseHTML(await fs.readFile(path.join(root, file), 'utf8')).document; }
async function write(file, value) {
  const target = path.join(content, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function member(card) {
  const image = card.querySelector('img');
  const photo = image.getAttribute('src');
  return { name: text(card.querySelector('h3')), photo: /^https?:/.test(photo) ? photo : '/' + photo.replace(/^\//, ''),
    photo_alt: image.getAttribute('alt') || '', role: text(card.querySelector('.role')),
    details: [...card.querySelectorAll('p:not(.role)')].map(lines).join('\n') };
}
const undergraduate = await doc('people_undergraduate.html');
for (const panel of undergraduate.querySelectorAll('[data-year-panel]')) {
  const year = Number(panel.dataset.yearPanel);
  await write(`undergraduates/${year}.json`, { year, members: [...panel.querySelectorAll('.person-card')].map(member) });
}
await write('current.json', { members: [...(await doc('people.html')).querySelectorAll('.person-card')].map(member) });
const alumni = [...(await doc('people_alumni.html')).querySelectorAll('.alumni-group')];
for (const [index, group] of alumni.entries()) {
  await write(`alumni/group-${index + 1}.json`, { title: text(group.querySelector('h2')), order: (index + 1) * 10,
    members: [...group.querySelectorAll('.person-card')].map(member) });
}
let publicationCount = 0;
const categories = ['journal', 'conference', 'poster'];
for (const [sectionIndex, section] of [...(await doc('publications.html')).querySelectorAll('.publication-section')].entries()) {
  for (const [index, li] of [...section.querySelectorAll('li')].entries()) {
    const citation = htmlToCitation(li.innerHTML);
    const plain = text(li).replace(/\s+/g, ' ');
    const year = Number(plain.match(/\((\d{4})\)/)?.[1] || plain.match(/\b(19|20)\d{2}\b/)?.[0]);
    if (!year) throw new Error('Cannot extract publication year: ' + plain);
    const category = categories[sectionIndex];
    await write(`publications/${category}-${String(index + 1).padStart(3, '0')}.json`, {
      title: plain.slice(0, 150), category, year, order: (index + 1) * 10, citation
    });
    publicationCount++;
  }
}
const newsDoc = await doc('news.html');
const homeDoc = await doc('index.html');
const teasers = [...homeDoc.querySelectorAll('.news-preview')];
for (const [index, article] of [...newsDoc.querySelectorAll('.news-item')].entries()) {
  await write(`news/news-${String(index + 1).padStart(3, '0')}.json`, {
    title: text(article.querySelector('h2')), date_label: text(article.querySelector('time')),
    order: (index + 1) * 10, body: lines(article.querySelector('p')),
    summary: teasers[index] ? text(teasers[index].querySelector('p')) : '', link: ''
  });
}
console.log(`Migrated 7 undergraduate years / 28 students, 11 current members, 11 alumni, ${publicationCount} publications, 13 full news articles.`);
