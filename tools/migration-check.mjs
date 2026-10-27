// One-time preservation check. Not a deployment gate: later CMS edits may intentionally differ.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { root, readContent, renderPage } from './build.mjs';
const normalize = text => text.replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const data = await readContent();
for (const file of ['people.html', 'people_undergraduate.html', 'people_alumni.html', 'publications.html', 'news.html', 'index.html']) {
  const old = parseHTML(await fs.readFile(path.join(root, file), 'utf8')).document;
  const updated = parseHTML(await renderPage(file, root, data)).document;
  const selector = file === 'index.html' ? '.news-preview' : file === 'news.html' ? '.news-item' : file === 'publications.html' ? '.publication-section li' : '.person-card';
  const before = [...old.querySelectorAll(selector)];
  const after = [...updated.querySelectorAll(selector)];
  assert.equal(after.length, before.length, `${file} record count`);
  for (let i = 0; i < before.length; i++) {
    // Newlines between tags do not affect visible prose. Preserve every non-whitespace character.
    assert.equal(normalize(after[i].textContent).replace(/\s/g, ''), normalize(before[i].textContent).replace(/\s/g, ''), `${file} record ${i + 1} full text`);
    assert.deepEqual([...after[i].querySelectorAll('img')].map(e => e.getAttribute('src')), [...before[i].querySelectorAll('img')].map(e => e.getAttribute('src')), `${file} record ${i + 1} images`);
    const links = el => [...el.querySelectorAll('a')].map(e => decodeURI(e.getAttribute('href')).replace(/[\u200b\ufeff]/g, ''));
    assert.deepEqual(links(after[i]), links(before[i]), `${file} record ${i + 1} links`);
  }
  if (file === 'publications.html') {
    const emphasis = doc => [...doc.querySelectorAll('.publication-section em')].map(e => normalize(e.textContent)).filter(Boolean).join('').replace(/\s/g, '');
    assert.equal(emphasis(updated), emphasis(old), 'Publication emphasis preserved');
  }
  console.log(`Preserved ${before.length} full records: ${file}`);
}
for (const file of ['research.html', 'teaching.html', 'contact.html']) {
  assert.equal(await renderPage(file, root, data), await fs.readFile(path.join(root, file), 'utf8'));
  console.log(`Unchanged: ${file}`);
}
