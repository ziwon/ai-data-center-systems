import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { embedDocuments, isEmbeddingEnabled } from './lib/embeddings.mjs';

const execFileAsync = promisify(execFile);

const projectRoot = process.cwd();
const sourceRoot = path.resolve(projectRoot, '..');
const docsOut = path.join(projectRoot, 'src', 'content', 'docs');
const pagesOut = path.join(projectRoot, 'src', 'pages');
const publicOut = path.join(projectRoot, 'public');
const conceptsPath = path.join(projectRoot, 'kb', 'concepts.json');
const siteUrl = 'https://adcs.restack.tech';
const ogImageRevision = '2';
const repositoryEditBase = 'https://github.com/ziwon/ai-data-center-systems/edit/main/';

const docRoots = [
  'network',
  'gpu',
  'training',
  'inference',
  'mlops',
  'storage',
  'systems-performance',
  'courses',
  'talks',
];

const assetExtensions = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.svg',
  '.webp',
]);

// Self-contained static bundles (slide decks) are copied verbatim, so they need the web
// runtime extensions that `assetExtensions` deliberately excludes. Sub-resources go to
// public/, while each bundle's index.html becomes an Astro HTML page route so the
// directory URL resolves in `astro dev` too, not only behind a static file server.
const bundleRoots = ['talks'];

const bundleExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.otf',
  '.ttf',
  '.woff',
  '.woff2',
]);

const ignoredDirs = new Set([
  '.git',
  '.github',
  '.mypy_cache',
  '.pytest_cache',
  '.venv',
  'node_modules',
  'public',
  'refs',
  'scripts',
  '.site',
  '__pycache__',
  'src',
  'dist',
  'venv',
]);

const publishedAssetRoots = [
  'fabric.svg',
  'network',
  'gpu',
  'training',
  'inference',
  'mlops',
  'storage',
  'systems-performance',
  'courses',
  'talks',
];

const staleGeneratedPublicRoots = [
  'ai-data-center-network',
  'efficient-llm-inference-systems',
  'deep-learning-for-network-engineers',
  'ai-system-performance-engineering',
  'cme295',
  'refs',
];

const generatedPublicRoots = [...new Set([...publishedAssetRoots, ...staleGeneratedPublicRoots])];

const pages = [];

const defaultDescriptionsBySource = new Map([
  [
    'network/README.md',
    'AI data center networking study notes covering RDMA, InfiniBand, RoCEv2, Clos fabrics, telemetry, congestion control, and AI fabric operations.',
  ],
  [
    'inference/README.md',
    'LLM inference notes covering KV cache, quantization, speculative decoding, FlashAttention, SGLang production serving, and model serving profiles.',
  ],
  [
    'inference/efficient-llm-inference-systems/README.md',
    'LLM inference systems notes covering KV cache, batching, quantization, GPU profiling, model serving, and practical performance trade-offs.',
  ],
  [
    'courses/deep-learning-for-network-engineers/README.md',
    'Deep learning systems notes for network engineers covering training fundamentals, parallelism, collectives, RDMA, RoCE, and NCCL behavior.',
  ],
  [
    'systems-performance/README.md',
    'AI systems performance engineering notes covering GPU hardware, Linux and container tuning, CUDA, PyTorch, profiling, and distributed communication.',
  ],
  [
    'courses/cme295/README.md',
    'CME295 lecture notes on transformers, language models, and practical AI systems concepts with engineering-focused annotations.',
  ],
  [
    'training/README.md',
    'Distributed training notes covering MLPerf Training workloads, LLM training, mixture-of-experts, LoRA, scaling behavior, and system bottlenecks.',
  ],
  [
    'mlops/README.md',
    'Production MLOps guide covering lifecycle control, reproducibility, lineage, CI/CD/CT, feature stores, progressive delivery, monitoring, and LLMOps.',
  ],
  [
    'storage/README.md',
    'AI workload storage notes covering checkpoint data paths, ZFS, MLPerf Storage, storage benchmarking, and data pipeline performance.',
  ],
]);

const stopWords = new Set([
  'about',
  'after',
  'all',
  'also',
  'and',
  'are',
  'because',
  'before',
  'between',
  'but',
  'can',
  'chapter',
  'check',
  'content',
  'contents',
  'could',
  'data',
  'does',
  'each',
  'example',
  'for',
  'from',
  'have',
  'into',
  'learning',
  'more',
  'most',
  'note',
  'practical',
  'questions',
  'results',
  'only',
  'over',
  'section',
  'should',
  'summary',
  'such',
  'system',
  'table',
  'than',
  'that',
  'the',
  'their',
  'there',
  'these',
  'this',
  'through',
  'using',
  'was',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'were',
  'you',
  'your',
  '있는',
  '한다',
  '위해',
  '대한',
  '그리고',
  '또는',
  '에서',
  '으로',
]);

