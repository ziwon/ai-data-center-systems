import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  legacyMappings,
  legacyRoutePrefixes as legacyPrefixes,
} from './route-mappings.mjs';

const distRoot = path.join(process.cwd(), 'dist');
const errors = [];

const canonicalRoutes = [
  '/',
  '/blog/',
  '/blog/gpu-sm-warp-memory-and-cudnn-rtx5090.ko/',
  '/network/',
  '/network/chap01/',
  '/gpu/',
  '/training/',
  '/inference/',
  '/inference/models/',
  '/inference/models/kimi-k3/',
  '/inference/efficient-llm-inference-systems/',
  '/inference/efficient-llm-inference-systems/week01/',
  '/mlops/',
  '/storage/',
  '/systems-performance/',
  '/systems-performance/chap01/',
  '/courses/',
  '/courses/cme295/',
  '/courses/cme295/lec-03/',
  '/courses/deep-learning-for-network-engineers/',
  '/courses/deep-learning-for-network-engineers/week04/',
];

let legacyRedirectCount = 0;

for (const route of canonicalRoutes) {
  const htmlPath = route === '/'
    ? path.join(distRoot, 'index.html')
    : path.join(distRoot, route.slice(1), 'index.html');
  await expectFile(htmlPath, `canonical route ${route}`);
}

for (const { from, to } of legacyMappings) {
  await expectFile(
    path.join(distRoot, from.slice(1), 'index.html'),
    `legacy fallback route ${from}/`,
  );

  const redirectFiles = await collectFiles(
    path.join(distRoot, from.slice(1)),
    (file) => file.endsWith('.html'),
  );
  legacyRedirectCount += redirectFiles.length;

  for (const redirectFile of redirectFiles) {
    const relativeDirectory = path
      .relative(path.join(distRoot, from.slice(1)), path.dirname(redirectFile))
      .split(path.sep)
      .filter((segment) => segment && segment !== '.')
      .join('/');
    const targetRoute = `${to}${relativeDirectory ? `/${relativeDirectory}` : ''}/`;
    const redirectHtml = await readFile(redirectFile, 'utf8');
    if (!redirectHtml.includes(`content="0;url=${targetRoute}"`)) {
      errors.push(`${from}/${relativeDirectory} does not redirect to ${targetRoute}.`);
    }
    if (!redirectHtml.includes('<meta name="robots" content="noindex">')) {
      errors.push(`${from}/${relativeDirectory} is missing the noindex directive.`);
    }
    await expectFile(
      path.join(distRoot, targetRoute.slice(1), 'index.html'),
      `redirect target ${targetRoute}`,
    );
  }
}

await validateTalkDeck('/talks/sr-iov-with-dgx-b200/');

await expectFile(path.join(distRoot, 'CNAME'), 'custom-domain CNAME');
await expectFile(path.join(distRoot, 'blog', 'rss.xml'), 'blog RSS feed');
await expectFile(path.join(distRoot, 'llms.txt'), 'llms.txt');
await expectFile(path.join(distRoot, 'llms-full.txt'), 'llms-full.txt');
await expectFile(path.join(distRoot, 'kb', 'dcs-kb-graph.json'), 'global knowledge graph');

const sitemapFiles = (await readdir(distRoot)).filter((name) => /^sitemap-\d+\.xml$/.test(name));
if (sitemapFiles.length === 0) {
  errors.push('No sitemap-N.xml file was generated.');
} else {
  const sitemap = (
    await Promise.all(sitemapFiles.map((name) => readFile(path.join(distRoot, name), 'utf8')))
  ).join('\n');
  for (const route of canonicalRoutes) {
    const url = `https://aidc.restack.tech${route}`;
    if (!sitemap.includes(`<loc>${url}</loc>`)) {
      errors.push(`Sitemap is missing canonical URL ${url}.`);
    }
  }
  assertNoLegacyRoutes(sitemap, 'sitemap');
}

