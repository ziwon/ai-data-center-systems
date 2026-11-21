// Shared reader for the repository's articles/ folder.
// Used by article-index.mjs (README lists) and sync-starlight-docs.mjs (site pages and RSS).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const articlesDirectory = 'articles';

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

// Reads the small frontmatter subset that articles use: scalars, "quoted strings", and [a, b] lists.
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
  const directory = path.join(sourceRoot, articlesDirectory);
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
    const where = `${articlesDirectory}/${file}`;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? '')) problems.push(`${where}: date must be YYYY-MM-DD`);
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
      key: file.replace(/(\.ko)?\.md$/, ''),
      language: file.endsWith('.ko.md') ? 'ko' : 'en',
      title,
      date: data.date,
      topics,
      description: data.description,
    });
  }

  if (problems.length) {
    throw new Error(`Invalid article frontmatter:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
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
