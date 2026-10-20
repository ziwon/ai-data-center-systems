import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distRoot = path.join(process.cwd(), 'dist');
let updatedFiles = 0;
let removedOpenAttributes = 0;

await walk(distRoot);

console.log(
  `Postprocessed ${updatedFiles} HTML files; removed ${removedOpenAttributes} sidebar open attributes.`,
);

async function walk(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      await collapseSidebarGroups(absolute);
    }
  }
}

async function collapseSidebarGroups(filePath) {
  // Topic navigation preserves Starlight's current-page ancestry.
  const topic = path.relative(distRoot, filePath).split(path.sep)[0];
  if (topic === 'gpu' || topic === 'inference') return;

  const html = await readFile(filePath, 'utf8');
  const nextHtml = html.replace(/<details open class="astro-3ii7xxms">/g, () => {
    removedOpenAttributes += 1;
    return '<details class="astro-3ii7xxms">';
  });

  if (nextHtml === html) return;

  await writeFile(filePath, nextHtml);
  updatedFiles += 1;
}
