// Shared reader for the repository's blog/ folder (one Markdown file per post).
// Used by blog-index.mjs (README lists) and sync-starlight-docs.mjs (site pages and RSS).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const blogDirectory = 'blog';

// Post files are named YYYY-MM-DD-slug.md (or .ko.md); the date is the publish date.
const postFilePattern = /^(\d{4}-\d{2}-\d{2})-(.+?)(\.ko)?\.md$/;

// The site URL drops the date: blog/2026-11-01-x.ko.md is served at /blog/x.ko/.
export function postSlug(fileName) {
  const match = fileName.match(postFilePattern);
  return match ? `${match[2]}${match[3] ?? ''}` : fileName.replace(/\.md$/, '');
}

// Article `topics` must name one of the site's topic folders.
export const articleTopics = new Map([
  ['network', 'Network'],
  ['gpu', 'GPU'],
  ['storage', 'Storage'],
  ['training', 'Training'],
  ['inference', 'Inference'],
  ['mlops', 'MLOps'],
  ['systems-performance', 'Systems Performance'],
]);

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

// Reads the small frontmatter subset that blog posts use: scalars, "quoted strings", and [a, b] lists.
export function parseFrontmatter(markdown) {
  const match = markdown.match(frontmatterPattern);
  if (!match) return { data: {}, body: markdown };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    const [, key, raw] = field;
    data[key] = parseValue(raw.trim());
  }
  return { data, body: markdown.slice(match[0].length).replace(/^\s*\n/, '') };
}

function parseValue(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  return unquote(raw);
}

function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export function articleTitle(body) {
  return body.match(/^#\s+(.+?)\s*$/m)?.[1].trim() ?? '';
}

// Loads every article, newest first. Throws one error that lists every invalid file.
export async function loadArticles(sourceRoot) {
  const directory = path.join(sourceRoot, blogDirectory);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();

  const articles = [];
  const problems = [];
  for (const file of files) {
    const markdown = await readFile(path.join(directory, file), 'utf8');
    const { data, body } = parseFrontmatter(markdown);
    const title = articleTitle(body);
    const topics = Array.isArray(data.topics) ? data.topics : [];
    const where = `${blogDirectory}/${file}`;
    const named = file.match(postFilePattern);

    if (!named || Number.isNaN(Date.parse(named[1]))) {
      problems.push(`${where}: file name must start with the publish date, e.g. 2026-11-01-slug.md`);
    }
    if (data.date !== undefined) {
      problems.push(`${where}: remove the date field; the publish date comes from the file name`);
    }
    if (!topics.length) problems.push(`${where}: topics must list at least one topic`);
    for (const topic of topics) {
      if (!articleTopics.has(topic)) {
        problems.push(`${where}: unknown topic "${topic}" (use ${[...articleTopics.keys()].join(', ')})`);
      }
    }
    if (!data.description) problems.push(`${where}: description is required`);
    if (!title) problems.push(`${where}: the first heading must be the "# Title"`);

    articles.push({
      file,
      relative: where,
      key: named ? named[2] : file,
      language: file.endsWith('.ko.md') ? 'ko' : 'en',
      title,
      date: named?.[1],
      topics,
      description: data.description,
    });
  }

  if (problems.length) {
    throw new Error(`Invalid blog post frontmatter:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  }
  return articles.sort(compareArticles);
}

// Newest first; a Korean and English pair stays together with the Korean version first.
function compareArticles(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    a.key.localeCompare(b.key) ||
    (a.language === b.language ? 0 : a.language === 'ko' ? -1 : 1)
  );
}

// One entry per article; a Korean and English pair (x.ko.md + x.md) shares an entry led by Korean.
export function groupArticles(articles) {
  const groups = new Map();
  for (const article of articles) {
    const group = groups.get(article.key) ?? { key: article.key, versions: [] };
    group.versions.push(article);
    groups.set(article.key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const primary = group.versions.find((version) => version.language === 'ko') ?? group.versions[0];
      return {
        ...primary,
        alternates: group.versions.filter((version) => version !== primary),
      };
    })
    .sort(compareArticles);
}

export function topicLabels(topics) {
  return topics.map((topic) => articleTopics.get(topic) ?? topic);
}