const weakConceptAliases = new Set([
  'benchmark',
  'gdr',
  'recovery',
  'verbs',
]);

const weakSingleHitAliases = new Set([
  ...weakConceptAliases,
  'attention',
  'checkpoint',
  'checkpointing',
  'collectives',
  'remote memory',
  'tail latency',
]);

await cleanGeneratedOutput();
await walk(sourceRoot);
await writeLlmsFiles();
await writeKnowledgeGraph();

async function cleanGeneratedOutput() {
  await rm(docsOut, { recursive: true, force: true });
  await mkdir(docsOut, { recursive: true });

  await Promise.all(
    bundleRoots.map((bundleRoot) =>
      rm(path.join(pagesOut, bundleRoot), { recursive: true, force: true }),
    ),
  );

  await mkdir(publicOut, { recursive: true });
  await Promise.all(
    generatedPublicRoots.map((entry) =>
      rm(path.join(publicOut, entry), { recursive: true, force: true }),
    ),
  );
  await rm(path.join(publicOut, 'llms.txt'), { force: true });
  await rm(path.join(publicOut, 'llms-full.txt'), { force: true });
  await rm(path.join(publicOut, 'kb', 'dcs-kb-graph.json'), { force: true });
  await rm(path.join(publicOut, 'kb', 'pages'), { recursive: true, force: true });
}

async function walk(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    const relative = toPosix(path.relative(sourceRoot, absolute));

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) continue;
      if (relative === 'network/ib-packets') continue;
      await walk(absolute);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.md' && shouldPublishMarkdown(relative)) {
      await publishMarkdown(absolute, relative);
      continue;
    }

    if (assetExtensions.has(ext) && shouldPublishAsset(relative)) {
      await publishAsset(absolute, relative);
      continue;
    }

    if (bundleExtensions.has(ext) && shouldPublishBundleFile(relative)) {
      await publishBundleFile(absolute, relative, entry.name);
    }
  }
}

function shouldPublishMarkdown(relative) {
  if (relative === 'AGENTS.md') return false;
  if (relative.startsWith('.')) return false;
  if (/\.(?:bak|backup)\.md$/i.test(relative)) return false;
  return relative === 'README.md' || docRoots.some((docRoot) => relative.startsWith(`${docRoot}/`));
}

function shouldPublishAsset(relative) {
  if (relative.startsWith('.')) return false;
  return publishedAssetRoots.some((docRoot) => relative === docRoot || relative.startsWith(`${docRoot}/`));
}

function shouldPublishBundleFile(relative) {
  if (relative.startsWith('.')) return false;
  return bundleRoots.some((bundleRoot) => relative.startsWith(`${bundleRoot}/`));
}

async function publishMarkdown(absolute, relative) {
  const source = await readFile(absolute, 'utf8');
  const isSiteHome = relative === 'README.md';
  const title = extractTitle(source, relative);
  const body = isSiteHome ? siteHomeBody() : rewriteMarkdown(stripLeadingTitle(source), relative);
  const description = isSiteHome
    ? 'A study wiki for AI data center networking, LLM inference, distributed training, MLOps, storage, and systems performance engineering.'
    : descriptionFrom(source, title, relative);
  const outRelative = markdownOutputPath(relative);
  const route = routeFromOutput(outRelative);
  const outAbsolute = path.join(docsOut, outRelative);
  const lastUpdated = await sourceLastUpdated(relative, absolute);
  const head = pageHeadEntries(route, isSiteHome);
  const editUrl = `${repositoryEditBase}${encodeURI(relative)}`;

  await mkdir(path.dirname(outAbsolute), { recursive: true });
  await writeFile(
    outAbsolute,
    [
      '---',
      `title: ${JSON.stringify(title)}`,
      ...(isSiteHome ? [] : [`slug: ${JSON.stringify(slugFromRoute(route))}`]),
      `description: ${JSON.stringify(description)}`,
      `editUrl: ${JSON.stringify(editUrl)}`,
      ...frontmatterHeadLines(head),
      ...(isSiteHome ? ['template: splash'] : []),
      `lastUpdated: ${lastUpdated}`,
      '---',
      '',
      body.trimStart(),
      '',
    ].join('\n'),
  );

  pages.push({
    title,
    sourcePath: relative,
    route,
    description,
    body: body.trim(),
  });
}

async function sourceLastUpdated(relative, absolute) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--follow', '--format=%cI', '--', relative],
      { cwd: sourceRoot, timeout: 10_000 },
    );
    const timestamp = stdout.trim();
    if (timestamp) return timestamp;
  } catch {
    // Fall back to filesystem metadata when Git history is unavailable.
  }

  const sourceStats = await stat(absolute);
  return sourceStats.mtime.toISOString();
}

function pageHeadEntries(route, isSiteHome) {
  const image = `${siteUrl}/og/${ogImageSlugFromRoute(route)}.png?v=${ogImageRevision}`;
  return [
    { tag: 'meta', attrs: { property: 'og:type', content: isSiteHome ? 'website' : 'article' } },
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
  ];
}

