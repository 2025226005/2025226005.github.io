import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { marked } from 'marked';
import sanitize from 'sanitize-html';
import { emptyOrder, orderedRecords, validateOrder } from '../admin/order-model.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const categories = { journal: 'JOURNAL PUBLICATIONS', conference: 'Conference Publications & Abstracts', poster: 'Posters' };
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`); return value; }
function integer(value, label, min = 0, max = 999999) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}: ${value}`); return value; }
export function safeUrl(value, image = false) {
  if (typeof value !== 'string') throw new Error('Invalid URL');
  if (/^https?:\/\/[^\s<>"\\]+$/i.test(value)) return value;
  if (image && /^\/?uploads\//.test(value) && !/[<>"'?#\\\x00-\x1f]/.test(value)) {
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { throw new Error('Invalid image URL'); }
    if (!decoded.split('/').some(part => ['.', '..'].includes(part)) && !/[<>"'?#\\\x00-\x1f]/.test(decoded)) return value.replace(/^\//, '');
  }
  throw new Error('Unsafe or unsupported URL: ' + value);
}
function details(value) {
  return value.split(/\r?\n/).map(line => {
    const email = line.match(/^Email:\s*([^\s<>"\x00-\x1f]+@[^\s<>"\x00-\x1f]+)$/);
    if (email) return `Email: <a href="mailto:${escape(email[1])}">${escape(email[1])}</a>`;
    const phone = line.match(/^Phone:\s*(\(\d{3}\) ?\d{3}-\d{4})$/);
    if (phone) return `Phone: <a href="tel:+1${phone[1].replace(/\D/g, '')}">${escape(phone[1])}</a>`;
    return escape(line);
  }).join('<br>');
}
function person(member) {
  required(member.name, 'member name'); required(member.role, 'member role');
  required(member.details, 'member education/details');
  const photo = safeUrl(required(member.photo, 'member photo'), true);
  return `<article class="person-card panel"><img src="${escape(photo)}" alt="${escape(member.photo_alt || member.name)}"><h3>${escape(member.name)}</h3><p class="role">${escape(member.role)}</p><p>${details(member.details)}</p></article>`;
}
export function citationHtml(value) {
  return sanitize(marked.parseInline(required(value, 'publication citation')), {
    allowedTags: ['em', 'strong', 'b', 'i', 'a', 'br', 'code', 'sub', 'sup', 's'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https'], allowProtocolRelative: false,
    transformTags: { a: (tag, attrs) => ({ tagName: tag, attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' } }) }
  });
}
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function records(source, directory) {
  const files = (await fs.readdir(path.join(source, 'content', directory))).filter(name => name.endsWith('.json')).sort();
  return Promise.all(files.map(async file => ({ ...await json(path.join(source, 'content', directory, file)), _file: file, path: `content/${directory}/${file}` })));
}
export async function readContent(source = root) {
  const [years, current, alumni, publications, news] = await Promise.all([
    records(source, 'undergraduates'), json(path.join(source, 'content/current.json')),
    records(source, 'alumni'), records(source, 'publications'), records(source, 'news')
  ]);
  let index;
  try { index = validateOrder(await json(path.join(source, 'content/order.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; index = emptyOrder(); }
  const seen = new Set();
  years.forEach(y => { integer(y.year, 'undergraduate year', 1900, 2200); if (seen.has(y.year)) throw new Error('Duplicate year: ' + y.year); seen.add(y.year); });
  if (!years.length) throw new Error('At least one undergraduate year is required.');
  for (const group of [...years, current, ...alumni]) {
    // An empty optional Decap list may be omitted or serialized as null.
    if (group.members == null) group.members = [];
    if (!Array.isArray(group.members)) throw new Error('Invalid member list');
  }
  // Legacy numeric order remains readable during rollout and rollback. It is no
  // longer editable; explicit ordered paths are now the source of display order.
  for (const item of [...alumni, ...publications, ...news]) integer(item.order ?? 0, 'legacy display order', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  publications.forEach(p => { if (!categories[p.category]) throw new Error('Unknown publication category'); integer(p.year, 'publication year', 1900, 2200); required(p.title, 'publication title'); });
  news.forEach(n => { required(n.title, 'news title'); required(n.date_label, 'news date'); required(n.body, 'news body'); if (n.link) safeUrl(n.link); });
  return { years: orderedRecords(years, index.lists.undergraduates, 'undergraduates'), current,
    alumni: orderedRecords(alumni, index.lists.alumni, 'alumni'),
    publications: orderedRecords(publications, index.lists.publications, 'publications'),
    news: orderedRecords(news, index.lists.news, 'news') };
}
export async function renderPage(file, source, data) {
  const original = await fs.readFile(path.join(source, file), 'utf8');
  if (!['index.html', 'people.html', 'people_undergraduate.html', 'people_alumni.html', 'publications.html', 'news.html'].includes(file)) return original;
  const { document } = parseHTML(original);
  const set = (selector, html) => { const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector} in ${file}`); element.innerHTML = html; };
  if (file === 'people.html') set('.people-grid', data.current.members.map(person).join('\n'));
  if (file === 'people_undergraduate.html') {
    set('.page-content', `<div class="year-tabs" role="tablist" aria-label="Undergraduate researcher year" data-year-tabs>${data.years.map((y,i) => `<button id="year-${y.year}" type="button" role="tab" data-year="${y.year}" aria-controls="panel-${y.year}" aria-selected="${i===0}">${y.year}</button>`).join('')}</div>` + data.years.map((y,i) => `<section id="panel-${y.year}" class="people-grid undergrad-grid" data-year-panel="${y.year}" role="tabpanel" aria-labelledby="year-${y.year}"${i ? ' hidden' : ''}>${y.members.length ? y.members.map(person).join('\n') : '<p>Members will be announced soon.</p>'}</section>`).join('\n'));
  }
  if (file === 'people_alumni.html') set('.page-content', data.alumni.map((group,i) => `<section class="alumni-group" aria-labelledby="alumni-${i}"><h2 class="alumni-group-title" id="alumni-${i}">${escape(required(group.title, 'alumni group title'))}</h2><div class="people-grid alumni-grid">${group.members.map(person).join('\n')}</div></section>`).join('\n'));
  if (file === 'publications.html') set('.page-content', Object.entries(categories).map(([key,title]) => `<section class="publication-section"><h2>${escape(title)}</h2><div class="paragraph"><ul>${data.publications.filter(p => p.category === key).map(p => `<li>${citationHtml(p.citation)}</li>`).join('\n')}</ul></div></section>`).join('\n'));
  if (file === 'news.html') set('.news-list', data.news.map(n => `<article class="news-item"><time>${escape(n.date_label)}</time><div><h2>${escape(n.title)}</h2><p>${escape(n.body)}</p>${n.link ? `<p><a href="${escape(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">More information →</a></p>` : ''}</div></article>`).join('\n'));
  if (file === 'index.html') set('.news-preview-grid', data.news.slice(0,3).map(n => `<article class="news-preview"><time>${escape(n.date_label)}</time><h3>${escape(n.title)}</h3><p>${escape(n.summary || n.body)}</p></article>`).join('\n'));
  return '<!doctype html>\n' + document.documentElement.outerHTML + '\n';
}
export async function build({ source = root, output = path.join(root, '_site') } = {}) {
  const data = await readContent(source);
  const files = (await fs.readdir(source)).filter(name => name.endsWith('.html'));
  // Render and validate first. No source content or template is overwritten.
  const pages = await Promise.all(files.map(async name => [name, await renderPage(name, source, data)]));
  for (const [name, html] of pages) {
    const { document } = parseHTML(html);
    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (/^https?:\/\//i.test(src)) continue;
      const asset = path.resolve(source, decodeURIComponent(src.replace(/^\//, '')));
      if (!asset.startsWith(path.resolve(source) + path.sep)) throw new Error('Image outside site');
      await fs.access(asset).catch(() => { throw new Error(`Missing image in ${name}: ${src}`); });
    }
  }
  await fs.mkdir(output, { recursive: true });
  for (const [name, html] of pages) await fs.writeFile(path.join(output, name), html);
  for (const name of ['site.css', 'site.js', '.nojekyll']) await fs.copyFile(path.join(source, name), path.join(output, name));
  try { await fs.copyFile(path.join(source, 'CNAME'), path.join(output, 'CNAME')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.rm(path.join(output, 'CNAME'), { force: true });
  }
  for (const name of ['uploads', 'admin']) await fs.cp(path.join(source, name), path.join(output, name), { recursive: true });
  return { years: data.years.map(y => y.year), undergraduates: data.years.reduce((n,y) => n + y.members.length,0), current: data.current.members.length, alumni: data.alumni.reduce((n,g)=>n+g.members.length,0), publications: data.publications.length, news: data.news.length, output };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(await build(), null, 2));
