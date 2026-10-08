import { z } from "zod";
import { createHash } from "node:crypto";
//#region src/insights/engine.mjs
/** Read-only DSH 0.2.0-rc.2 log fold. No prompt, reasoning or tool body is retained. */
const DAY_CAP = 400;
const localDayKey = (ms) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const elapsed = (start, end) => start === null ? 0 : Math.max(0, end - start);
function emptyStats() {
	return {
		calls: 0,
		reported: 0,
		exactTotals: 0,
		tokens: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		reasoningReports: 0,
		modelMs: 0,
		timedCalls: 0,
		firstMs: 0,
		firstSamples: 0,
		reasoningMs: 0,
		tools: 0,
		toolErrors: 0,
		toolMs: 0,
		bashMs: 0,
		retries: 0
	};
}
function emptySurface() {
	return {
		system: 0,
		tools: 0,
		memory: 0,
		files: 0,
		results: 0,
		conversation: 0
	};
}
function initialState(header = {}, inherited = 0) {
	return {
		version: 3,
		sessionId: String(header.id ?? ""),
		skip: inherited,
		seq: -1,
		updatedAt: 0,
		route: {
			provider: "unknown",
			model: "unknown"
		},
		totals: emptyStats(),
		models: [],
		days: [],
		turn: null,
		open: null,
		tools: [],
		previousFailure: null,
		findings: [],
		findingCount: 0,
		contextWindow: null,
		surfaceNodes: [],
		surface: emptySurface(),
		surfacePartial: false,
		lastSurface: null,
		requests: []
	};
}
function normalizeUsage(value) {
	if (!record(value) || !count(value.inputTokens) || !count(value.outputTokens)) return null;
	if ([
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningTokens",
		"totalTokens"
	].some((k) => value[k] !== void 0 && !count(value[k]))) return null;
	const minimum = value.inputTokens + value.outputTokens + (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0);
	if (!Number.isSafeInteger(minimum) || value.totalTokens !== void 0 && value.totalTokens < minimum) return null;
	return {
		input: value.inputTokens,
		output: value.outputTokens,
		cacheRead: value.cacheReadTokens ?? 0,
		cacheWrite: value.cacheWriteTokens ?? 0,
		reasoning: value.reasoningTokens ?? null,
		tokens: value.totalTokens ?? minimum,
		exact: value.totalTokens !== void 0
	};
}
function canonical(v) {
	if (Array.isArray(v)) return v.map(canonical);
	if (record(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
	return v;
}
function fingerprint(v) {
	try {
		let text = typeof v === "string" ? v : JSON.stringify(v);
		if (!text || text.length > 65536) return null;
		try {
			text = JSON.stringify(canonical(JSON.parse(text)));
		} catch {}
		return createHash("sha256").update(text).digest("hex");
	} catch {
		return null;
	}
}
function signatureOf(name, args) {
	const hash = fingerprint(args);
	return hash === null ? null : fingerprint([name, hash]);
}
function modelRow(s, route) {
	const effort = typeof route?.effort === "string" ? route.effort : null;
	let row = s.models.find((m) => m.provider === route.provider && m.model === route.model && (m.effort ?? null) === effort);
	if (!row) {
		row = {
			provider: route.provider,
			model: route.model,
			...effort ? { effort } : {},
			...emptyStats()
		};
		s.models.push(row);
	}
	return row;
}
const CHARS_PER_TOKEN = 4;
const ROLE_OVERHEAD = 4;
const SURFACE_NODE_CAP = 3e3;
const REQUEST_CAP = 60;
const SURFACE_TYPES = /* @__PURE__ */ new Set([
	"system/message",
	"developer/message",
	"user/message",
	"assistant/message",
	"tool/result"
]);
const BUCKETS = [
	"system",
	"tools",
	"memory",
	"files",
	"results",
	"conversation"
];
function priceMessage(message) {
	let text = "";
	try {
		text = JSON.stringify(message?.content ?? "");
	} catch {
		return 0;
	}
	if (typeof text !== "string" || text.length === 0 || text === "\"\"" || text === "[]") return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}
function priceTools(header) {
	if (!record(header) || !Array.isArray(header.tools) || header.tools.length === 0) return 0;
	try {
		return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN);
	} catch {
		return 0;
	}
}
function bucketFor(type, message) {
	if (type === "system/message") return "system";
	if (type === "developer/message") return "memory";
	if (type === "tool/result") return "results";
	if (type === "assistant/message") return "conversation";
	if (type === "user/message") {
		const source = record(message?.source) ? message.source : null;
		if ((typeof source?.kind === "string" ? source.kind : "user") !== "user") return "memory";
		return (Array.isArray(message?.content) ? message.content : []).some((b) => record(b) && (b.type === "file" || b.type === "image")) ? "files" : "conversation";
	}
	return "conversation";
}
function surfaceTotal(buckets) {
	let total = 0;
	for (const k of BUCKETS) total += buckets[k];
	return total;
}
function surfaceTotals$1(s) {
	return {
		...s.surface,
		total: surfaceTotal(s.surface)
	};
}
function surfaceDiff(now, before) {
	const delta = { total: 0 };
	for (const k of BUCKETS) delta[k] = (now[k] ?? 0) - (before?.[k] ?? 0);
	delta.total = (now.total ?? 0) - (before?.total ?? 0);
	return delta;
}
function applySurface(s, event) {
	const d = event.data;
	const tokens = priceMessage(d.message);
	if (tokens === 0) return;
	const bucket = bucketFor(event.type, d.message);
	const op = event.surfaceOp ?? d.surfaceOp;
	if (record(op) && op.op === "replace" && count(op.startSeq) && count(op.endSeq)) {
		const start = op.startSeq, end = op.endSeq;
		for (const n of s.surfaceNodes) if (n.seq >= start && n.seq <= end) s.surface[n.bucket] = Math.max(0, s.surface[n.bucket] - n.tokens);
		s.surfaceNodes = s.surfaceNodes.filter((n) => n.seq < start || n.seq > end);
	}
	s.surfaceNodes.push({
		seq: event.seq,
		bucket,
		tokens
	});
	if (s.surfaceNodes.length > SURFACE_NODE_CAP) {
		const dropped = s.surfaceNodes.slice(0, s.surfaceNodes.length - SURFACE_NODE_CAP);
		for (const n of dropped) s.surface[n.bucket] = Math.max(0, s.surface[n.bucket] - n.tokens);
		s.surfaceNodes = s.surfaceNodes.slice(-3e3);
		s.surfacePartial = true;
	}
	s.surface[bucket] += tokens;
}
function books(s, route = s.route) {
	return [
		s.totals,
		modelRow(s, route),
		...s.turn ? [s.turn.stats] : []
	];
}
function creditDay(s, time, route, u) {
	const key = localDayKey(time);
	let day = s.days.find((d) => d.key === key);
	if (!day) {
		day = {
			key,
			tokens: 0,
			models: []
		};
		s.days.push(day);
		s.days.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
	}
	day.tokens += u.tokens;
	const effort = typeof route?.effort === "string" ? route.effort : null;
	let row = day.models.find((m) => m.provider === route.provider && m.model === route.model && (m.effort ?? null) === effort);
	if (!row) {
		row = {
			provider: route.provider,
			model: route.model,
			...effort ? { effort } : {},
			tokens: 0
		};
		day.models.push(row);
	}
	row.tokens += u.tokens;
	if (s.days.length > DAY_CAP) s.days = s.days.slice(s.days.length - DAY_CAP);
}
function begin(s, d, time, uncertain = false) {
	s.open = {
		turn: d.turn,
		step: d.step,
		start: uncertain ? null : time,
		first: null,
		reasoningFirst: null,
		reasoningLast: null,
		lastContentAt: null,
		usage: null,
		route: { ...s.route }
	};
}
function settle(s, time, usage, source) {
	const a = s.open;
	if (!a) return;
	const route = record(source) && typeof source.provider === "string" && typeof source.model === "string" ? {
		provider: source.provider,
		model: source.model,
		...a.route?.effort ? { effort: a.route.effort } : {}
	} : a.route;
	s.route = route;
	const u = usage === void 0 || usage === null ? a.usage : normalizeUsage(usage);
	for (const b of books(s, route)) {
		b.calls++;
		if (a.start !== null) {
			b.timedCalls++;
			b.modelMs += elapsed(a.start, time);
		}
		if (a.start !== null && a.first !== null) {
			b.firstSamples++;
			b.firstMs += elapsed(a.start, a.first);
		}
		if (a.reasoningFirst !== null && a.reasoningLast !== null) b.reasoningMs += elapsed(a.reasoningFirst, a.reasoningLast);
		if (u) {
			b.reported++;
			b.exactTotals += Number(u.exact);
			b.tokens += u.tokens;
			for (const k of [
				"input",
				"output",
				"cacheRead",
				"cacheWrite"
			]) b[k] += u[k];
			if (u.reasoning !== null) {
				b.reasoningReports++;
				b.reasoning += u.reasoning;
			}
		}
	}
	if (u) {
		creditDay(s, time, route, u);
		const surface = surfaceTotals$1(s);
		s.requests.push({
			turn: a.turn,
			step: a.step,
			seq: s.seq,
			endedAt: time,
			route: { ...route },
			usage: u,
			firstMs: a.start === null || a.first === null ? null : elapsed(a.start, a.first),
			modelMs: a.start === null ? null : elapsed(a.start, time),
			reasoningMs: a.reasoningFirst === null || a.reasoningLast === null ? null : elapsed(a.reasoningFirst, a.reasoningLast),
			surface,
			delta: surfaceDiff(surface, s.lastSurface)
		});
		if (s.requests.length > REQUEST_CAP) s.requests = s.requests.slice(-60);
		s.lastSurface = surface;
	}
	s.open = null;
}
function applyChunk(open, chunk, time) {
	if (!record(chunk) || typeof chunk.type !== "string") return;
	if (chunk.type === "usage") {
		open.usage = normalizeUsage(chunk.usage);
		return;
	}
	if (![
		"reasoning-delta",
		"text-delta",
		"tool-call-delta"
	].includes(chunk.type)) return;
	if (!(typeof chunk.text === "string" && chunk.text.length) && !(typeof chunk.argumentsDelta === "string" && chunk.argumentsDelta.length) && !chunk.name) return;
	open.first ??= time;
	open.lastContentAt = time;
	if (chunk.type === "reasoning-delta") {
		open.reasoningFirst ??= time;
		open.reasoningLast = time;
	}
}
function applyStream(open, stream) {
	if (!open || !Array.isArray(stream)) return;
	for (const rec of stream) {
		if (!record(rec) || typeof rec.type !== "string") continue;
		if (rec.type === "chunk") {
			applyChunk(open, rec.chunk, rec.time);
			continue;
		}
		const parts = rec.type === "tool-call-chunks" ? rec.args : rec.texts;
		const gaps = rec.dt;
		if (!Array.isArray(parts) || !parts.length || !parts.every((p) => typeof p === "string") || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger) || !Number.isSafeInteger(rec.time0)) continue;
		let time = rec.time0;
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) time += gaps[i - 1];
			if (rec.type === "reasoning-chunks") applyChunk(open, {
				type: "reasoning-delta",
				text: parts[i]
			}, time);
			else if (rec.type === "text-chunks") applyChunk(open, {
				type: "text-delta",
				text: parts[i]
			}, time);
			else if (rec.type === "tool-call-chunks") applyChunk(open, {
				type: "tool-call-delta",
				argumentsDelta: parts[i],
				name: rec.name
			}, time);
		}
	}
}
const interesting = /* @__PURE__ */ new Set([
	"request/header",
	"request/context",
	"user/message",
	"system/message",
	"developer/message",
	"turn/start",
	"step/start",
	"assistant/attempt",
	"assistant/message",
	"llm/retry",
	"tool/call",
	"tool/result",
	"step/end",
	"turn/end"
]);
const NO_TURN_GUARD = /* @__PURE__ */ new Set([
	"request/header",
	"request/context",
	"user/message",
	"system/message"
]);
const NO_STEP_GUARD = /* @__PURE__ */ new Set([
	"request/header",
	"request/context",
	"user/message",
	"system/message",
	"developer/message",
	"turn/start",
	"turn/end"
]);
function reduceEvent(state, event) {
	if (!record(event) || !interesting.has(event.type) || !count(event.seq) || !Number.isFinite(event.time) || !record(event.data)) return state;
	if (event.seq <= state.seq) return state;
	const d = event.data;
	const isSurface = SURFACE_TYPES.has(event.type);
	if (event.seq < state.skip && event.type !== "request/header") {
		if (!isSurface || state.surfacePartial) return state;
		const marked = structuredClone(state);
		marked.surfacePartial = true;
		return marked;
	}
	const passesGuards = (NO_TURN_GUARD.has(event.type) || count(d.turn)) && (NO_STEP_GUARD.has(event.type) || count(d.step)) && (event.type !== "assistant/attempt" && event.type !== "assistant/message" || d.stream === void 0 || Array.isArray(d.stream)) && (event.type !== "assistant/attempt" || !!state.open && state.open.turn === d.turn && state.open.step === d.step);
	if (!passesGuards && !isSurface) return state;
	const s = structuredClone(state);
	s.seq = event.seq;
	s.updatedAt = event.time;
	if (isSurface) applySurface(s, event);
	if (!passesGuards) return s;
	if (event.type === "request/header") {
		s.surface.tools = priceTools(d.header);
		const config = d.header?.config;
		if (typeof config?.provider === "string" && typeof config.model === "string") {
			const effort = typeof config.reasoningEffort === "string" ? config.reasoningEffort : null;
			s.route = {
				provider: config.provider,
				model: config.model,
				...effort ? { effort } : {}
			};
			if (s.open) s.open.route = { ...s.route };
			if (s.turn) s.turn.route = { ...s.route };
		}
	} else if (event.type === "request/context") {
		if (count(d.contextWindow)) s.contextWindow = d.contextWindow;
		const provider = typeof d.provider === "string" ? d.provider : null;
		const model = typeof d.model === "string" ? d.model : null;
		if (provider !== null && model !== null) s.route = {
			provider,
			model,
			...s.route.effort ? { effort: s.route.effort } : {}
		};
	} else if (event.type === "user/message") s.previousFailure = null;
	else if (event.type === "turn/start") {
		if (s.open) settle(s, event.time, null, null);
		s.turn = {
			number: d.turn,
			startedAt: event.time,
			endedAt: null,
			steps: 0,
			stats: emptyStats(),
			route: { ...s.route }
		};
		s.previousFailure = null;
		s.tools = [];
	} else if (event.type === "step/start") {
		if (s.open) settle(s, event.time, null, null);
		begin(s, d, event.time);
		if (s.turn) s.turn.steps++;
	} else if (event.type === "assistant/attempt") applyStream(s.open, d.stream);
	else if (event.type === "assistant/message") {
		if (s.open?.turn === d.turn && s.open.step === d.step) {
			applyStream(s.open, d.stream);
			settle(s, event.time, d.usage, d.message?.source);
		}
	} else if (event.type === "llm/retry") {
		if (s.open?.turn === d.turn && s.open.step === d.step) {
			settle(s, event.time, null, null);
			for (const b of books(s)) b.retries++;
			begin(s, d, event.time, true);
		}
	} else if (event.type === "tool/call") {
		const id = d.callId, name = d.name;
		if (typeof id === "string" && typeof name === "string" && !s.tools.some((t) => t.id === id)) {
			s.tools.push({
				id,
				name,
				start: event.time,
				seq: event.seq,
				step: d.step,
				route: { ...s.route },
				signature: signatureOf(name, d.arguments)
			});
			for (const b of books(s)) b.tools++;
		}
	} else if (event.type === "tool/result") {
		const block = d.message?.content?.find?.((b) => b?.type === "tool-result");
		const id = block?.toolCallId ?? d.message?.source?.callId;
		const index = s.tools.findIndex((t) => t.id === id);
		if (index >= 0) {
			const t = s.tools.splice(index, 1)[0];
			const failed = block?.isError === true || record(d.error);
			const dur = elapsed(t.start, event.time);
			for (const b of books(s, t.route)) {
				b.toolMs += dur;
				b.toolErrors += Number(failed);
				if (t.name === "bash") b.bashMs = (b.bashMs ?? 0) + dur;
			}
			const resultHash = block ? fingerprint({
				content: block.content,
				isError: failed,
				code: d.error?.code ?? null
			}) : null;
			const prev = s.previousFailure;
			if (failed && t.signature && resultHash) {
				const same = prev?.signature === t.signature && prev?.resultHash === resultHash && prev?.turn === d.turn;
				const failure = {
					signature: t.signature,
					resultHash,
					turn: d.turn,
					seqs: [...same ? prev.seqs : [], t.seq].slice(-10),
					steps: [...same ? prev.steps : [], t.step].slice(-10)
				};
				s.previousFailure = failure;
				if (failure.seqs.length >= 3) {
					const id = `repeat:${d.turn}:${t.signature.slice(0, 16)}`;
					const finding = {
						id,
						kind: "repeated-failure",
						turn: d.turn,
						seqs: failure.seqs,
						steps: failure.steps,
						title: `第 ${d.turn} 轮 · 同一操作连续失败 ${failure.seqs.length} 次`,
						detail: "参数与错误结果指纹相同；这是重复失败证据，不是确定的空转或质量判决。"
					};
					const old = s.findings.findIndex((f) => f.id === id);
					if (old >= 0) s.findings[old] = finding;
					else {
						s.findingCount++;
						s.findings.push(finding);
						s.findings = s.findings.slice(-30);
					}
				}
			} else s.previousFailure = null;
		}
	} else if (event.type === "step/end") {
		if (s.open?.turn === d.turn && s.open.step === d.step) settle(s, event.time, null, null);
	} else if (event.type === "turn/end") {
		if (s.open) settle(s, event.time, null, null);
		if (s.turn) s.turn.endedAt = event.time;
		s.tools = [];
		s.previousFailure = null;
	}
	return s;
}
const wireCache = /* @__PURE__ */ new WeakMap();
function buildView(s) {
	return {
		version: s.version,
		sessionId: s.sessionId,
		seq: s.seq,
		updatedAt: s.updatedAt,
		totals: s.totals,
		models: s.models,
		days: s.days,
		turn: s.turn,
		pending: s.open ? {
			turn: s.open.turn,
			step: s.open.step,
			start: s.open.start,
			reasoningFirst: s.open.reasoningFirst,
			reasoningLast: s.open.reasoningLast,
			lastContentAt: s.open.lastContentAt
		} : null,
		findings: s.findings,
		findingCount: s.findingCount,
		context: {
			window: s.contextWindow,
			surface: {
				...s.surface,
				total: surfaceTotal(s.surface),
				partial: s.surfacePartial
			},
			projected: surfaceTotal(s.surface)
		},
		requests: s.requests
	};
}
function viewOf(s) {
	let wire = wireCache.get(s);
	if (wire === void 0) {
		wire = buildView(s);
		wireCache.set(s, wire);
	}
	return wire;
}
//#endregion
//#region src/insights/projection.ts
const number = z.number().finite().nonnegative();
const signed = z.number().finite();
const nullableTime = z.number().finite().nullable();
const stats = z.object({
	calls: number,
	reported: number,
	exactTotals: number,
	tokens: number,
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
	reasoning: number,
	reasoningReports: number,
	modelMs: number,
	timedCalls: number,
	firstMs: number,
	firstSamples: number,
	reasoningMs: number,
	tools: number,
	toolErrors: number,
	toolMs: number,
	bashMs: number.optional(),
	retries: number
});
const route = z.object({
	provider: z.string(),
	model: z.string(),
	effort: z.string().nullable().optional()
});
const finding = z.object({
	id: z.string(),
	kind: z.string(),
	turn: number,
	seqs: z.array(number),
	steps: z.array(number),
	title: z.string(),
	detail: z.string()
});
const turn = z.object({
	number,
	startedAt: z.number().finite(),
	endedAt: nullableTime,
	steps: number,
	stats,
	route: route.optional()
}).nullable();
const pending = z.object({
	turn: number,
	step: number,
	start: nullableTime,
	reasoningFirst: nullableTime,
	reasoningLast: nullableTime,
	lastContentAt: nullableTime
}).nullable();
const dayModels = z.array(z.object({
	provider: z.string(),
	model: z.string(),
	effort: z.string().optional(),
	tokens: number
}));
const days = z.array(z.object({
	key: z.string(),
	tokens: number,
	models: dayModels
}));
const usage = z.object({
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
	reasoning: number.nullable(),
	tokens: number,
	exact: z.boolean()
}).nullable();
const bucketKeys = z.enum([
	"system",
	"tools",
	"memory",
	"files",
	"results",
	"conversation"
]);
const surface = z.object({
	system: number,
	tools: number,
	memory: number,
	files: number,
	results: number,
	conversation: number
});
const surfaceTotals = surface.extend({ total: number });
const surfaceDelta = z.object({
	system: signed,
	tools: signed,
	memory: signed,
	files: signed,
	results: signed,
	conversation: signed,
	total: signed
});
const requestRow = z.object({
	turn: number,
	step: number,
	seq: z.number().int(),
	endedAt: z.number().finite(),
	route,
	usage,
	firstMs: nullableTime,
	modelMs: nullableTime,
	reasoningMs: nullableTime,
	surface: surfaceTotals,
	delta: surfaceDelta
});
const context = z.object({
	window: number.nullable(),
	surface: surfaceTotals.extend({ partial: z.boolean() }),
	projected: number
});
const viewSchema = z.object({
	version: z.literal(3),
	sessionId: z.string(),
	seq: z.number().int().min(-1),
	updatedAt: z.number().finite(),
	totals: stats,
	models: z.array(stats.extend({
		provider: z.string(),
		model: z.string(),
		effort: z.string().optional()
	})),
	days,
	turn,
	pending,
	findings: z.array(finding).max(30),
	findingCount: number,
	context,
	requests: z.array(requestRow).max(60)
});
const stateSchema = z.object({
	version: z.literal(3),
	sessionId: z.string(),
	skip: number,
	seq: z.number().int().min(-1),
	updatedAt: z.number().finite(),
	route,
	totals: stats,
	models: z.array(stats.extend({
		provider: z.string(),
		model: z.string()
	})),
	days,
	turn,
	open: z.object({
		turn: number,
		step: number,
		start: nullableTime,
		first: nullableTime,
		reasoningFirst: nullableTime,
		reasoningLast: nullableTime,
		lastContentAt: nullableTime,
		usage,
		route
	}).nullable(),
	tools: z.array(z.object({
		id: z.string(),
		name: z.string(),
		start: z.number().finite(),
		seq: number,
		step: number,
		route,
		signature: z.string().nullable()
	})),
	previousFailure: z.object({
		signature: z.string(),
		resultHash: z.string(),
		turn: number,
		seqs: z.array(number),
		steps: z.array(number)
	}).nullable(),
	findings: z.array(finding).max(30),
	findingCount: number,
	contextWindow: number.nullable(),
	surfaceNodes: z.array(z.object({
		seq: z.number().int(),
		bucket: bucketKeys,
		tokens: number
	})).max(3e3),
	surface,
	surfacePartial: z.boolean(),
	lastSurface: surfaceTotals.nullable(),
	requests: z.array(requestRow).max(60)
});
function installProjection(ctx) {
	ctx.sessionProjections.register({
		key: "watcherInsights",
		stateVersion: 3,
		stateSchema,
		init: (header, inherited) => stateSchema.parse(initialState(header, inherited)),
		apply: (state, event) => reduceEvent(state, event),
		wire: {
			viewSchema,
			view: (state) => viewOf(state)
		}
	});
	ctx.inject(["sessions"], (c) => {
		try {
			for (const session of c.sessions.list?.() ?? []) try {
				c.sessionProjections.snapshot(session);
			} catch (error) {
				c.logger?.warn?.(`dsh-watcher: projection warm-up failed for a session: ${String(error)}`);
			}
		} catch (error) {
			c.logger?.warn?.(`dsh-watcher: session warm-up skipped: ${String(error)}`);
		}
	});
}
//#endregion
//#region src/dsh-watcher.ts
const name = "dsh-watcher";
const inject = ["sessionProjections", "sessions"];
/** Host-owned replayable statistics; no new transport or model-facing writes. */
function apply(ctx) {
	console.log("[my-plugins/dsh-watcher] loaded");
	installProjection(ctx);
}
//#endregion
export { apply, inject, name };