const llms = await readText(path.join(distRoot, 'llms.txt'));
assertNoLegacyRoutes(llms, 'llms.txt');
for (const route of canonicalRoutes.filter((route) => route !== '/')) {
  if (!llms.includes(`https://aidc.restack.tech${route}`)) {
    errors.push(`llms.txt is missing canonical URL https://aidc.restack.tech${route}.`);
  }
}

const graphText = await readText(path.join(distRoot, 'kb', 'dcs-kb-graph.json'));
assertNoLegacyRoutes(graphText, 'global knowledge graph');
if (graphText) {
  try {
    const graph = JSON.parse(graphText);
    const graphRoutes = new Set(
      (graph.nodes ?? []).map((node) => node.route).filter(Boolean),
    );
    for (const route of canonicalRoutes) {
      if (!graphRoutes.has(route)) errors.push(`Knowledge graph is missing route ${route}.`);
    }
  } catch (error) {
    errors.push(`Knowledge graph is not valid JSON: ${error.message}`);
  }
}

for (const route of canonicalRoutes.filter((route) => route !== '/')) {
  const htmlPath = path.join(distRoot, route.slice(1), 'index.html');
  const html = await readText(htmlPath);
  if (html && !html.includes(`<link rel="canonical" href="https://aidc.restack.tech${route}"`)) {
    errors.push(`Canonical tag is missing or incorrect for ${route}.`);
  }
}

const htmlFiles = await collectFiles(distRoot, (file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  const relative = `/${path.relative(distRoot, file).split(path.sep).join('/')}`;
  if (legacyPrefixes.some((prefix) => relative.startsWith(`${prefix}/`))) continue;
  const html = await readFile(file, 'utf8');
  for (const prefix of legacyPrefixes) {
    if (html.includes(`href="${prefix}`) || html.includes(`src="${prefix}`)) {
      errors.push(`Canonical page ${relative} still references legacy prefix ${prefix}.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Build validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${canonicalRoutes.length} canonical routes, ${legacyRedirectCount} legacy fallbacks, ${htmlFiles.length} HTML files, sitemap, LLM indexes, and knowledge graph.`,
  );
}

// Slide decks ship as self-contained static bundles in public/, so validate that the
// deck entry point and every local resource it pulls in actually landed in dist.
async function validateTalkDeck(route) {
  const deckDirectory = path.join(distRoot, route.slice(1));
  const entryPoint = path.join(deckDirectory, 'index.html');
  await expectFile(entryPoint, `talk deck ${route}`);

  const html = await readText(entryPoint);
  if (!html) return;

  const references = new Set();
  const pendingStylesheets = [];

  const addReference = (reference, fromDirectory) => {
    if (isExternalReference(reference)) return;
    const resolved = path.posix.join(fromDirectory, reference);
    if (references.has(resolved)) return;
    references.add(resolved);
    if (resolved.endsWith('.css')) pendingStylesheets.push(resolved);
  };

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) addReference(match[1], '.');

  // Stylesheets pull in further resources (@import, fonts), so follow them transitively.
  while (pendingStylesheets.length > 0) {
    const stylesheet = pendingStylesheets.pop();
    const css = await readText(path.join(deckDirectory, stylesheet));
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      addReference(match[1], path.posix.dirname(stylesheet));
    }
  }

  for (const reference of references) {
    // Fonts declare multi-format fallbacks; only the woff2 files are shipped.
    if (/\.(?:otf|ttf|woff)$/i.test(reference)) continue;
    await expectFile(
      path.join(deckDirectory, reference),
      `talk deck resource ${route}${reference}`,
    );
  }
}

function isExternalReference(reference) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|[#?])/i.test(reference);
}

async function expectFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    errors.push(`Missing ${label}: ${path.relative(distRoot, filePath)}`);
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function assertNoLegacyRoutes(text, label) {
  for (const prefix of legacyPrefixes) {
    if (text.includes(`https://aidc.restack.tech${prefix}`)) {
      errors.push(`${label} still contains legacy URL prefix ${prefix}.`);
    }
  }
}

async function collectFiles(currentDir, predicate) {
  const files = [];
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute, predicate));
    else if (entry.isFile() && predicate(absolute)) files.push(absolute);
  }
  return files;
}
