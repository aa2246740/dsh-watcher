/** Browser-safe static pricing. No network, no live list-price fetch. */
import { costCopy } from './i18n.mjs';

export const PRICING_STORAGE_KEY = 'dsh-watcher:pricing-override:v1';
export const PRICING_OVERRIDE_FILE = '$DSH_HOME/profiles/web/dsh-watcher-pricing.override.json';
export const PRICING_UNIT = 'per_1m_tokens';
const PER_MILLION = 1_000_000;
const UNLABELED = new Set(['', 'unknown', '未标注', '其他模型', '全部模型']);

/**
 * Bundled defaults. `pricing/models.yaml` is the documented source; tests
 * require that file to parse to this table.
 */
export const DEFAULT_PRICING_TABLE = Object.freeze({
  currency: 'USD',
  unit: PRICING_UNIT,
  models: Object.freeze({
    'deepseek-flash': Object.freeze({
      aliases: Object.freeze([
        'deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp',
        'deepseek-v4.1-flash',
        'deepseek-v4-1-flash',
        'deepseek-chat',
        'deepseek-reasoner',
        'deepseek/deepseek-flash',
        'deepseek/deepseek-v4-flash',
        'deepseek/deepseek-chat',
        'deepseek/deepseek-reasoner',
        'openrouter/deepseek/deepseek-chat',
        'openrouter/deepseek/deepseek-reasoner',
        'openrouter/deepseek/deepseek-v4-flash',
      ]),
      currency: 'USD',
      input: 0.15,
      output: 0.6,
      cache: 0.003,
    }),
    'deepseek-v4-pro': Object.freeze({
      aliases: Object.freeze([
        'deepseek-pro',
        'deepseek/deepseek-v4-pro',
        'deepseek/deepseek-pro',
        'openrouter/deepseek/deepseek-v4-pro',
      ]),
      currency: 'USD',
      input: 0.66,
      output: 1.98,
      cache: 0.022,
    }),
  }),
});

export function defaultPricing() {
  return cloneTable(DEFAULT_PRICING_TABLE);
}

function cloneTable(table) {
  const models = {};
  for (const [id, row] of Object.entries(table?.models ?? {})) {
    models[id] = {
      aliases: [...(row.aliases ?? [])],
      currency: row.currency ?? table.currency ?? 'USD',
      input: row.input,
      output: row.output,
      cache: row.cache,
      cacheWrite: row.cacheWrite,
    };
  }
  return { currency: table?.currency ?? 'USD', unit: table?.unit ?? PRICING_UNIT, models };
}

function tokensOf(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Finite rate ≥ 0, including an explicit $0/1M. Missing / NaN / negative → undefined (unknown, not $0). */
export function rateOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function normalizeModelId(id) {
  return String(id ?? '').trim().toLowerCase();
}

export function parseScalar(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * Minimal YAML subset: comments, maps, string/number scalars, and `- item` lists.
 * Enough for `pricing/models.yaml` and simple overlays.
 */
export function parsePricingYaml(text) {
  const lines = String(text ?? '').replace(/\t/g, '  ').split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, parent: null, key: null, value: root }];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const body = raw.slice(indent);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (body.startsWith('- ')) {
      const item = parseScalar(body.slice(2).replace(/\s+#.*$/, '').trim());
      if (frame.parent == null || frame.key == null) continue;
      if (!Array.isArray(frame.parent[frame.key])) {
        frame.parent[frame.key] = [];
        frame.value = frame.parent[frame.key];
      }
      frame.parent[frame.key].push(item);
      continue;
    }

    const colon = body.indexOf(':');
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).replace(/\s+#.*$/, '').trim();
    const parent = frame.value && typeof frame.value === 'object' && !Array.isArray(frame.value) ? frame.value : root;
    if (rest === '') {
      const next = {};
      parent[key] = next;
      stack.push({ indent, parent, key, value: next });
      continue;
    }
    parent[key] = parseScalar(rest);
  }
  return root;
}

export function buildRateIndex(table) {
  const map = new Map();
  for (const [id, row] of Object.entries(table?.models ?? {})) {
    const rates = {
      id,
      currency: row.currency ?? table.currency ?? 'USD',
      input: rateOf(row.input),
      output: rateOf(row.output),
      cache: rateOf(row.cache),
      cacheWrite: rateOf(row.cacheWrite),
    };
    for (const key of [id, ...(row.aliases ?? [])]) {
      const normalized = normalizeModelId(key);
      if (normalized && !UNLABELED.has(normalized)) map.set(normalized, rates);
    }
  }
  return map;
}

export function lookupRates(model, table) {
  const index = table?._index instanceof Map ? table._index : buildRateIndex(table);
  const raw = normalizeModelId(model);
  if (!raw || UNLABELED.has(raw)) return null;
  if (index.has(raw)) return index.get(raw);
  const slash = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : '';
  if (slash && !UNLABELED.has(slash) && index.has(slash)) return index.get(slash);
  return null;
}

export function mergePricing(base, overlay) {
  const next = cloneTable(base ?? defaultPricing());
  if (overlay == null) return indexTable(next);
  if (typeof overlay !== 'object' || Array.isArray(overlay)) return indexTable(next);
  const incoming = overlay.models && typeof overlay.models === 'object' && !Array.isArray(overlay.models)
    ? overlay.models
    : overlay;
  if (typeof overlay.currency === 'string' && overlay.currency.trim()) next.currency = overlay.currency.trim();
  if (typeof overlay.unit === 'string' && overlay.unit.trim()) next.unit = overlay.unit.trim();
  for (const [id, row] of Object.entries(incoming ?? {})) {
    if (!id || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    const prev = next.models[id] ?? { aliases: [], currency: next.currency };
    const aliases = [...new Set([...(prev.aliases ?? []), ...((row.aliases ?? []).filter(a => typeof a === 'string'))])];
    next.models[id] = {
      aliases,
      currency: typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim() : prev.currency,
      input: row.input !== undefined ? rateOf(row.input) : prev.input,
      output: row.output !== undefined ? rateOf(row.output) : prev.output,
      cache: row.cache !== undefined ? rateOf(row.cache) : prev.cache,
      cacheWrite: row.cacheWrite !== undefined ? rateOf(row.cacheWrite) : prev.cacheWrite,
    };
  }
  return indexTable(next);
}

function indexTable(table) {
  table._index = buildRateIndex(table);
  return table;
}

function bucketCost(tokens, rate) {
  if (tokens <= 0) return { tokens: 0, usd: 0, unknown: false };
  if (rate === undefined) return { tokens, usd: null, unknown: true };
  return { tokens, usd: (tokens / PER_MILLION) * rate, unknown: false };
}

/**
 * Price one model usage row.
 * $0 only when every token count is actually 0. Missing model or missing
 * bucket rate is Unknown — never coerced to $0.
 */
export function estimateModelUsage(usage, table) {
  const input = tokensOf(usage?.input);
  const output = tokensOf(usage?.output);
  const cacheRead = tokensOf(usage?.cacheRead ?? usage?.cache);
  const cacheWrite = tokensOf(usage?.cacheWrite);
  const reported = tokensOf(usage?.tokens);
  const bucketSum = input + output + cacheRead + cacheWrite;
  const totalTokens = Math.max(reported, bucketSum);

  if (totalTokens === 0) {
    return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, parts: [] };
  }

  const rates = lookupRates(usage?.model ?? usage?.modelId, table);
  if (!rates) {
    return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'missing-model', parts: [] };
  }

  if (bucketSum === 0 && reported > 0) {
    return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'unsplit-tokens', parts: [] };
  }

  const parts = {
    input: bucketCost(input, rates.input),
    output: bucketCost(output, rates.output),
    cache: bucketCost(cacheRead, rates.cache),
    cacheWrite: bucketCost(cacheWrite, rates.cacheWrite),
  };
  let usd = 0;
  let unknown = false;
  for (const part of Object.values(parts)) {
    if (part.tokens <= 0) continue;
    if (part.unknown) unknown = true;
    else usd += part.usd;
  }
  if (reported > bucketSum) {
    unknown = true;
    parts.unallocated = { tokens: reported - bucketSum, usd: null, unknown: true };
  }
  if (unknown && usd === 0) return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'missing-rate', parts };
  if (unknown) return { status: 'partial', usd, unknown: true, totalTokens, parts };
  return { status: 'priced', usd, unknown: false, totalTokens, parts };
}