function frontmatterHeadLines(head) {
  return [`head: ${JSON.stringify(head)}`];
}

function ogImageSlugFromRoute(route) {
  const slug = slugFromRoute(route);
  return slug || 'index';
}

function siteHomeBody() {
  return String.raw`
<section class="adcs-home-hero">
  <div class="adcs-home-hero-copy">
    <p class="adcs-home-kicker">Study wiki</p>
    <h2>AI infrastructure notes for the places where models meet machines.</h2>
    <p>
      Networking, inference, training, MLOps, storage, and performance engineering notes organized as
      connected study tracks.
    </p>
    <div class="adcs-home-actions">
      <a href="/network/">Start with AI fabric</a>
      <a href="/inference/">Explore inference</a>
      <a href="/knowledge-graph-3d/">3D graph</a>
    </div>
  </div>
  <a class="adcs-home-hero-visual" href="/network/" aria-label="Open Network track">
    <img src="/fabric.svg" alt="Animated AI performance fabric" />
  </a>
</section>

<section class="adcs-track-grid" aria-label="Study tracks">
  <a class="adcs-track-card" href="/network/">
    <span>Network</span>
    <small>RDMA, InfiniBand, RoCE, Clos fabrics, telemetry, and congestion control.</small>
  </a>
  <a class="adcs-track-card" href="/gpu/">
    <span>GPU &amp; Accelerator Systems</span>
    <small>GPU architecture, CUDA, PMPP, profiling, and kernel case studies.</small>
  </a>
  <a class="adcs-track-card" href="/storage/">
    <span>Storage</span>
    <small>AI workload storage, ZFS, MLPerf Storage, and checkpoint data paths.</small>
  </a>
  <a class="adcs-track-card" href="/training/">
    <span>Training</span>
    <small>MLPerf Training, distributed training workloads, LLMs, MoE, and LoRA.</small>
  </a>
  <a class="adcs-track-card" href="/inference/">
    <span>Inference</span>
    <small>KV cache, batching, quantization, GPU profiling, and serving trade-offs.</small>
  </a>
  <a class="adcs-track-card" href="/mlops/">
    <span>MLOps</span>
    <small>Lifecycle control, lineage, CI/CD/CT, progressive delivery, and model monitoring.</small>
  </a>
  <a class="adcs-track-card" href="/systems-performance/">
    <span>Systems Performance</span>
    <small>GPU hardware, OS and container tuning, CUDA, PyTorch, and distributed communication.</small>
  </a>
  <a class="adcs-track-card" href="/courses/">
    <span>Courses</span>
    <small>CME295 and deep learning systems courses organized as sequential learning tracks.</small>
  </a>
</section>

## Labs and Talks

<section class="adcs-link-band" aria-label="Labs and talks">
  <a href="/network/clos-ebgp-lab/">Clos Fabric Lab Series</a>
  <a href="/network/ib-packet-analysis/">InfiniBand Packet Analysis</a>
  <a href="/network/rdma-examples/">RDMA Read/Write Examples</a>
  <a href="/talks/sr-iov-with-dgx-b200/">Making DGX B200 RDMA-ready</a>
</section>
`;
}

async function publishBundleFile(absolute, relative, fileName) {
  const outRoot = fileName === 'index.html' ? pagesOut : publicOut;
  const outAbsolute = path.join(outRoot, relative);
  await mkdir(path.dirname(outAbsolute), { recursive: true });
  await copyFile(absolute, outAbsolute);
}

async function publishAsset(absolute, relative) {
  const outAbsolute = path.join(publicOut, relative);
  await mkdir(path.dirname(outAbsolute), { recursive: true });
  await copyFile(absolute, outAbsolute);
}

function markdownOutputPath(relative) {
  if (relative === 'README.md') return 'index.md';
  if (relative.endsWith('/README.md')) {
    return `${relative.slice(0, -'/README.md'.length)}/index.md`;
  }
  if (relative.endsWith('.md')) {
    return `${relative.slice(0, -'.md'.length)}/index.md`;
  }
  return relative;
}

function routeFromOutput(outRelative) {
  if (outRelative === 'index.md') return '/';
  return `/${outRelative.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '/')}`.toLowerCase();
}

