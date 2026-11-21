const memoryBuckets = new Map();
const PAGE_SIZE = 20;
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://adcs.restack.tech';
    const corsHeaders = {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-admin-token',
      vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/ask/logs') {
      return handleLogs(request, env, corsHeaders).catch((err) =>
        json({ error: err?.message || String(err) }, 500, corsHeaders),
      );
    }

    if (url.pathname === '/api/kb/page') {
      return handleKbPage(request, env, corsHeaders).catch((err) =>
        json({ error: err?.message || String(err) }, 500, corsHeaders),
      );
    }

    if (url.pathname === '/api/kb/graph') {
      return handleKbGraph(request, env, corsHeaders).catch((err) =>
        json({ error: err?.message || String(err) }, 500, corsHeaders),
      );
    }

    if (url.pathname === '/api/kb/concepts') {
      return handleKbConcepts(request, env, corsHeaders).catch((err) =>
        json({ error: err?.message || String(err) }, 500, corsHeaders),
      );
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (origin && origin !== allowedOrigin) {
      return json({ error: 'Origin not allowed' }, 403, corsHeaders);
    }

    const rate = await checkRateLimit(request, env);
    if (!rate.ok) {
      return json(
        { error: 'Rate limit exceeded. 잠시 후 다시 시도해주세요.' },
        429,
        {
          ...corsHeaders,
          'retry-after': String(rate.retryAfter),
          'x-ratelimit-limit': String(rate.limit),
          'x-ratelimit-remaining': '0',
        },
      );
    }

    if (!env.AI) {
      return json({ error: 'Workers AI binding is not configured' }, 500, corsHeaders);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const question = normalizeText(payload?.question || '').slice(0, 800);
    const sources = normalizeSources(payload?.sources);

    if (!question) {
      return json({ error: 'Question is required' }, 400, corsHeaders);
    }
    if (sources.length === 0) {
      return json({ error: 'At least one source is required' }, 400, corsHeaders);
    }

    let answer;
    try {
      answer = await askModel({ env, question, sources });
    } catch (err) {
      // Keep the upstream detail in the Worker logs; show the reader a plain message.
      console.error('ask-docs model call failed:', err?.message || String(err));
      return json(
        { error: '답변 생성 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.' },
        502,
        corsHeaders,
      );
    }

    if (env.QA_DB) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      ctx.waitUntil(logQA({ db: env.QA_DB, ip, question, answer, sources }));
    }

    return json(
      { answer },
      200,
      {
        ...corsHeaders,
        'x-ratelimit-limit': String(rate.limit),
        'x-ratelimit-remaining': String(rate.remaining),
      },
    );
  },
};

async function handleKbPage(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const url = new URL(request.url);
  const route = normalizeRoute(url.searchParams.get('route') || '/');
  const graphKey = routeGraphKey(route);

  if (env.QA_DB) {
    const fromD1 = await readPageGraphFromD1(env.QA_DB, route, graphKey);
    if (fromD1) {
      return json(fromD1, 200, {
        ...corsHeaders,
        'cache-control': 'public, max-age=300',
      });
    }
  }

  const staticGraph = await fetchStaticPageGraph(url, graphKey);
  if (!staticGraph) {
    return json({ error: 'Knowledge graph not found' }, 404, corsHeaders);
  }
  return json(staticGraph, 200, {
    ...corsHeaders,
    'cache-control': 'public, max-age=300',
  });
}

async function readPageGraphFromD1(db, route, graphKey) {
  try {
    const row = await db.prepare(
      'SELECT graph_json FROM kb_page_graphs WHERE route = ? OR graph_key = ? LIMIT 1',
    ).bind(route, graphKey).first();
    if (!row?.graph_json) return null;
    return JSON.parse(row.graph_json);
  } catch {
    return null;
  }
}

