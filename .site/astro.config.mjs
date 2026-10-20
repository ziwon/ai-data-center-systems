import { defineConfig } from 'astro/config';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import starlightGitHubAlerts from 'starlight-github-alerts';
import starlightImageZoom from 'starlight-image-zoom';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import { legacyMappings, legacyRoutePrefixes } from './scripts/route-mappings.mjs';

const googleAnalyticsId = getGoogleTagId('PUBLIC_GA_MEASUREMENT_ID', /^G-[A-Z0-9]+$/);
const googleAdSenseClient =
  getGoogleTagId('PUBLIC_GOOGLE_ADSENSE_CLIENT', /^ca-pub-\d+$/) ?? 'ca-pub-8128231647578658';
const legacyRedirects = buildLegacyRedirects(legacyMappings);

function buildLegacyRedirects(mappings) {
  return Object.fromEntries(
    mappings.flatMap(({ from, to }) => {
      const docsDirectory = fileURLToPath(
        new URL(`./src/content/docs${to}/`, import.meta.url),
      );
      return collectDocumentSuffixes(docsDirectory).map((suffix) => [
        `${from}${suffix ? `/${suffix}` : ''}`,
        `${to}${suffix ? `/${suffix}` : ''}/`,
      ]);
    }),
  );
}

function collectDocumentSuffixes(directory, segments = []) {
  const suffixes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      suffixes.push(...collectDocumentSuffixes(path.join(directory, entry.name), [...segments, entry.name]));
    } else if (entry.isFile() && /^index\.mdx?$/.test(entry.name)) {
      suffixes.push(segments.join('/').toLowerCase());
    }
  }
  return suffixes;
}

function getGoogleTagId(name, pattern) {
  const value = process.env[name]?.trim();
  return value && pattern.test(value) ? value : undefined;
}

function googleAnalyticsHeadEntries(measurementId) {
  if (!measurementId) {
    return [];
  }

  return [
    {
      tag: 'script',
      attrs: {
        async: true,
        src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`,
      },
    },
    {
      tag: 'script',
      content: `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${measurementId}');
      `,
    },
  ];
}

function googleAdSenseHeadEntries(client) {
  if (!client) {
    return [];
  }

  return [
    {
      tag: 'script',
      attrs: {
        async: true,
        crossorigin: 'anonymous',
        src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
      },
    },
  ];
}

export default defineConfig({
  site: 'https://adcs.restack.tech',
  trailingSlash: 'always',
  redirects: legacyRedirects,
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
  vite: {
    optimizeDeps: {
      include: ['d3-drag', 'd3-force', 'd3-selection', 'd3-zoom'],
    },
  },
  integrations: [
    mermaid(),
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname.replace(/\/$/, '');
        return (
          !pathname.startsWith('/admin') &&
          !legacyRoutePrefixes.some(
            (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
          )
        );
      },
    }),
    starlight({
      plugins: [
        starlightGitHubAlerts(),
        starlightImageZoom(),
        starlightSidebarTopics(
          [
            {
              label: 'Network',
              link: '/network/',
              icon: 'random',
              attrs: { 'aria-label': 'Network', title: 'Network' },
              items: [{ autogenerate: { directory: 'network', collapsed: true } }],
            },
            {
              label: 'GPU & Accelerator Systems',
              link: '/gpu/',
              icon: 'laptop',
              attrs: {
                'aria-label': 'GPU & Accelerator Systems',
                title: 'GPU & Accelerator Systems',
              },
              items: [{ autogenerate: { directory: 'gpu', collapsed: true } }],
            },
            {
              label: 'Storage',
              link: '/storage/',
              icon: 'database',
              attrs: { 'aria-label': 'Storage', title: 'Storage' },
              items: [{ autogenerate: { directory: 'storage', collapsed: true } }],
            },
            {
              label: 'Training',
              link: '/training/',
              icon: 'analytics',
              attrs: { 'aria-label': 'Training', title: 'Training' },
              items: [{ autogenerate: { directory: 'training' } }],
            },
            {
              label: 'Inference',
              link: '/inference/',
              icon: 'puzzle',
              attrs: {
                'aria-label': 'Inference',
                title: 'Inference',
                'data-topic-icon': 'brain',
              },
              items: [{ autogenerate: { directory: 'inference', collapsed: true } }],
            },
            {
              label: 'MLOps',
              link: '/mlops/',
              icon: 'random',
              attrs: {
                'aria-label': 'MLOps',
                title: 'MLOps',
                'data-topic-icon': 'cycle',
              },
              items: [{ autogenerate: { directory: 'mlops', collapsed: true } }],
            },
            {
              label: 'Systems Performance',
              link: '/systems-performance/',
              icon: 'rocket',
              attrs: { 'aria-label': 'Systems Performance', title: 'Systems Performance' },
              items: [{ autogenerate: { directory: 'systems-performance', collapsed: true } }],
            },
            {
              label: 'Courses',
              link: '/courses/',
              icon: 'open-book',
              attrs: { 'aria-label': 'Courses', title: 'Courses' },
              items: [{ autogenerate: { directory: 'courses', collapsed: true } }],
            },
          ],
        ),
      ],
      title: 'AI Data Center Systems',
      description:
        'AI data center networking, LLM inference, training, MLOps, storage, and systems performance engineering study notes.',
      favicon: '/favicon.svg',
      routeMiddleware: './src/topic-navigation.ts',
      components: {
        Header: './src/components/Header.astro',
        PageFrame: './src/components/PageFrame.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        Sidebar: './src/components/Sidebar.astro',
      },
      head: [
        ...googleAnalyticsHeadEntries(googleAnalyticsId),
        ...googleAdSenseHeadEntries(googleAdSenseClient),
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://adcs.restack.tech/og.png' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:type', content: 'website' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:width', content: '1200' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:height', content: '630' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://adcs.restack.tech/og.png' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/ziwon/ai-data-center-systems/edit/main/.site/',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/ziwon/ai-data-center-systems',
        },
      ],
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 2,
      },
    }),
  ],
});