function slugFromRoute(route) {
  return route.replace(/^\//, '').replace(/\/$/, '');
}

function extractTitle(markdown, relative) {
  const firstLine = markdown.split(/\r?\n/, 1)[0] ?? '';
  const heading = firstLine.match(/^#\s+(.+?)\s*$/);
  if (heading) return heading[1].replace(/\s+#+$/, '').trim();

  const basename = path.basename(relative, '.md');
  if (basename.toLowerCase() === 'readme') {
    return titleCase(path.basename(path.dirname(relative)));
  }
  return titleCase(basename);
}

function descriptionFrom(markdown, title, relative) {
  const defaultDescription = defaultDescriptionsBySource.get(relative);
  if (defaultDescription) return defaultDescription;

  const frontmatterDescription = frontmatterField(markdown, 'description');
  if (frontmatterDescription) return truncateDescription(frontmatterDescription);

  const withoutTitle = stripLeadingTitle(stripFrontmatter(markdown));
  const candidate = paragraphBlocks(withoutTitle)
    .map(cleanDescriptionText)
    .find((text) => isUsefulDescription(text, title));

  return truncateDescription(candidate || `Study notes for ${title} in AI data center systems.`);
}

function frontmatterField(markdown, field) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return '';

  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => entry.match(new RegExp(`^${field}:\\s*`, 'i')));
  if (!line) return '';

  return line
    .replace(new RegExp(`^${field}:\\s*`, 'i'), '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function paragraphBlocks(markdown) {
  const blocks = [];
  let current = [];
  let inCodeBlock = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (!line.trim()) {
      pushCurrentBlock(blocks, current);
      current = [];
      continue;
    }

    if (isStructuralMarkdownLine(line)) {
      pushCurrentBlock(blocks, current);
      current = [];
      continue;
    }

    current.push(line.trim());
  }

  pushCurrentBlock(blocks, current);
  return blocks;
}

function pushCurrentBlock(blocks, current) {
  if (current.length > 0) {
    blocks.push(current.join(' '));
  }
}

function isStructuralMarkdownLine(line) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s+/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^\|/.test(trimmed) ||
    /^>/.test(trimmed) ||
    /^<img\b/i.test(trimmed) ||
    /^<\/?[a-z][^>]*>$/i.test(trimmed)
  );
}

function cleanDescriptionText(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulDescription(text, title) {
  if (!text || text.length < 48) return false;
  if (text.toLowerCase() === title.toLowerCase()) return false;
  if (/^table of contents\b/i.test(text)) return false;
  return /[.!?。]|[가-힣]/.test(text);
}

function truncateDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const shortened = text.slice(0, 157);
  return `${shortened.replace(/\s+\S*$/, '')}...`;
}

function stripLeadingTitle(markdown) {
  return markdown.replace(/^#\s+.+(?:\r?\n)+/, '');
}

function rewriteMarkdown(markdown, sourceRelative) {
  return markdown
    .replace(/(!\[[^\]]*\]\()([^)\s]+)([^)]*)(\))/g, (_, open, href, rest = '', close) => {
      if (shouldLeaveHref(href)) return `${open}${href}${rest}${close}`;
      if (isMarkdownHref(href)) return `${open}${href}${rest}${close}`;
      return `${open}${publicHref(href, sourceRelative)}${rest}${close}`;
    })
    .replace(/(\]\()([^)\s]+?)(README\.md)(#[^)]+)?(\))/g, (_, open, prefix, _readme, hash = '', close) => {
      if (isExternalLink(prefix)) return `${open}${prefix}README.md${hash}${close}`;
      return `${open}${routeFromSourceMarkdownHref(`${prefix}README.md`, sourceRelative)}${hash}${close}`;
    })
    .replace(/(\]\()([^)\s]+?\.md)(#[^)]+)?(\))/g, (_, open, href, hash = '', close) => {
      if (isExternalLink(href)) return `${open}${href}${hash}${close}`;
      if (href === 'AGENTS.md' || href.endsWith('/AGENTS.md')) {
        return `${open}https://github.com/ziwon/ai-data-center-systems/blob/main/${resolveSourceHref(
          href,
          sourceRelative,
        )}${hash}${close}`;
      }
      return `${open}${routeFromSourceMarkdownHref(href, sourceRelative)}${hash}${close}`;
    })
    .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/g, (_, open, src, close) => {
      if (shouldLeaveHref(src)) return `${open}${src}${close}`;
      return `${open}${publicHref(src, sourceRelative)}${close}`;
    });
}

function isExternalLink(href) {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href);
}

function shouldLeaveHref(href) {
  return isExternalLink(href) || href.startsWith('/');
}

function isMarkdownHref(href) {
  return href.endsWith('.md') || href.includes('.md#');
}

function publicHref(href, sourceRelative) {
  return `/${resolveSourceHref(href, sourceRelative)}`;
}

function resolveSourceHref(href, sourceRelative) {
  const sourceDir = sourceRelative === 'README.md' ? '' : path.posix.dirname(sourceRelative);
  return path.posix.normalize(path.posix.join(sourceDir, href));
}

function routeFromSourceMarkdownHref(href, sourceRelative) {
  return routeFromOutput(markdownOutputPath(resolveSourceHref(href, sourceRelative)));
}