async function handleKbGraph(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const url = new URL(request.url);
  if (env.QA_DB) {
    const fromD1 = await readGlobalGraphFromD1(env.QA_DB);
    if (fromD1) {
      return json(fromD1, 200, {
        ...corsHeaders,
        'cache-control': 'public, max-age=300',
      });
    }
  }

  const staticGraph = await fetchStaticGlobalGraph(url);
  if (!staticGraph) {
    return json({ error: 'Knowledge graph not found' }, 404, corsHeaders);
  }
  return json(staticGraph, 200, {
    ...corsHeaders,
    'cache-control': 'public, max-age=300',
  });
}

async function readGlobalGraphFromD1(db) {
  try {
    const row = await db.prepare(
      "SELECT graph_json FROM kb_global_graph WHERE id = 'main' LIMIT 1",
    ).first();
    if (!row?.graph_json) return null;
    return JSON.parse(row.graph_json);
  } catch {
    return null;
  }
}

async function handleKbConcepts(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }
  if (!env.QA_DB) {
    return json({ error: 'Database not configured' }, 500, corsHeaders);
  }

  const result = await env.QA_DB.prepare(
    'SELECT id, label, concept_group, description, aliases, updated_at FROM kb_concepts ORDER BY concept_group, label',
  ).all();
  return json({
    concepts: (result.results ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      group: row.concept_group,
      description: row.description,
      aliases: parseJsonArray(row.aliases),
      updatedAt: row.updated_at,
    })),
  }, 200, {
    ...corsHeaders,
    'cache-control': 'public, max-age=300',
  });
}

async function fetchStaticPageGraph(url, graphKey) {
  const graphUrl = new URL(`/kb/pages/${graphKey}.json`, url.origin);
  const response = await fetch(graphUrl, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) return null;
  return response.json();
}

