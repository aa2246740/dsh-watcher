/** Browser-safe analysis. No agent commands or model calls. */
/** @type {{silenceSeconds:number, reasoningSeconds:number}} */
export const DEFAULT_LIMITS = Object.freeze({ silenceSeconds: 30, reasoningSeconds: 90 });
export function limitsOf(raw) {
  const safe = (v, fallback) => Number.isFinite(v) && v >= 5 && v <= 3600 ? Math.round(v) : fallback;
  return { silenceSeconds: safe(raw?.silenceSeconds, 30), reasoningSeconds: safe(raw?.reasoningSeconds, 90) };
}
/** @param {any} view @param {number} now @param {{running?:boolean,waiting?:boolean,limits?:{silenceSeconds:number,reasoningSeconds:number}}} options */
export function alertsOf(view, now, { running = false, waiting = false, limits = DEFAULT_LIMITS } = {}) {
  if (!view) return [];
  const alerts = (view.findings ?? []).filter(f => f.turn === view.turn?.number).slice(-3);
  const p = view.pending;
  if (!running || waiting || !p) return alerts;
  const last = p.lastContentAt ?? p.start;
  if (last !== null && now >= last && now - last >= limits.silenceSeconds * 1000) alerts.push({
    id: 'silence', kind: 'silence', turn: p.turn, steps: [p.step], seqs: [],
    title: `${Math.floor((now - last) / 1000)} 秒未收到模型内容`,
    detail: '可能是首响应等待、连接或服务端停顿；这不是内部思考时长，也不能据此确定空转。',
  });
  if (p.reasoningFirst !== null && p.reasoningLast !== null && p.reasoningLast - p.reasoningFirst >= limits.reasoningSeconds * 1000) alerts.push({
    id: 'reasoning-span', kind: 'reasoning-span', turn: p.turn, steps: [p.step], seqs: [],
    title: `本次可见推理采样跨度 ${Math.round((p.reasoningLast - p.reasoningFirst) / 1000)} 秒`,
    detail: '只按已收到片段的首末时间计算，可能包含片段间等待。时长偏长不是任务质量结论。',
  });
  return alerts;
}
export function mergeModels(views) {
  const map = new Map();
  for (const view of views) for (const m of view.models ?? []) {
    const key = JSON.stringify([m.provider, m.model]);
    let row = map.get(key);
    if (!row) { row = { provider: m.provider, model: m.model, sessions: 0 }; map.set(key, row); }
    row.sessions++;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) row[k] = (row[k] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
}
/**
 * RC1 follow() can promote a cold Session after its first yielded snapshot.
 * Do NOT use follow() to scan sessions, even with early abort.
 * list() provides attached projections and cold hints without Agent activation.
 * @param {any} remote
 * @param {{signal?:AbortSignal,limit?:number,onProgress?:(value:any)=>void}} options
 */
export async function scanSessions(remote, { signal, limit = 30, onProgress = () => {} } = {}) {
  const { items } = await remote.session.list({}, signal);
  signal?.throwIfAborted();
  if (!Array.isArray(items)) throw new TypeError('Session list response has no items array');
  const unique = [...new Map(items.filter(x => typeof x.sessionId === 'string' && !x.blank).map(x => [x.sessionId, x])).values()];
  const picked = unique.slice(0, Math.min(100, Math.max(1, limit)));
  const rows = picked.map(row => {
    const candidate = row.projections?.values?.watcherInsights;
    let value = null, error = null;
    if (row.origin === 'subagent') error = '直接子代理暂未纳入；避免重复计算继承前缀';
    else if (candidate?.version === 1 && candidate.sessionId === row.sessionId && candidate.totals && Array.isArray(candidate.models) && Array.isArray(candidate.findings)) value = candidate;
    else error = '尚无 Watcher 统计缓存；在加载插件后运行或打开此会话，再刷新统计';
    return { sessionId: row.sessionId, value, error };
  });
  const result = { rows, total: unique.length, selected: picked.length };
  onProgress(result);
  return result;
}