function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function writeLlmsFiles() {
  pages.sort((a, b) => a.route.localeCompare(b.route));

  const llmsLines = [
    '# AI Data Center Systems',
    '',
    'AI data center networking, LLM inference, training, MLOps, storage, and systems performance engineering study notes.',
    '',
    '## Docs',
    '',
    ...pages.map((page) => `- [${page.title}](${siteUrl}${page.route}) - ${page.sourcePath}`),
    '',
  ];

  const fullLines = [
    '# AI Data Center Systems',
    '',
    'This file concatenates the source Markdown used to build the public documentation site.',
    '',
    ...pages.flatMap((page) => [
      `## ${page.title}`,
      '',
      `Source: ${page.sourcePath}`,
      `URL: ${siteUrl}${page.route}`,
      '',
      page.body,
      '',
    ]),
  ];

  await writeFile(path.join(publicOut, 'llms.txt'), llmsLines.join('\n'));
  await writeFile(path.join(publicOut, 'llms-full.txt'), fullLines.join('\n'));
}

async function writeKnowledgeGraph() {
  const concepts = await readConceptCatalog();
  const routeByKey = new Map(pages.map((page) => [normalizeRoute(page.route), page.route]));
  const nodeTerms = new Map();
  const documentFrequency = new Map();

  for (const page of pages) {
    const terms = termFrequency(page);
    nodeTerms.set(page.route, terms);
    for (const term of terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const nodes = pages.map((page) => {
    const keywords = topKeywords(nodeTerms.get(page.route), documentFrequency, pages.length, 10);
    return {
      id: page.route,
      title: page.title,
      route: page.route,
      group: groupFromRoute(page.route),
      keywords: keywords.map((keyword) => keyword.term),
      excerpt: page.description,
    };
  });

  const nodeByRoute = new Map(nodes.map((node) => [node.route, node]));
  const conceptNodes = concepts.map((concept) => ({
    id: conceptNodeId(concept.id),
    kind: 'concept',
    title: concept.label,
    label: concept.label,
    group: concept.group,
    description: concept.description,
    keywords: concept.aliases.slice(0, 8),
  }));
  const conceptById = new Map(conceptNodes.map((concept) => [concept.id, concept]));
  const pageConcepts = new Map(
    pages.map((page) => [page.route, matchConcepts(page, concepts)]),
  );
  const idfByTerm = new Map(
    [...documentFrequency].map(([term, count]) => [
      term,
      Math.log((pages.length + 1) / (count + 1)) + 1,
    ]),
  );
  const edgeScores = new Map();

  for (const page of pages) {
    for (const targetRoute of extractInternalLinks(page, routeByKey)) {
      if (targetRoute === page.route) continue;
      addEdge(edgeScores, page.route, targetRoute, 'link', 1, []);
    }
  }

  let vectors = null;
  if (isEmbeddingEnabled()) {
    try {
      vectors = await embedDocuments(
        pages.map((page) => ({ key: page.route, text: embeddingText(page) })),
      );
    } catch (error) {
      console.warn(`[embeddings] disabled; falling back to keyword edges: ${error?.message ?? error}`);
      vectors = null;
    }
  }

  if (vectors) {
    addSemanticEdges(edgeScores, pages, vectors, nodeByRoute);
  } else {
    addKeywordEdges(edgeScores, pages, nodeTerms, idfByTerm, nodeByRoute);
  }

  for (const [route, matches] of pageConcepts) {
    for (const match of matches) {
      const weight = Math.min(0.95, 0.78 + Math.min(match.count, 6) * 0.025);
      addEdge(edgeScores, route, conceptNodeId(match.id), 'mentions', weight, match.aliases.slice(0, 4));
    }
  }

  for (const page of pages) {
    const siblings = pages
      .filter((candidate) => candidate.route !== page.route && groupFromRoute(candidate.route) === groupFromRoute(page.route))
      .slice(0, 3);
    for (const sibling of siblings) {
      addEdge(edgeScores, page.route, sibling.route, 'section', 0.18, []);
    }
  }

  const edges = [...edgeScores.values()]
    .filter((edge) => edge.source !== edge.target)
    .sort(compareEdges);

  await mkdir(path.join(publicOut, 'kb'), { recursive: true });
  await writeGlobalGraph(nodes, conceptNodes, edges);
  await writePageGraphs(nodes, conceptNodes, edges, nodeByRoute, conceptById);
}

async function writeGlobalGraph(nodes, conceptNodes, edges) {
  const graphEdges = capGlobalEdges(edges);
  const degree = new Map();
  const weightedDegree = new Map();

  for (const edge of graphEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    weightedDegree.set(edge.source, (weightedDegree.get(edge.source) ?? 0) + edge.weight);
    weightedDegree.set(edge.target, (weightedDegree.get(edge.target) ?? 0) + edge.weight);
  }

  const globalNodes = [
    ...nodes.map((node) => ({
      id: node.id,
      kind: 'doc',
      title: node.title,
      route: node.route,
      group: node.group,
      degree: degree.get(node.id) ?? 0,
      weightedDegree: roundWeight(weightedDegree.get(node.id) ?? 0),
    })),
    ...conceptNodes.map((node) => ({
      id: node.id,
      kind: 'concept',
      title: node.title,
      group: node.group,
      description: node.description,
      degree: degree.get(node.id) ?? 0,
      weightedDegree: roundWeight(weightedDegree.get(node.id) ?? 0),
    })),
  ];

  const globalGraph = {
    version: 1,
    generatedAt: new Date().toISOString(),
    nodes: globalNodes,
    edgeTypes: [...new Set(graphEdges.map((edge) => edge.type))].sort(),
    edges: compactGlobalEdges(globalNodes, graphEdges),
  };

  await writeFile(
    path.join(publicOut, 'kb', 'dcs-kb-graph.json'),
    `${JSON.stringify(globalGraph)}\n`,
  );
}

function compactGlobalEdges(nodes, edges) {
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const edgeTypeIndex = new Map([...new Set(edges.map((edge) => edge.type))].sort().map((type, index) => [type, index]));
  return edges
    .map((edge) => ({
      s: nodeIndex.get(edge.source),
      t: nodeIndex.get(edge.target),
      k: edgeTypeIndex.get(edge.type),
      w: edge.weight,
    }))
    .filter((edge) => edge.s !== undefined && edge.t !== undefined && edge.k !== undefined);
}

function capGlobalEdges(edges) {
  const mentions = edges.filter((edge) => edge.type.includes('mentions'));
  const links = edges.filter((edge) => !edge.type.includes('mentions') && edge.type.includes('link'));
  const rest = edges.filter((edge) => !edge.type.includes('mentions') && !edge.type.includes('link'));
  const cappedRest = capEdgesByNode(rest, 7);
  const unique = new Map();

  for (const edge of [...mentions, ...links, ...cappedRest].sort(compareEdges)) {
    unique.set(`${edge.source} ${edge.target}`, edge);
  }
  return [...unique.values()].sort(compareEdges);
}

function capEdgesByNode(edges, limit) {
  const selected = new Map();
  const byNode = new Map();
  for (const edge of edges.sort(compareEdges)) {
    if (!byNode.has(edge.source)) byNode.set(edge.source, []);
    if (!byNode.has(edge.target)) byNode.set(edge.target, []);
    byNode.get(edge.source).push(edge);
    byNode.get(edge.target).push(edge);
  }

  for (const [, nodeEdges] of byNode) {
    for (const edge of nodeEdges.slice(0, limit)) {
      selected.set(`${edge.source} ${edge.target}`, edge);
    }
  }
  return [...selected.values()].sort(compareEdges);
}

async function readConceptCatalog() {
  const source = await readFile(conceptsPath, 'utf8').catch(() => '[]');
  const parsed = JSON.parse(source);
  return parsed
    .map((concept) => ({
      id: String(concept.id || '').trim(),
      label: String(concept.label || concept.id || '').trim(),
      group: String(concept.group || 'concept').trim(),
      description: String(concept.description || '').trim(),
      aliases: [
        String(concept.label || concept.id || '').trim(),
        ...(concept.aliases ?? []).map((alias) => String(alias).trim()),
      ].filter((alias, index, aliases) => alias && aliases.indexOf(alias) === index && !weakConceptAliases.has(alias.toLowerCase())),
    }))
    .filter((concept) => concept.id && concept.label && concept.aliases.length > 0);
}

function matchConcepts(page, concepts) {
  const text = searchableText(page);
  return concepts
    .map((concept) => {
      const hits = concept.aliases
        .map((alias) => ({ alias, count: aliasMatchCount(text, alias) }))
        .filter((hit) => hit.count > 0);
      if (hits.length === 0) return null;

      const count = hits.reduce((sum, hit) => sum + hit.count, 0);
      const hasDistinctiveAlias = hits.some((hit) => isDistinctiveConceptAlias(hit.alias));
      if (count < 2 && !hasDistinctiveAlias) return null;

      return {
        ...concept,
        aliases: hits.sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias)).map((hit) => hit.alias),
        count,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || b.aliases.length - a.aliases.length || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function searchableText(page) {
  return [
    page.title,
    page.body.replace(/```[\s\S]*?```/g, ' '),
  ]
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function aliasMatchCount(text, alias) {
  const normalized = alias.toLowerCase().trim();
  if (!normalized) return 0;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9][a-z0-9 .+/#-]*$/i.test(normalized)) {
    return [...text.matchAll(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'gi'))].length;
  }
  let count = 0;
  let index = text.indexOf(normalized);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(normalized, index + normalized.length);
  }
  return count;
}

function isDistinctiveConceptAlias(alias) {
  const normalized = alias.trim();
  const lower = normalized.toLowerCase();
  if (!normalized || weakSingleHitAliases.has(lower)) return false;
  return (
    /[\s/+.-]/.test(normalized) ||
    /^[A-Z0-9]{3,}$/.test(normalized) ||
    /[A-Z][a-z]+[A-Z]/.test(normalized)
  );
}

function termFrequency(page) {
  const text = [
    page.title,
    page.title,
    page.body.replace(/```[\s\S]*?```/g, ' '),
  ]
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s./+-]/gu, ' ');
  const terms = new Map();
  for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}./+-]{1,}/gu) ?? []) {
    const term = normalizeTerm(raw);
    if (term.length < 3 && !/^[가-힣]{2,}$/u.test(term)) continue;
    if (!term || stopWords.has(term)) continue;
    terms.set(term, (terms.get(term) ?? 0) + 1);
  }
  return terms;
}

