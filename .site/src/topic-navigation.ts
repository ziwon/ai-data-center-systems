import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

type SidebarEntry = App.Locals['starlightRoute']['sidebar'][number];
type SidebarLink = Extract<SidebarEntry, { type: 'link' }>;

const sections = [
  ['articles', '기술 아티클'],
  ['cs149', 'CS149 · 병렬 컴퓨팅'],
  ['pmpp', 'PMPP · CUDA 프로그래밍'],
  ['appendix', '참고자료'],
  ['labs', '실습'],
  ['heterogeneous-systems', 'Heterogeneous Systems'],
  ['gpu-mode', 'GPU MODE'],
] as const;

function links(entries: SidebarEntry[]): SidebarLink[] {
  return entries.flatMap((entry) => entry.type === 'link' ? [entry] : links(entry.entries));
}

function simplify(entry: SidebarEntry): SidebarEntry {
  if (entry.type === 'link') return entry;
  const entries = entry.entries.map(simplify);
  // Generated index.md directories otherwise add a disclosure for every document.
  if (entries.length === 1) return entries[0];
  return { ...entry, entries };
}

function gpuSidebar(entries: SidebarEntry[]): SidebarEntry[] {
  const sectionFor = (entry: SidebarEntry) => {
    const href = links([entry])[0]?.href;
    return sections.findIndex(([directory]) => href?.startsWith(`/gpu/${directory}/`));
  };

  return entries.map((entry) => {
    const section = sections[sectionFor(entry)];
    const result = simplify(entry);
    if (result.type === 'link') {
      return result.href === '/gpu/' ? { ...result, label: 'GPU 전체 목록' } : result;
    }
    if (!section) return result;

    const [directory, label] = section;
    const indexHref = `/gpu/${directory}/`;
    const count = links(result.entries).filter((link) => link.href !== indexHref).length;
    return {
      ...result,
      label: `${label} · ${count}`,
      collapsed: true,
      entries: result.entries.map((child) =>
        child.type === 'link' && child.href === indexHref
          ? { ...child, label: directory === 'articles' ? '아티클 모아보기' : '강좌 안내' }
          : child,
      ),
    };
  }).sort((a, b) => sectionFor(a) - sectionFor(b));
}

function inferenceSidebar(entries: SidebarEntry[]): SidebarEntry[] {
  const root = '/inference/';
  const course = `${root}efficient-llm-inference-systems/`;
  const appendix = `${course}appendix/`;
  const hardware = `${appendix}hardware-architectures/`;
  const flash = `${root}flashattention-from-first-principles/`;
  const models = `${root}models/`;
  const documents = links(entries);
  const remaining = new Set(documents);
  const labels: Record<string, string> = {
    [root]: 'Inference 목록',
    [course]: '강좌 안내',
    [`${course}week01/`]: 'Week 1 — Understanding Performance Metrics',
    [appendix]: '참고자료 모아보기',
    [hardware]: '하드웨어 읽기 안내',
    [flash]: 'FlashAttention from First Principles · English',
    [`${flash}readme.ko/`]: '원리로 이해하는 FlashAttention · 한국어',
    [models]: '모델 문서 모아보기',
  };
  const rename = (link: SidebarLink): SidebarLink =>
    labels[link.href] ? { ...link, label: labels[link.href] } : link;
  const groups: SidebarEntry[] = [];
  const addSection = (prefix: string, label: string, indexIsGuide = true, exclude?: string) => {
    const selected = documents.filter((link) =>
      remaining.has(link) && link.href.startsWith(prefix) && (!exclude || !link.href.startsWith(exclude)),
    );
    if (!selected.length) return;
    selected.forEach((link) => remaining.delete(link));
    const children = selected.map(rename);
    if (children.length === 1) {
      groups.push(children[0]);
      return;
    }
    const count = selected.filter((link) => !indexIsGuide || link.href !== prefix).length;
    groups.push({
      type: 'group', label: `${label} · ${count}`, entries: children,
      collapsed: true, badge: undefined,
    });
  };

  addSection(course, '추론 시스템 강좌', true, appendix);
  addSection(flash, 'FlashAttention', false);
  addSection(`${root}sglang-production-practices/`, 'SGLang');
  addSection(appendix, '기초 참고자료', true, hardware);
  addSection(hardware, '하드웨어 아키텍처');
  addSection(models, '모델 아키텍처');

  // Keep the hub first and retain new, as-yet unclassified documents.
  return [
    ...documents.filter((link) => remaining.has(link) && link.href === root).map(rename),
    ...groups,
    ...documents.filter((link) => remaining.has(link) && link.href !== root).map(rename),
  ];
}

export const onRequest = defineRouteMiddleware(({ locals }) => {
  const route = locals.starlightRoute;
  const topic = route.id.split('/')[0];
  if (topic !== 'gpu' && topic !== 'inference') return;

  route.sidebar = topic === 'gpu'
    ? gpuSidebar(route.sidebar)
    : inferenceSidebar(route.sidebar);

  // Keep next/previous links in the same order as the visible navigation.
  const documents = links(route.sidebar);
  const current = documents.findIndex((entry) => entry.isCurrent);
  if (current !== -1) {
    if (route.entry.data.prev === undefined) route.pagination.prev = documents[current - 1];
    if (route.entry.data.next === undefined) route.pagination.next = documents[current + 1];
  }
});