async function fetchStaticGlobalGraph(url) {
  const graphUrl = new URL('/kb/dcs-kb-graph.json', url.origin);
  const response = await fetch(graphUrl, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) return null;
  return response.json();
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function handleLogs(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const token = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (!env.QA_DB) {
    return json({ error: 'Database not configured' }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parsePositiveInt(url.searchParams.get('page'), 1));
  const q = (url.searchParams.get('q') || '').trim();
  const offset = (page - 1) * PAGE_SIZE;

  let total, rows;

  try {
    if (q) {
      const like = `%${q}%`;
      const countRow = await env.QA_DB.prepare(
        'SELECT COUNT(*) AS n FROM qa_logs WHERE question LIKE ?',
      ).bind(like).first();
      total = countRow?.n ?? 0;

      const result = await env.QA_DB.prepare(
        'SELECT id, ts, question, answer, sources FROM qa_logs WHERE question LIKE ? ORDER BY ts DESC LIMIT ? OFFSET ?',
      ).bind(like, PAGE_SIZE, offset).all();
      rows = result.results ?? [];
    } else {
      const countRow = await env.QA_DB.prepare('SELECT COUNT(*) AS n FROM qa_logs').first();
      total = countRow?.n ?? 0;

      const result = await env.QA_DB.prepare(
        'SELECT id, ts, question, answer, sources FROM qa_logs ORDER BY ts DESC LIMIT ? OFFSET ?',
      ).bind(PAGE_SIZE, offset).all();
      rows = result.results ?? [];
    }
  } catch (err) {
    return json({ error: `DB error: ${err?.message || String(err)}` }, 500, corsHeaders);
  }

  return json({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    logs: rows.map((row) => ({
      id: row.id,
      time: new Date(row.ts * 1000).toISOString(),
      question: row.question,
      answer: row.answer,
      sources: (() => { try { return JSON.parse(row.sources || '[]'); } catch { return []; } })(),
    })),
  }, 200, corsHeaders);
}

async function askModel({ env, question, sources }) {
  const context = sources
    .map((source, index) => {
      return [
        `[${index + 1}] ${source.title}`,
        `URL: ${source.url}`,
        source.excerpt,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const result = await env.AI.run(env.WORKERS_AI_MODEL || DEFAULT_MODEL, {
    temperature: 0.2,
    // Hidden reasoning shares this budget and used to cut answers off mid-sentence.
    max_tokens: 3000,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: 'system',
        content: [
          'You are a patient technical tutor for the AI Data Center Systems documentation.',
          'Answer in Korean unless the user asks for another language.',
          'Use the provided documentation sources as the anchor for the answer, but you may add generally accepted background knowledge when it helps a beginner understand the topic.',
          'Clearly separate what the document says from extra explanatory context when the distinction matters.',
          'Do not fabricate document-specific claims, numbers, commands, product behavior, or citations that are not in the sources.',
          'Prefer teaching: define key terms, explain why they matter, connect cause and effect, then give practical checks or examples.',
          'If the sources are thin, say that the document only gives limited evidence and then provide a careful general explanation.',
          'Start directly with the answer: no greeting and no closing pleasantries.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Question:\n${question}`,
          `Sources:\n${context}`,
          [
            'Write a helpful teaching answer.',
            'Structure it as:',
            '1. Short direct answer.',
            '2. Explanation for a reader who is new to the topic.',
            '3. How this connects to the provided document, citing source numbers like [1] where useful.',
            '4. Practical checks, examples, or caveats when relevant.',
            'Keep it focused, but do not be so terse that the reader has to already know the background.',
          ].join('\n'),
        ].join('\n\n'),
      },
    ],
  });

  const answer = extractAnswer(result);
  if (!answer) throw new Error('Workers AI returned an empty answer');
  if (result?.choices?.[0]?.finish_reason === 'length') {
    return `${answer}\n\n*(답변이 길이 제한에 걸려 여기서 끊겼습니다. 질문을 더 좁혀서 다시 물어보세요.)*`;
  }
  return answer;
}

// Workers AI models answer in one of a few shapes depending on the model family.
function extractAnswer(result) {
  if (typeof result === 'string') return result.trim();
  const candidates = [
    result?.response,
    result?.choices?.[0]?.message?.content,
    result?.output_text,
    result?.output
      ?.flatMap((item) => item?.content ?? [])
      .filter((part) => part?.type === 'output_text')
      .map((part) => part.text)
      .join(''),
  ];
  const text = candidates.find((value) => typeof value === 'string' && value.trim());
  return text ? text.trim() : '';
}

async function logQA({ db, ip, question, answer, sources }) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(ip));
  const ipHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare(
    'INSERT INTO qa_logs (ts, ip_hash, question, answer, sources) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    Math.floor(Date.now() / 1000),
    ipHash,
    question,
    answer,
    JSON.stringify(sources),
  ).run();
}

async function checkRateLimit(request, env) {
  const limit = parsePositiveInt(env.RATE_LIMIT_REQUESTS, 20);
  const windowSeconds = parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, 3600);
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `ask:${ip}`;

  if (env.ASK_DOCS_RATE_LIMIT) {
    const existing = await env.ASK_DOCS_RATE_LIMIT.get(key, 'json');
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowSeconds };
    if (bucket.count >= limit) {
      return {
        ok: false,
        limit,
        remaining: 0,
        retryAfter: Math.max(1, bucket.resetAt - now),
      };
    }
    bucket.count += 1;
    await env.ASK_DOCS_RATE_LIMIT.put(key, JSON.stringify(bucket), {
      expirationTtl: Math.max(60, bucket.resetAt - now),
    });
    return {
      ok: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfter: 0,
    };
  }

  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds });
    return { ok: true, limit, remaining: limit - 1, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, retryAfter: Math.max(1, bucket.resetAt - now) };
  }
  bucket.count += 1;
  return { ok: true, limit, remaining: Math.max(0, limit - bucket.count), retryAfter: 0 };
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((source) => ({
      title: normalizeText(source?.title || '').slice(0, 160),
      url: normalizePath(source?.url || '').slice(0, 240),
      excerpt: normalizeText(source?.excerpt || '').slice(0, 1800),
    }))
    .filter((source) => source.title && source.url && source.excerpt);
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizePath(value) {
  const text = String(value).trim();
  if (text.startsWith('/')) return text;
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function normalizeRoute(route) {
  const text = String(route || '/').trim();
  const path = text.startsWith('/') ? text : `/${text}`;
  return path.replace(/\/?$/, '/').replace(/\/+/g, '/').toLowerCase();
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

function parsePositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}