function normalizeTerm(term) {
  const normalized = term
    .toLowerCase()
    .replace(/^[-./+]+|[-./+]+$/g, '')
    .trim();
  const withoutLongSuffix = normalized.replace(
    /(?:에서|으로|에게|보다|부터|까지|처럼|마다|이다|이며|이고|하고|되는|된다|한다|하여|해서|하면|들과|들의)$/u,
    '',
  );
  if (withoutLongSuffix.length > 3) {
    return withoutLongSuffix.replace(/(?:은|는|이|가|을|를|의|에|로|도|만|와|과)$/u, '');
  }
  return withoutLongSuffix;
}

function topKeywords(terms, documentFrequency, documentCount, limit) {
  return [...terms.entries()]
    .map(([term, count]) => ({
      term,
      score: count * (Math.log((documentCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1),
    }))
    .filter((keyword) => keyword.term.length > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function addSemanticEdges(edgeScores, pages, vectors, nodeByRoute) {
  const selectedPairs = new Set();
  for (const page of pages) {
    const sourceVector = vectors.get(page.route);
    if (!sourceVector) continue;

    pages
      .filter((target) => target.route !== page.route && vectors.has(target.route))
      .map((target) => ({
        target: target.route,
        score: dotProduct(sourceVector, vectors.get(target.route)),
        shared: sharedKeywordsBetween(page.route, target.route, nodeByRoute),
      }))
      .filter((candidate) => candidate.score >= 0.55)
      .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target))
      .slice(0, 6)
      .forEach((candidate) => {
        const key = edgeKey(page.route, candidate.target);
        if (selectedPairs.has(key)) return;
        selectedPairs.add(key);
        addEdge(
          edgeScores,
          page.route,
          candidate.target,
          'semantic',
          Math.min(0.9, Math.max(0.3, candidate.score)),
          candidate.shared.slice(0, 4),
        );
      });
  }
}

function addKeywordEdges(edgeScores, pages, nodeTerms, idfByTerm, nodeByRoute) {
  const selectedPairs = new Set();
  for (const page of pages) {
    const candidates = [];
    for (const target of pages) {
      if (target.route === page.route) continue;
      const score = relatedness(nodeTerms.get(page.route), nodeTerms.get(target.route), idfByTerm);
      if (score <= 0) continue;
      candidates.push({
        target: target.route,
        score,
        shared: sharedKeywordsBetween(page.route, target.route, nodeByRoute),
      });
    }

    candidates
      .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target))
      .slice(0, 5)
      .forEach((candidate) => {
        const key = edgeKey(page.route, candidate.target);
        if (selectedPairs.has(key)) return;
        selectedPairs.add(key);
        addEdge(
          edgeScores,
          page.route,
          candidate.target,
          'keyword',
          Math.min(0.82, Math.max(0.22, candidate.score)),
          candidate.shared.slice(0, 4),
        );
      });
  }
}

