// Regenerates the blog post lists from post frontmatter.
//   npm run blog:index   rewrite blog/README.md and the topic README sections
//   npm run blog:check   fail (for CI) when any list is out of date
//
// Each list lives between <!-- blog:start ... --> and <!-- blog:end --> markers, so the
// hand-written text around it is kept. A topic README needs the markers once it has a post.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articleTopics,
  blogDirectory,
  groupArticles,
  loadArticles,
  topicLabels,
} from './lib/blog.mjs';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkOnly = process.argv.includes('--check');
const startMarker = /<!-- blog:start[^>]*-->/;
const endMarker = '<!-- blog:end -->';

const groups = groupArticles(await loadArticles(sourceRoot));
const targets = [
  { file: `${blogDirectory}/README.md`, list: indexList(groups), required: true },
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
    if (target.required) problems.push(`${target.file} needs the blog list markers.`);
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
  console.error(`Blog lists are out of date: ${stale.join(', ')}\nRun \`npm run blog:index\` in .site.`);
  process.exit(1);
}
console.log(
  checkOnly
    ? `Blog lists are up to date (${groups.length} posts).`
    : `Updated ${stale.length} file(s) for ${groups.length} posts${stale.length ? `: ${stale.join(', ')}` : '.'}`,
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

// Topic README: compact list linking into ../blog/.
function topicList(entries) {
  if (!entries.length) return '_아직 이 분야의 블로그 글이 없습니다._';
  const prefix = `../${blogDirectory}/`;
  return entries
    .map((group) =>
      [`- [${group.title}](${prefix}${group.file})`, ...alternateLinks(group, prefix)].join(' · '),
    )
    .join('\n');
}
