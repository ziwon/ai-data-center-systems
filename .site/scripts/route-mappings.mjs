export const legacyMappings = [
  { from: '/ai-data-center-network', to: '/network' },
  {
    from: '/efficient-llm-inference-systems',
    to: '/inference/efficient-llm-inference-systems',
  },

  // Preserve canonical inference course URLs that existed before the content split.
  {
    from: '/inference/appendix',
    to: '/inference/efficient-llm-inference-systems/appendix',
  },
  { from: '/inference/week01', to: '/inference/efficient-llm-inference-systems/week01' },
  { from: '/inference/week02', to: '/inference/efficient-llm-inference-systems/week02' },
  { from: '/inference/week03', to: '/inference/efficient-llm-inference-systems/week03' },
  { from: '/inference/week04', to: '/inference/efficient-llm-inference-systems/week04' },
  { from: '/inference/week05', to: '/inference/efficient-llm-inference-systems/week05' },
  { from: '/ai-system-performance-engineering', to: '/systems-performance' },
  { from: '/cme295', to: '/courses/cme295' },
  {
    from: '/deep-learning-for-network-engineers',
    to: '/courses/deep-learning-for-network-engineers',
  },

  // Articles moved from the topic folders into the top-level Blog section (briefly /articles/).
  { from: '/articles', to: '/blog' },
  { from: '/gpu/articles', to: '/blog' },
  { from: '/network/articles', to: '/blog' },
  { from: '/systems-performance/articles', to: '/blog' },
];

export const legacyRoutePrefixes = legacyMappings.map(({ from }) => from);