function sharedKeywordsBetween(sourceRoute, targetRoute, nodeByRoute) {
  const sourceKeywords = new Set(nodeByRoute.get(sourceRoute)?.keywords ?? []);
  return (nodeByRoute.get(targetRoute)?.keywords ?? []).filter((term) => sourceKeywords.has(term));
}

function edgeKey(source, target) {
  return source.localeCompare(target) <= 0 ? `${source} ${target}` : `${target} ${source}`;
}

function dotProduct(source, target) {
  if (!source || !target || source.length !== target.length) return 0;
  return source.reduce((sum, value, index) => sum + value * target[index], 0);
}

function embeddingText(page) {
  const headings = [...page.body.matchAll(/^#{1,3}\s+(.+)$/gm)]
    .map((match) => match[1])
    .slice(0, 16);
  return [
    page.title,
    ...headings,
    page.description,
  ]
    .join('\n')
    .slice(0, 6000);
}

function relatedness(sourceTerms, targetTerms, idfByTerm) {
  if (!sourceTerms || !targetTerms) return 0;
  let sharedScore = 0;
  let sourceScore = 0;
  let targetScore = 0;

  for (const [term, count] of sourceTerms) {
    const idf = idfByTerm.get(term) ?? 1;
    sourceScore += Math.min(count, 8) * idf;
    if (targetTerms.has(term)) {
      sharedScore += Math.min(count, targetTerms.get(term), 8) * idf;
    }
  }
  for (const [term, count] of targetTerms) {
    const idf = idfByTerm.get(term) ?? 1;
    targetScore += Math.min(count, 8) * idf;
  }

  const denominator = Math.sqrt(sourceScore * targetScore);
  return denominator === 0 ? 0 : sharedScore / denominator;
}

function extractInternalLinks(page, routeByKey) {
  const links = new Set();
  const patterns = [
    /\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']+["'])?\)/g,
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/g,
  ];

  for (const pattern of patterns) {
    for (const match of page.body.matchAll(pattern)) {
      const route = routeFromHref(match[1], page.route, routeByKey);
      if (route) links.add(route);
    }
  }
  return links;
}