export function estimateUsageRows(rows, table) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, rows: [] };
  let usd = 0;
  let unknown = false;
  let totalTokens = 0;
  let anyPositive = false;
  const estimated = list.map(row => {
    const result = estimateModelUsage(row, table);
    totalTokens += result.totalTokens ?? 0;
    if (result.status !== 'zero') anyPositive = true;
    if (result.unknown) unknown = true;
    if (result.usd != null) usd += result.usd;
    return result;
  });
  if (!anyPositive) return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, rows: estimated };
  if (unknown && usd === 0) return { status: 'unknown', usd: null, unknown: true, totalTokens, rows: estimated };
  if (unknown) return { status: 'partial', usd, unknown: true, totalTokens, rows: estimated };
  return { status: 'priced', usd, unknown: false, totalTokens, rows: estimated };
}

export function estimateFromInsights(view, stats, scope, selectedModel, currentRoute, table) {
  if (selectedModel) return estimateModelUsage(selectedModel, table);
  if (scope === 'turn') {
    return estimateModelUsage({ ...stats, model: view?.turn?.route?.model ?? currentRoute?.model }, table);
  }
  if (Array.isArray(view?.models) && view.models.length > 0) return estimateUsageRows(view.models, table);
  return estimateModelUsage({ ...stats, model: currentRoute?.model }, table);
}

export function formatUsd(amount) {
  if (!Number.isFinite(amount)) return null;
  if (amount === 0) return '$0.00';
  const abs = Math.abs(amount);
  if (abs < 0.0001) return `$${amount.toFixed(6)}`.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (abs < 0.01) return `$${amount.toFixed(4)}`;
  if (abs < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatEstimate(result, locale = 'zh') {
  const copy = costCopy(locale);
  if (!result || result.status === 'unknown') return copy.unknown;
  if (result.status === 'zero') return formatUsd(0);
  const money = formatUsd(result.usd);
  if (money == null) return copy.unknown;
  if (result.status === 'partial') return `${money} + ${copy.unknown}`;
  return money;
}

export function estimateDisclaimer(locale = 'zh') {
  const copy = costCopy(locale);
  return locale === 'en'
    ? `${copy.estimateNotBill} / 估算，非账单`
    : `${copy.estimateNotBill} / Estimate, not a bill`;
}

export function parseOverride(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('override must be a JSON object');
    }
    return parsed;
  }
  return parsePricingYaml(text);
}

export function readStoredOverride(storage) {
  try {
    const raw = storage?.getItem?.(PRICING_STORAGE_KEY);
    return raw ? parseOverride(raw) : null;
  } catch {
    return null;
  }
}

export function pricingTableFrom(override) {
  return mergePricing(defaultPricing(), override);
}
