import { getCollection } from 'astro:content';
import { ogResponse, ogSiteTitle, renderOgCard } from '../../lib/og-card';

export const prerender = true;

export async function getStaticPaths() {
  const docs = await getCollection('docs');

  // The not-found page is noindex and never shared, so it gets no card.
  return docs.filter((entry) => entry.id !== '404').map((entry) => {
    const routeSlug = routeSlugFromEntry(entry);

    return {
      params: { slug: routeSlug || 'index' },
      props: {
        // Inline-code backticks are Markdown, not part of the title.
        title: entry.data.title.replace(/`/g, ''),
        description: entry.data.description,
        eyebrow: eyebrowFor(routeSlug, entry.data.editUrl),
        site: !routeSlug || entry.data.title === ogSiteTitle,
      },
    };
  });
}

export async function GET({ props }) {
  return ogResponse(await renderOgCard(props));
}

function routeSlugFromEntry(entry) {
  return String(entry.data.slug || entry.id.replace(/(^|\/)index\.md$/, '').replace(/\.md$/, ''))
    .replace(/^\/+|\/+$/g, '');
}

// The section a page sits in: "gpu/pmpp/lec02" reads GPU / PMPP, a section
// index names itself, and a blog post carries its publish date from the
// source file name.
function eyebrowFor(routeSlug, editUrl) {
  const parts = routeSlug.split('/').filter(Boolean);
  if (!parts.length) return '';
  if (parts[0] === 'blog') {
    const date = String(editUrl || '').match(/\/blog\/(\d{4}-\d{2}-\d{2})-/)?.[1];
    return date ? `Blog · ${date}` : 'Blog';
  }
  const trail = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)) : parts;
  return trail.map((part) => part.replace(/[-_]+/g, ' ')).join(' / ');
}
