// Regenerates the article lists from article frontmatter.
//   npm run articles:index   rewrite articles/README.md and the topic README sections
//   npm run articles:check   fail (for CI) when any list is out of date
//
// Each list lives between <!-- articles:start ... --> and <!-- articles:end --> markers, so the
// hand-written text around it is kept. A topic README needs the markers once it has an article.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articleTopics,
  articlesDirectory,
  groupArticles,
  loadArticles,
  topicLabels,
} from './lib/articles.mjs';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkOnly = process.argv.includes('--check');
const startMarker = /<!-- articles:start[^>]*-->/;
const endMarker = '<!-- articles:end -->';

const groups = groupArticles(await loadArticles(sourceRoot));
const targets = [
  { file: `${articlesDirectory}/README.md`, list: indexList(groups), required: true },
  ...[...articleTopics.keys()].map((topic) => {
    const related = groups.filter((group) => group.topics.includes(topic));
    return { file: `${topic}/README.md`, list: topicList(related), required: related.length > 0 };
  }),
];

const stale = [];
const problems = [];
for (const target of targets) {
  const absolute = path.join(sourceRoot, target.file);
  const current = await readFile(absolute, 'utf8').catch(() => null);
  if (current === null || !startMarker.test(current) || !current.includes(endMarker)) {
    if (target.required) problems.push(`${target.file} needs the article list markers.`);
    continue;
  }
  const next = replaceList(current, target.list);
  if (next === current) continue;
  stale.push(target.file);
  if (!checkOnly) await writeFile(absolute, next);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (checkOnly && stale.length) {
  console.error(`Article lists are out of date: ${stale.join(', ')}\nRun \`npm run articles:index\` in .site.`);
  process.exit(1);
}
console.log(
  checkOnly
    ? `Article lists are up to date (${groups.length} articles).`
    : `Updated ${stale.length} file(s) for ${groups.length} articles${stale.length ? `: ${stale.join(', ')}` : '.'}`,
);

function replaceList(markdown, list) {
  const start = markdown.match(startMarker);
  const before = markdown.slice(0, start.index + start[0].length);
  const after = markdown.slice(markdown.indexOf(endMarker, start.index));
  return `${before}\n\n${list}\n\n${after}`;
}

function alternateLinks(group, prefix) {
  return group.alternates.map((version) =>
    `[${version.language === 'en' ? 'English' : '한국어'}](${prefix}${version.file})`,
  );
}

// Blog-style index: title, date and topics, then the summary.
function indexList(entries) {
  return entries
    .map((group) => {
      const meta = [group.date, topicLabels(group.topics).join(', '), ...alternateLinks(group, '')];
      return [`### [${group.title}](${group.file})`, '', meta.join(' · '), '', group.description].join('\n');
    })
    .join('\n\n');
}

// Topic README: compact list linking into ../articles/.
function topicList(entries) {
  if (!entries.length) return '_아직 이 분야의 아티클이 없습니다._';
  const prefix = `../${articlesDirectory}/`;
  return entries
    .map((group) =>
      [`- [${group.title}](${prefix}${group.file})`, ...alternateLinks(group, prefix)].join(' · '),
    )
    .join('\n');
}
