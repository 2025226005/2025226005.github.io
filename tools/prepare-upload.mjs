// Produce a reviewable upload inventory; this script does not contact GitHub.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['.github', 'admin', 'content', 'oauth-worker', 'tools', 'uploads'];
const files = ['.gitignore', '.nojekyll', 'ADMIN_SETUP.md', 'README.md', 'package.json', 'package-lock.json', 'site.css', 'site.js'];
export async function inventory() {
  const paths = [...files, ...(await fs.readdir(root)).filter(name => name.endsWith('.html'))];
  for (const directory of directories) {
    for (const item of await fs.readdir(path.join(root, directory), { recursive: true, withFileTypes: true })) {
      if (item.isFile()) paths.push(path.relative(root, path.join(item.parentPath, item.name)).split(path.sep).join('/'));
    }
  }
  const result = [];
  for (const name of [...new Set(paths)].sort()) {
    const content = await fs.readFile(path.join(root, name));
    const sha = crypto.createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    result.push({ path: name, sha, size: content.length, binary: name.startsWith('uploads/') });
  }
  // CNAME is intentionally omitted: the existing repository removed it. Enabling
  // a school domain is a separate Pages/DNS setting, not part of the admin upload.
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const entries = await inventory();
  if (process.argv.includes('--folder') || process.argv.includes('--batches')) {
    const batches = process.argv.includes('--batches');
    const destination = path.resolve(root, '..', batches ? 'github-upload-admin-batches' : 'github-upload-admin');
    // mkdir without recursive deliberately refuses to overwrite an existing folder.
    await fs.mkdir(destination);
    const other = entries.filter(e => !e.path.startsWith('content/'));
    const content = entries.filter(e => e.path.startsWith('content/'));
    const groups = batches ? [other, ...Array.from({ length: Math.ceil(content.length / 90) }, (_, i) => content.slice(i * 90, (i + 1) * 90))] : [entries];
    if (batches && groups.some(group => group.length > 100)) throw new Error('Upload batch exceeds GitHub browser file limit');
    for (const [index, group] of groups.entries()) {
      for (const entry of group) {
        const target = path.resolve(destination, ...(batches ? [String(index + 1).padStart(2, '0')] : []), entry.path);
        if (!target.startsWith(destination + path.sep)) throw new Error('Unexpected upload path');
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(root, entry.path), target, fs.constants.COPYFILE_EXCL);
      }
    }
    console.log(JSON.stringify({ destination, files: entries.length, batches: groups.map(g => g.length), bytes: entries.reduce((n, e) => n + e.size, 0) }));
  } else console.log(JSON.stringify(entries));
}