function routeFromHref(href, sourceRoute, routeByKey) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|#|mailto:)/i.test(href)) return '';
  const [cleanHref] = href.split(/[?#]/, 1);
  if (!cleanHref || assetExtensions.has(path.extname(cleanHref).toLowerCase())) return '';

  const baseRoute = sourceRoute.endsWith('/') ? sourceRoute : `${sourceRoute}/`;
  const rawRoute = cleanHref.startsWith('/')
    ? cleanHref
    : `/${path.posix.normalize(path.posix.join(baseRoute, cleanHref))}`;
  const normalized = normalizeRoute(rawRoute.replace(/README\.md$/i, '').replace(/\.md$/i, '/'));
  return routeByKey.get(normalized) ?? '';
}

function addEdge(edgeScores, source, target, type, weight, terms) {
  const [a, b] = source.localeCompare(target) <= 0 ? [source, target] : [target, source];
  const key = `${a} ${b}`;
  const previous = edgeScores.get(key);
  if (!previous) {
    edgeScores.set(key, { source: a, target: b, type, weight: roundWeight(weight), terms });
    return;
  }

  previous.weight = roundWeight(Math.min(1, previous.weight + weight * 0.65));
  if (!previous.type.includes(type)) previous.type = `${previous.type}+${type}`;
  previous.terms = [...new Set([...(previous.terms ?? []), ...terms])].slice(0, 6);
}

function normalizeRoute(route) {
  if (!route) return '/';
  const normalized = `/${route}`.replace(/\/+/g, '/').toLowerCase();
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function groupFromRoute(route) {
  const [first, second] = route.replace(/^\/|\/$/g, '').split('/');
  if (first === 'courses' && second) return `${first}/${second}`;
  return first || 'home';
}

async function writePageGraphs(nodes, conceptNodes, edges, nodeByRoute, conceptById) {
  const pageOut = path.join(publicOut, 'kb', 'pages');
  await mkdir(pageOut, { recursive: true });

  await Promise.all(nodes.map(async (current) => {
    const localEdges = edges
      .filter((edge) => edge.source === current.id || edge.target === current.id)
      .sort(compareEdges)
      .slice(0, 10);
    const localIds = new Set([current.id]);
    for (const edge of localEdges) {
      localIds.add(edge.source === current.id ? edge.target : edge.source);
    }

    const currentConceptIds = edges
      .filter((edge) => edge.type.includes('mentions') && edge.source === current.id)
      .sort(compareEdges)
      .slice(0, 8)
      .map((edge) => edge.target);
    for (const conceptId of currentConceptIds) {
      localIds.add(conceptId);
    }

    for (const conceptId of currentConceptIds) {
      const conceptDocs = edges
        .filter((edge) => edge.type.includes('mentions') && edge.target === conceptId && edge.source !== current.id)
        .sort(compareEdges)
        .slice(0, 4);
      for (const edge of conceptDocs) {
        localIds.add(edge.source);
      }
    }

    const localNodes = [...localIds]
      .map((id) => nodeByRoute.get(id) ?? conceptById.get(id))
      .filter(Boolean);
    const localGraph = {
      version: 1,
      current,
      nodes: localNodes,
      edges: edges.filter((edge) => localIds.has(edge.source) && localIds.has(edge.target)),
    };

    await writeFile(
      path.join(pageOut, `${routeGraphKey(current.route)}.json`),
      `${JSON.stringify(localGraph, null, 2)}\n`,
    );
  }));
}

function conceptNodeId(id) {
  return `concept:${id}`;
}

function compareEdges(a, b) {
  return b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target);
}

function routeGraphKey(route) {
  const normalized = normalizeRoute(route);
  if (normalized === '/') return 'index';
  return normalized
    .replace(/^\/|\/$/g, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%/g, '~'))
    .join('__')
    .toLowerCase();
}

function roundWeight(value) {
  return Math.round(value * 1000) / 1000;
}

function shouldIgnoreDirectory(name) {
  return ignoredDirs.has(name) || /^\.?venv(?:$|[-_.])/.test(name);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
