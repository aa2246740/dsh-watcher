window.__ModuleLoader__.load({
	id: "dsh-watcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/hub/history.js
		/**
		* Pull every older RC8 page in order. The Session remains the sole owner of
		* history continuity; this helper only repeats its public, read-only paging
		* verb and fails closed if one request does not advance the visible head.
		*/
		async function loadCompleteHistory({ read, loadOlder, signal, maxPages = 1e3 }) {
			let pages = 0;
			while (pages < maxPages) {
				if (signal.aborted) return {
					kind: "cancelled",
					pages
				};
				const before = read();
				if (!before.hasMore) return {
					kind: "complete",
					pages
				};
				if (before.loadingOlder) return {
					kind: "blocked",
					pages,
					reason: "busy"
				};
				await loadOlder();
				if (signal.aborted) return {
					kind: "cancelled",
					pages
				};
				const after = read();
				if (!after.hasMore) return {
					kind: "complete",
					pages: pages + 1
				};
				if (after.headKey === before.headKey) return {
					kind: "blocked",
					pages,
					reason: "no-progress"
				};
				pages += 1;
			}
			return {
				kind: "blocked",
				pages,
				reason: "page-limit"
			};
		}
		//#endregion
		//#region lib/types/hub/follow.js
		/**
		* Follow versus pin state for the work rail.
		*
		* The rail follows the newest recorded occurrence by default. Selecting
		* history or scrolling away pins the viewport; later occurrences and result
		* updates increment `unread` without yanking the reader away from evidence.
		*/
		function createFollow() {
			let follow = true;
			let unread = 0;
			let selectedId = null;
			let lastCursor = null;
			let observedOccurrenceIds = [];
			function snapshot() {
				return {
					follow,
					unread,
					selectedId
				};
			}
			function catchUp() {
				follow = true;
				unread = 0;
				selectedId = null;
			}
			return {
				snapshot,
				/** Counts appended occurrences or a settled live result while pinned. */
				onPicture(picture) {
					const groups = picture.nodes;
					if (groups.length === 0) {
						lastCursor = null;
						observedOccurrenceIds = [];
						catchUp();
						return snapshot();
					}
					const occurrenceIds = groups.flatMap((group) => group.items.map((item) => `${group.id}:${item.id}`));
					const group = groups.at(-1);
					const item = group?.items.at(-1);
					const cursor = group === void 0 ? null : item === void 0 ? group.id : `${group.id}:${item.id}:${item.status}:${item.resultSeq ?? "open"}:${item.resultTime ?? "open"}`;
					if (cursor !== null && cursor !== lastCursor) {
						if (!follow && lastCursor !== null) {
							const previousIds = new Set(observedOccurrenceIds);
							const appended = occurrenceIds.filter((id) => !previousIds.has(id)).length;
							unread += Math.max(1, appended);
						}
						lastCursor = cursor;
						if (follow) selectedId = null;
					}
					observedOccurrenceIds = occurrenceIds;
					return snapshot();
				},
				onSelect(id) {
					follow = false;
					selectedId = id;
					return snapshot();
				},
				onScroll({ atBottom }) {
					if (atBottom) {
						if (unread === 0 && selectedId === null) follow = true;
					} else if (follow) follow = false;
					return snapshot();
				},
				setFollow(next) {
					if (next) catchUp();
					else follow = false;
					return snapshot();
				},
				backToLatest() {
					catchUp();
					return snapshot();
				},
				reset() {
					catchUp();
					lastCursor = null;
					observedOccurrenceIds = [];
					return snapshot();
				}
			};
		}
		//#endregion
		//#region lib/types/hub/aggregation.js
		function identityOf(item) {
			if (item.intentKey !== null) return {
				kind: "mutable-target",
				key: `target\u0000${item.intentKey}`
			};
			if (item.toolName === "read" && item.target !== null) return {
				kind: "shared-target",
				key: `target\u0000read\u0000${item.target}`
			};
			if (item.signature !== null) return {
				kind: "exact-call",
				key: `exact\u0000${item.signature}`
			};
			return {
				kind: "single",
				key: `single\u0000${item.id}`
			};
		}
		function emptyStatusCounts() {
			return {
				running: 0,
				waiting: 0,
				success: 0,
				failure: 0,
				returned: 0,
				interrupted: 0,
				unknown: 0
			};
		}
		function countStatuses(items) {
			const counts = emptyStatusCounts();
			for (const item of items) counts[item.status] += 1;
			return counts;
		}
		/**
		* Group one phase for analysis without changing evidence identity or order.
		*
		* - Mutable calls may group by operation + target so changed inputs remain
		*   comparable as iterations.
		* - Reads may group by one exact file target so different line windows stay
		*   comparable.
		* - Search, Glob, Grep, Bash, and every other tool require exact normalized
		*   arguments. Sharing a cwd, broad path, tool name, or translated title is
		*   never enough.
		* - Messages and otherwise unsigned records remain singletons.
		*/
		function clusterWorkItems(items) {
			const accumulators = /* @__PURE__ */ new Map();
			for (const item of items) {
				const identity = identityOf(item);
				const existing = accumulators.get(identity.key);
				if (existing === void 0) accumulators.set(identity.key, {
					basis: identity.kind,
					first: item,
					rest: []
				});
				else existing.rest.push(item);
			}
			const clusters = [];
			for (const accumulator of accumulators.values()) {
				const clusterItems = [accumulator.first, ...accumulator.rest];
				const latest = clusterItems[clusterItems.length - 1];
				if (latest === void 0) continue;
				clusters.push({
					id: `cluster:${accumulator.first.id}`,
					basis: accumulator.basis,
					title: accumulator.first.title,
					items: clusterItems,
					executionCount: clusterItems.length,
					stepCount: new Set(clusterItems.map((item) => item.step)).size,
					retryCount: clusterItems.filter((item) => item.retryOf !== null).length,
					iterationCount: clusterItems.filter((item) => item.iterationIndex > 0).length,
					latestStatus: latest.status,
					statusCounts: countStatuses(clusterItems)
				});
			}
			return clusters;
		}
		function clusterOutcomeSummary(cluster) {
			const counts = cluster.statusCounts;
			return [
				counts.running > 0 ? `${counts.running} 进行中` : null,
				counts.waiting > 0 ? `${counts.waiting} 等待` : null,
				counts.success > 0 ? `${counts.success} 成功` : null,
				counts.failure > 0 ? `${counts.failure} 失败` : null,
				counts.returned > 0 ? `${counts.returned} 已返回` : null,
				counts.interrupted > 0 ? `${counts.interrupted} 已中断` : null,
				counts.unknown > 0 ? `${counts.unknown} 未知` : null
			].filter((part) => part !== null).join(" · ");
		}
		//#endregion
		//#region lib/types/observation/model-trace.js
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function finiteNumber(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : null;
		}
		function nonNegativeNumber(value) {
			const number = finiteNumber(value);
			return number !== null && number >= 0 ? number : null;
		}
		function locationOf(value) {
			const data = value.data;
			if (!isRecord$1(data)) return null;
			const turn = finiteNumber(data.turn);
			const step = finiteNumber(data.step);
			const seq = finiteNumber(value.seq);
			const time = finiteNumber(value.time);
			return turn === null || step === null || seq === null || time === null ? null : {
				turn,
				step,
				seq,
				time
			};
		}
		function reasoningTokensOf(value) {
			return isRecord$1(value) ? nonNegativeNumber(value.reasoningTokens) : null;
		}
		function reasoningTextOf(value) {
			if (!isRecord$1(value) || !Array.isArray(value.content)) return null;
			const parts = value.content.flatMap((block) => isRecord$1(block) && block.type === "reasoning" && typeof block.text === "string" ? [block.text] : []);
			return parts.length === 0 ? null : parts.join("\n\n");
		}
		/**
		* Read the durable attempt stream 0.1.5-rc.1 settles into `assistant/message`
		* and `assistant/attempt`: delta runs pack `time0` plus per-gap `dt`, while
		* block/usage/finish chunks stay raw with their own `time`. Fragment `seq`s are
		* positions inside that stream, not Session seqs — the records do not carry
		* any, and the UI only counts fragments.
		* @param stream - the raw `data.stream` value.
		* @param seq - event seq the fragments hang off.
		* @returns the evidence, or null when the stream carries none.
		*/
		function attemptStreamOf(stream, seq) {
			if (!Array.isArray(stream)) return null;
			const fragments = [];
			let firstOutputTime = null;
			let position = 0;
			for (const value of stream) {
				if (!isRecord$1(value)) continue;
				if (value.type === "reasoning-chunks" || value.type === "text-chunks" || value.type === "tool-call-chunks") {
					const reasoning = value.type === "reasoning-chunks";
					const parts = value.type === "tool-call-chunks" ? value.args : value.texts;
					const gaps = value.dt;
					const time0 = value.time0;
					if (!Number.isSafeInteger(time0)) continue;
					if (!Array.isArray(parts) || parts.length === 0) continue;
					if (!Array.isArray(gaps) || gaps.length !== parts.length - 1) continue;
					let time = time0;
					for (let index = 0; index < parts.length; index++) {
						if (index > 0) {
							const gap = gaps[index - 1];
							if (!Number.isSafeInteger(gap)) {
								time = NaN;
								break;
							}
							time += gap;
						}
						if (!Number.isSafeInteger(time)) break;
						const text = parts[index];
						if (reasoning && typeof text === "string" && text !== "") fragments.push({
							seq: seq + position,
							time,
							text
						});
						if (!reasoning && firstOutputTime === null) firstOutputTime = time;
						position += 1;
					}
					continue;
				}
				if (value.type !== "chunk" || !isRecord$1(value.chunk) || !Number.isSafeInteger(value.time)) continue;
				const type = value.chunk.type;
				if (type !== "reasoning-delta" && type !== "text-delta" && type !== "tool-call-delta") continue;
				const time = value.time;
				const text = value.chunk.text;
				if (type === "reasoning-delta" && typeof text === "string" && text !== "") fragments.push({
					seq: seq + position,
					time,
					text
				});
				if (type !== "reasoning-delta" && firstOutputTime === null) firstOutputTime = time;
				position += 1;
			}
			return fragments.length === 0 && firstOutputTime === null ? null : {
				fragments,
				firstOutputTime
			};
		}
		/** Parse only the seven event shapes needed by the read-only model-stage fold. */
		function modelTraceEventOf(value) {
			if (!isRecord$1(value) || typeof value.type !== "string") return null;
			const location = locationOf(value);
			if (location === null || !isRecord$1(value.data)) return null;
			const data = value.data;
			if (value.type === "step/start") return {
				...location,
				kind: "step-start"
			};
			if (value.type === "step/end") return {
				...location,
				kind: "step-end"
			};
			if (value.type === "llm/retry") {
				const retry = nonNegativeNumber(data.retry);
				const delayMs = nonNegativeNumber(data.delayMs);
				return retry === null || delayMs === null ? null : {
					...location,
					kind: "retry",
					retry,
					delayMs
				};
			}
			if (value.type === "assistant/message" || value.type === "assistant/attempt") {
				const evidence = attemptStreamOf(data.stream, location.seq);
				const fragments = evidence?.fragments ?? [];
				const firstOutputTime = evidence?.firstOutputTime ?? null;
				return value.type === "assistant/attempt" ? {
					...location,
					kind: "attempt",
					fragments,
					firstOutputTime
				} : {
					...location,
					kind: "message",
					reasoningText: reasoningTextOf(data.message),
					reasoningTokens: reasoningTokensOf(data.usage),
					fragments,
					firstOutputTime
				};
			}
			if ([
				"chunkrow/reasoning-chunks",
				"chunkrow/text-chunks",
				"chunkrow/tool-call-chunks"
			].includes(value.type)) {
				const tool = value.type === "chunkrow/tool-call-chunks";
				const parts = tool ? data.args : data.texts;
				const gaps = data.dt;
				if (!Array.isArray(parts) || !parts.length || !parts.every((p) => typeof p === "string") || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger)) return null;
				let time = location.time;
				const fragments = [];
				for (let i = 0; i < parts.length; i++) {
					if (i > 0) time += gaps[i - 1];
					if (!Number.isSafeInteger(time)) return null;
					const text = parts[i];
					if (text !== "" || tool && typeof data.name === "string") fragments.push({
						seq: location.seq + i,
						time,
						text
					});
				}
				const first = fragments[0];
				if (!first) return null;
				const base = {
					...location,
					time: first.time,
					lastSeq: location.seq + parts.length - 1
				};
				return value.type === "chunkrow/reasoning-chunks" ? {
					...base,
					kind: "reasoning-delta",
					text: fragments.map((f) => f.text).join(""),
					fragments
				} : {
					...base,
					kind: "output-delta"
				};
			}
			if (!["assistant/live-chunk", "assistant/chunk"].includes(value.type) || !isRecord$1(data.chunk) || typeof data.chunk.type !== "string") return null;
			const chunk = data.chunk;
			if (chunk.type === "reasoning-delta") return typeof chunk.text === "string" && chunk.text !== "" ? {
				...location,
				kind: "reasoning-delta",
				text: chunk.text
			} : null;
			if (chunk.type === "text-delta") return typeof chunk.text === "string" && chunk.text !== "" ? {
				...location,
				kind: "output-delta"
			} : null;
			if (chunk.type === "tool-call-delta") return typeof chunk.argumentsDelta === "string" && chunk.argumentsDelta !== "" || typeof chunk.name === "string" ? {
				...location,
				kind: "output-delta"
			} : null;
			if (chunk.type === "usage") return {
				...location,
				kind: "usage",
				reasoningTokens: reasoningTokensOf(chunk.usage)
			};
			return null;
		}
		function runningAttempt(attempt, startedAt) {
			return {
				kind: "running",
				attempt,
				startedAt,
				firstTokenTime: null,
				firstReasoningTime: null,
				lastReasoningTime: null,
				firstOutputTime: null,
				reasoningText: "",
				fragments: []
			};
		}
		function startModelStepTrace(event) {
			return {
				turn: event.turn,
				step: event.step,
				startSeq: event.seq,
				lastSeq: event.seq,
				startTime: event.time,
				attempts: [runningAttempt(1, event.time)],
				reasoningTokens: null
			};
		}
		function replaceLast(attempts, attempt) {
			if (attempts.length === 1) return [attempt];
			return [
				attempts[0],
				...attempts.slice(1, -1),
				attempt
			];
		}
		function appendAttempt(attempts, attempt) {
			return [...attempts, attempt];
		}
		function sameStep(trace, event) {
			return trace.turn === event.turn && trace.step === event.step;
		}
		/**
		* Fold durable settled-stream evidence onto one attempt. The stream is the
		* authoritative record of what the provider actually emitted, so it replaces
		* whatever the live rows had accumulated — never the other way around.
		* @param attempt - attempt state before settlement.
		* @param event - normalized event carrying the settled evidence.
		* @returns the attempt with real fragment times, or the input when the log
		* carries no durable stream (pre-0.1.5 transcripts).
		*/
		function applyStreamEvidence(attempt, event) {
			if (event.fragments.length === 0 && event.firstOutputTime === null) return attempt;
			const first = event.fragments[0];
			const last = event.fragments.at(-1);
			return {
				...attempt,
				firstTokenTime: attempt.firstTokenTime ?? first?.time ?? event.firstOutputTime,
				firstReasoningTime: first?.time ?? attempt.firstReasoningTime,
				lastReasoningTime: last?.time ?? attempt.lastReasoningTime,
				reasoningText: event.fragments.length === 0 ? attempt.reasoningText : event.fragments.map((f) => f.text).join(""),
				fragments: event.fragments.length === 0 ? attempt.fragments : event.fragments,
				firstOutputTime: attempt.firstOutputTime ?? event.firstOutputTime
			};
		}
		/** Fold one normalized event without discarding reasoning from a retried attempt. */
		function updateModelStepTrace(trace, event) {
			if (!sameStep(trace, event) || event.kind === "step-start") return trace;
			const current = {
				...trace,
				lastSeq: Math.max(trace.lastSeq, event.lastSeq ?? event.seq)
			};
			const attempt = trace.attempts.at(-1);
			if (attempt === void 0) return trace;
			if (event.kind === "usage") return event.reasoningTokens === null ? current : {
				...current,
				reasoningTokens: event.reasoningTokens
			};
			if (event.kind === "reasoning-delta") {
				if (attempt.kind !== "running") return current;
				const fragments = event.fragments ?? [{
					seq: event.seq,
					time: event.time,
					text: event.text
				}];
				return {
					...current,
					attempts: replaceLast(trace.attempts, {
						...attempt,
						firstTokenTime: attempt.firstTokenTime ?? event.time,
						firstReasoningTime: attempt.firstReasoningTime ?? event.time,
						lastReasoningTime: fragments.at(-1)?.time ?? event.time,
						reasoningText: attempt.reasoningText + event.text,
						fragments: [...attempt.fragments, ...fragments]
					})
				};
			}
			if (event.kind === "output-delta") {
				if (attempt.kind !== "running") return current;
				return {
					...current,
					attempts: replaceLast(trace.attempts, {
						...attempt,
						firstTokenTime: attempt.firstTokenTime ?? event.time,
						firstOutputTime: attempt.firstOutputTime ?? event.time
					})
				};
			}
			if (event.kind === "retry") {
				if (attempt.kind !== "running") return current;
				const retried = {
					...attempt,
					kind: "retried",
					endedAt: event.time,
					retry: event.retry,
					retryDelayMs: event.delayMs
				};
				return {
					...current,
					attempts: appendAttempt(replaceLast(trace.attempts, retried), runningAttempt(attempt.attempt + 1, null))
				};
			}
			if (event.kind === "attempt") {
				if (attempt.kind !== "running") return current;
				return {
					...current,
					attempts: replaceLast(trace.attempts, applyStreamEvidence(attempt, event))
				};
			}
			if (event.kind === "message") {
				const reasoningTokens = event.reasoningTokens ?? trace.reasoningTokens;
				if (attempt.kind !== "running") return {
					...current,
					reasoningTokens
				};
				const settled = applyStreamEvidence(attempt, event);
				return {
					...current,
					reasoningTokens,
					attempts: replaceLast(trace.attempts, {
						...settled,
						kind: "complete",
						endedAt: event.time,
						reasoningText: event.reasoningText ?? settled.reasoningText
					})
				};
			}
			if (attempt.kind !== "running") return current;
			return {
				...current,
				attempts: replaceLast(trace.attempts, {
					...attempt,
					kind: "interrupted",
					endedAt: event.time
				})
			};
		}
		function attemptEnd(attempt, now) {
			return attempt.kind === "running" ? now : attempt.endedAt;
		}
		function firstTokenTime(trace) {
			for (const attempt of trace.attempts) if (attempt.firstTokenTime !== null) return attempt.firstTokenTime;
			return null;
		}
		function visibleReasoningDuration(trace, _now) {
			let sampled = false;
			let total = 0;
			for (const attempt of trace.attempts) {
				if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) continue;
				if (attempt.firstOutputTime !== null && attempt.lastReasoningTime > attempt.firstOutputTime) continue;
				sampled = true;
				const end = attempt.lastReasoningTime;
				total += Math.max(0, end - attempt.firstReasoningTime);
			}
			return sampled ? total : null;
		}
		/** Derive additive display segments without calling unobserved latency Thinking. */
		function modelStageMetrics(trace, now) {
			const last = trace.attempts.at(-1);
			const live = last?.kind === "running";
			const end = last === void 0 ? null : attemptEnd(last, now);
			const totalMs = trace.startTime === null || end === null ? null : Math.max(0, end - trace.startTime);
			const firstToken = firstTokenTime(trace);
			const firstResponseMs = trace.startTime === null || firstToken === null ? null : Math.max(0, firstToken - trace.startTime);
			const visibleReasoningMs = visibleReasoningDuration(trace, now);
			const finalReasoning = last?.lastReasoningTime ?? null;
			const outputStart = last?.firstOutputTime ?? null;
			const outputMs = outputStart === null || end === null || live && finalReasoning !== null && last?.firstOutputTime === null ? null : Math.max(0, end - outputStart);
			const attributed = (firstResponseMs ?? 0) + (visibleReasoningMs ?? 0) + (outputMs ?? 0);
			const unattributedMs = totalMs === null ? null : Math.max(0, totalMs - attributed);
			return {
				kind: trace.startTime === null ? "partial" : "measured",
				live,
				totalMs,
				firstResponseMs,
				visibleReasoningMs,
				outputMs,
				unattributedMs
			};
		}
		function hasReasoningEvidence(trace) {
			return trace.attempts.some((attempt) => attempt.reasoningText.trim() !== "" || attempt.fragments.length > 0);
		}
		//#endregion
		//#region lib/types/observation/fold.js
		const EMPTY_NOW = Object.freeze({
			phase: "other",
			label: "",
			status: "unknown"
		});
		const EMPTY_PICTURE = Object.freeze({
			nodes: [],
			turns: [],
			now: EMPTY_NOW,
			actionCount: 0,
			stepCount: 0,
			turnCount: 0,
			parallelStepCount: 0,
			retryCount: 0,
			iterationCount: 0,
			pendingCount: 0,
			unconfirmedFailureCount: 0,
			running: false,
			partialHistory: false
		});
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function recordAt(value, key) {
			if (!isRecord(value)) return null;
			const child = value[key];
			return isRecord(child) ? child : null;
		}
		function stringAt(value, key) {
			return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
		}
		function numberAt(value, key) {
			return isRecord(value) && typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : null;
		}
		function parseArgs(raw) {
			if (isRecord(raw)) return raw;
			if (typeof raw !== "string" || raw.trim() === "") return {};
			try {
				const parsed = JSON.parse(raw);
				return isRecord(parsed) ? parsed : {};
			} catch {
				return {};
			}
		}
		function stableValue(value) {
			if (Array.isArray(value)) return value.map(stableValue);
			if (!isRecord(value)) return value;
			return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
		}
		/** Stable exact signature used only for evidence-backed retry detection. */
		function normalizedSignature(toolName, args) {
			return `${toolName}\u0000${JSON.stringify(stableValue(args))}`;
		}
		function safeStringify(value) {
			try {
				return JSON.stringify(value, null, 2);
			} catch {
				return String(value);
			}
		}
		function textFromContent(value, output = []) {
			if (Array.isArray(value)) {
				for (const child of value) textFromContent(child, output);
				return output;
			}
			if (!isRecord(value)) return output;
			if (value.type === "text" && typeof value.text === "string") {
				output.push(value.text);
				return output;
			}
			if (typeof value.output === "string") output.push(value.output);
			if (Array.isArray(value.content)) textFromContent(value.content, output);
			if (isRecord(value.message)) textFromContent(value.message, output);
			return output;
		}
		function resultText(value) {
			return textFromContent(value).filter(Boolean).join("\n");
		}
		function findNumberByKeys(value, keys, depth = 0) {
			if (depth > 8) return null;
			if (Array.isArray(value)) {
				for (const child of value) {
					const found = findNumberByKeys(child, keys, depth + 1);
					if (found !== null) return found;
				}
				return null;
			}
			if (!isRecord(value)) return null;
			for (const [key, child] of Object.entries(value)) if (keys.has(key) && typeof child === "number" && Number.isFinite(child)) return child;
			for (const child of Object.values(value)) {
				const found = findNumberByKeys(child, keys, depth + 1);
				if (found !== null) return found;
			}
			return null;
		}
		function findStringByKeys(value, keys, depth = 0) {
			if (depth > 8) return null;
			if (Array.isArray(value)) {
				for (const child of value) {
					const found = findStringByKeys(child, keys, depth + 1);
					if (found !== null) return found;
				}
				return null;
			}
			if (!isRecord(value)) return null;
			for (const [key, child] of Object.entries(value)) if (keys.has(key) && typeof child === "string") return child;
			for (const child of Object.values(value)) {
				const found = findStringByKeys(child, keys, depth + 1);
				if (found !== null) return found;
			}
			return null;
		}
		function findBooleanByKeys(value, keys, depth = 0) {
			if (depth > 6) return null;
			if (Array.isArray(value)) {
				for (const child of value) {
					const found = findBooleanByKeys(child, keys, depth + 1);
					if (found !== null) return found;
				}
				return null;
			}
			if (!isRecord(value)) return null;
			for (const [key, child] of Object.entries(value)) if (keys.has(key) && typeof child === "boolean") return child;
			for (const child of Object.values(value)) {
				const found = findBooleanByKeys(child, keys, depth + 1);
				if (found !== null) return found;
			}
			return null;
		}
		function exitCodeOf(...values) {
			const keys = new Set(["exitCode", "exit_code"]);
			for (const value of values) {
				const found = findNumberByKeys(value, keys);
				if (found !== null) return found;
				const text = resultText(value);
				const marker = text.match(/\[exit code:\s*(-?\d+)\]/i) ?? text.match(/"(?:exitCode|exit_code)"\s*:\s*(-?\d+)/);
				if (marker?.[1] !== void 0) return Number(marker[1]);
			}
			return null;
		}
		function signalOf(...values) {
			const keys = new Set(["signal"]);
			for (const value of values) {
				const found = findStringByKeys(value, keys);
				if (found !== null) return found;
			}
			return null;
		}
		function errorFlagOf(value) {
			return findBooleanByKeys(value, new Set(["isError"])) === true;
		}
		function domainOutcomeOf(...values) {
			for (const value of values) {
				const boolean = findBooleanByKeys(value, new Set(["ok", "success"]));
				if (boolean !== null) return boolean ? "success" : "failure";
				const status = findStringByKeys(value, new Set(["status", "outcome"]))?.toLowerCase();
				if (status !== void 0 && status !== null) {
					if (/^(ok|success|succeeded|passed|done|completed)$/.test(status)) return "success";
					if (/^(error|failed|failure|denied|cancelled|canceled)$/.test(status)) return "failure";
				}
			}
			return null;
		}
		function parseJsonCandidate(text) {
			const trimmed = text.trim();
			if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
			try {
				const parsed = JSON.parse(trimmed);
				return typeof parsed === "object" && parsed !== null ? parsed : null;
			} catch {
				return null;
			}
		}
		function baseName(path) {
			return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
		}
		function stringArg(args, ...keys) {
			for (const key of keys) {
				const value = args[key];
				if (typeof value === "string" && value.trim() !== "") return value;
			}
			return null;
		}
		function commandOf(args) {
			return stringArg(args, "command", "cmd") ?? "";
		}
		function commandPreview(command) {
			const oneLine = command.replace(/\s+/g, " ").trim();
			if (oneLine.length <= 52) return oneLine;
			return `${oneLine.slice(0, 49)}…`;
		}
		function targetOf(name, args) {
			const direct = stringArg(args, "file_path", "path", "url", "query", "pattern", "name", "plugin");
			if (direct !== null) return direct;
			if (name === "bash") return commandOf(args).match(/(?:^|\s)(\.?\.?\/[\w./-]+|\/[\w./-]+)/)?.[1] ?? null;
			return null;
		}
		function isVerificationCommand(command) {
			return /(?:^|\s)(?:test|typecheck|check|verify|lint|vitest|jest|tsc|build)(?:\s|$)|dshx\s+check/i.test(command);
		}
		function isActivationCommand(command) {
			return /dshx\s+(?:activation-plan|sync-artifact|ship|install|start)|dsh\s+plugin\s+(?:add|remove)/i.test(command);
		}
		function phaseOfTool(name, args, callView) {
			const kind = stringAt(callView, "kind");
			if (/^(skill|todo_write|create_goal|update_goal|get_goal|update_plan)$/.test(name)) return "plan";
			if (/^(read|grep|glob|find|search|web_search|web_fetch|web_open)$/.test(name)) return "investigate";
			if (/^(write|edit|apply_patch|imagegen|image_gen)/.test(name)) return "build";
			if (/^(dshx_activation_plan|dshx_sync_artifact|dshx_ship|dshx_install|dshx_start)/.test(name)) return "activate";
			if (/^(dshx_check|dshx_verify|dshx_which|dshx_status)/.test(name)) return "verify";
			if (name.startsWith("cua_") || name.includes("computer")) return "desktop";
			if (name === "bash") {
				const command = commandOf(args);
				if (isActivationCommand(command)) return "activate";
				if (isVerificationCommand(command)) return "verify";
				if (/\b(?:sed|head|tail|ls|find|rg|grep|git\s+(?:status|diff|log|show))\b/.test(command)) return "investigate";
				return "build";
			}
			if (kind === "read" || kind === "search" || kind === "fetch") return "investigate";
			if (kind === "edit" || kind === "delete" || kind === "move") return "build";
			if (kind === "execute") return "build";
			return "other";
		}
		function titleOfTool(name, args, callView) {
			const target = targetOf(name, args);
			if (name === "read") return `读取 ${target === null ? "文件" : baseName(target)}`;
			if (name === "grep") return `搜索 ${stringArg(args, "pattern") ?? "内容"}`;
			if (name === "glob") return `查找 ${stringArg(args, "pattern") ?? "文件"}`;
			if (name === "write") return `写入 ${target === null ? "文件" : baseName(target)}`;
			if (name === "edit") return `修改 ${target === null ? "文件" : baseName(target)}`;
			if (name === "apply_patch") return "应用代码补丁";
			if (name === "bash") {
				const description = stringArg(args, "description");
				if (description !== null) return description;
				const command = commandOf(args);
				return command === "" ? "运行命令" : `运行 ${commandPreview(command)}`;
			}
			if (name === "skill") return "读取工作说明";
			if (name === "todo_write" || name === "update_plan") return "更新工作计划";
			if (name === "create_goal") return "建立任务目标";
			if (name === "update_goal") return "更新任务目标";
			if (name === "get_goal") return "核对任务目标";
			if (name === "dshx_status" || name === "dshx_which") return "核对 DSHX 环境";
			if (name === "dshx_check") return "检查插件合同";
			if (name === "dshx_activation_plan") return "规划插件激活";
			if (name === "dshx_sync_artifact") return "同步插件产物";
			return stringAt(callView, "title") ?? (name.replaceAll("_", " ") || "未知执行");
		}
		function subtitleOfTool(name, args, target) {
			if (target !== null) return target;
			if (name === "bash") return commandOf(args) || name;
			return stringArg(args, "query", "pattern") ?? name;
		}
		function validReadPresentation(value) {
			if (!isRecord(value) || value.card !== "read" || !Array.isArray(value.lines)) return null;
			const lines = [];
			for (const line of value.lines) {
				if (!isRecord(line) || typeof line.number !== "number" || typeof line.text !== "string") return null;
				lines.push({
					number: line.number,
					text: line.text
				});
			}
			const totalLines = typeof value.totalLines === "number" ? value.totalLines : lines.length;
			return {
				kind: "read",
				label: typeof value.title === "string" ? value.title : typeof value.path === "string" ? value.path : "文件",
				lang: typeof value.lang === "string" ? value.lang : null,
				lines,
				totalLines
			};
		}
		function validReadMeta(value) {
			if (!isRecord(value) || !Array.isArray(value.lines) || typeof value.path !== "string") return null;
			const lines = [];
			for (const line of value.lines) {
				if (!isRecord(line) || typeof line.number !== "number" || typeof line.text !== "string") return null;
				lines.push({
					number: line.number,
					text: line.text
				});
			}
			return {
				kind: "read",
				label: value.path,
				lang: typeof value.lang === "string" ? value.lang : null,
				lines,
				totalLines: typeof value.totalLines === "number" ? value.totalLines : lines.length
			};
		}
		function validDiffs(value) {
			if (!Array.isArray(value)) return null;
			const diffs = [];
			for (const diff of value) {
				if (!isRecord(diff) || typeof diff.path !== "string" || typeof diff.newText !== "string") return null;
				if (diff.oldText !== null && typeof diff.oldText !== "string") return null;
				diffs.push({
					path: diff.path,
					oldText: diff.oldText,
					newText: diff.newText
				});
			}
			return diffs;
		}
		function diffFromArgs(name, args) {
			const path = stringArg(args, "file_path", "path");
			if (path === null) return null;
			if (name === "write" && typeof args.content === "string") return {
				kind: "diff",
				diffs: [{
					path,
					oldText: null,
					newText: args.content
				}]
			};
			if (name === "edit" && typeof args.old_string === "string" && typeof args.new_string === "string") return {
				kind: "diff",
				diffs: [{
					path,
					oldText: args.old_string,
					newText: args.new_string
				}]
			};
			return null;
		}
		function presentationOf(pair, rawText, exitCode, signal) {
			const call = isRecord(pair.callView) ? pair.callView : null;
			const result = isRecord(pair.resultView) ? pair.resultView : null;
			if (result?.card === "terminal" || pair.result === null && call?.card === "terminal" || pair.name === "bash") return {
				kind: "terminal",
				command: typeof result?.title === "string" ? result.title : typeof call?.title === "string" ? call.title : commandOf(pair.args),
				cwd: typeof call?.cwd === "string" ? call.cwd : stringArg(pair.args, "workdir", "cwd"),
				output: typeof result?.output === "string" ? result.output : rawText,
				exitCode,
				signal,
				running: pair.result === null
			};
			const read = validReadPresentation(result) ?? validReadMeta(pair.meta);
			if (read !== null) return read;
			const resultDiffs = result?.card === "diff" ? validDiffs(result.diffs) : null;
			const callDiffs = call?.card === "diff" ? validDiffs(call.diffs) : null;
			const diffs = resultDiffs ?? callDiffs;
			if (diffs !== null) return {
				kind: "diff",
				diffs
			};
			const argDiff = diffFromArgs(pair.name, pair.args);
			if (argDiff !== null) return argDiff;
			if (result !== null && result.card !== "generic") return {
				kind: "json",
				data: result
			};
			if (isRecord(pair.meta) || Array.isArray(pair.meta)) return {
				kind: "json",
				data: pair.meta
			};
			const parsed = parseJsonCandidate(rawText);
			if (parsed !== null) return {
				kind: "json",
				data: parsed
			};
			if (rawText !== "") return {
				kind: "text",
				text: rawText
			};
			return { kind: "empty" };
		}
		function recognizedResultView(value) {
			if (!isRecord(value) || typeof value.card !== "string") return false;
			return new Set([
				"generic",
				"terminal",
				"diff",
				"search",
				"read",
				"web"
			]).has(value.card);
		}
		function statusOfTool(pair, exitCode, signal) {
			if (pair.result === null) return "running";
			if (errorFlagOf(pair.result) || signal !== null || exitCode !== null && exitCode !== 0) return "failure";
			if (exitCode === 0) return "success";
			const domain = domainOutcomeOf(pair.meta, pair.resultView, pair.result);
			if (domain !== null) return domain;
			if (recognizedResultView(pair.resultView)) return "success";
			if (pair.orphan && pair.name === "") return "unknown";
			return "returned";
		}
		function mutableIntent(name) {
			return /^(write|edit|apply_patch|imagegen|image_gen)/.test(name);
		}
		function toolItem(pair) {
			const rawText = pair.result === null ? "" : resultText(pair.result);
			const exitCode = exitCodeOf(pair.resultView, pair.meta, pair.result);
			const signal = signalOf(pair.resultView, pair.meta, pair.result);
			const target = targetOf(pair.name, pair.args);
			const signature = pair.name === "" ? null : normalizedSignature(pair.name, pair.args);
			const intentKey = mutableIntent(pair.name) && target !== null ? `${pair.name}\u0000${target}` : null;
			const status = statusOfTool(pair, exitCode, signal);
			return {
				id: `tool:${pair.callId}`,
				seq: pair.seq,
				resultSeq: pair.resultSeq,
				time: pair.time,
				resultTime: pair.resultTime,
				turn: pair.turn,
				step: pair.step,
				source: "tool",
				phase: phaseOfTool(pair.name, pair.args, pair.callView),
				status,
				title: pair.orphan && pair.name === "" ? `未配对结果 ${pair.callId}` : titleOfTool(pair.name, pair.args, pair.callView),
				subtitle: subtitleOfTool(pair.name, pair.args, target),
				toolName: pair.name || null,
				callId: pair.callId,
				args: pair.args,
				argsRaw: pair.argsRaw || null,
				rawText,
				rawValue: pair.meta ?? pair.result,
				presentation: presentationOf(pair, rawText, exitCode, signal),
				durationMs: pair.resultTime === null ? null : Math.max(0, pair.resultTime - pair.time),
				exitCode,
				signal,
				signature,
				intentKey,
				target,
				retryOf: null,
				retryIndex: 0,
				iterationIndex: 0,
				recoveredBy: null
			};
		}
		function contentText(value) {
			if (!Array.isArray(value)) return "";
			return value.flatMap((block) => isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
		}
		function messageItem(node, coordinates, source, text) {
			const phase = source === "user" ? "request" : source === "steering" ? "steering" : "answer";
			const title = source === "user" ? "用户提出任务" : source === "steering" ? "用户补充要求" : "完成回复";
			const clean = text.replace(/\s+/g, " ").trim();
			return {
				id: `${source}:${node.seq}`,
				seq: node.seq,
				resultSeq: null,
				time: node.time,
				resultTime: null,
				turn: coordinates.turn,
				step: coordinates.step,
				source,
				phase,
				status: "returned",
				title,
				subtitle: clean.length > 76 ? `${clean.slice(0, 73)}…` : clean,
				toolName: null,
				callId: null,
				args: {},
				argsRaw: null,
				rawText: text,
				rawValue: text,
				presentation: text === "" ? { kind: "empty" } : {
					kind: "text",
					text
				},
				durationMs: null,
				exitCode: null,
				signal: null,
				signature: null,
				intentKey: null,
				target: null,
				retryOf: null,
				retryIndex: 0,
				iterationIndex: 0,
				recoveredBy: null
			};
		}
		function imageItems(node, coordinates) {
			const items = [];
			let imageIndex = 0;
			for (const block of node.blocks) {
				if (block.kind !== "image") continue;
				imageIndex++;
				items.push({
					id: `artifact:${node.seq}:${imageIndex}`,
					seq: node.seq + imageIndex / 1e3,
					resultSeq: null,
					time: node.time,
					resultTime: null,
					turn: coordinates.turn,
					step: coordinates.step,
					source: "artifact",
					phase: "build",
					status: "success",
					title: "生成图片",
					subtitle: `图片附件 ${imageIndex}`,
					toolName: null,
					callId: null,
					args: {},
					argsRaw: null,
					rawText: "",
					rawValue: block.attachment,
					presentation: {
						kind: "image",
						attachment: block.attachment
					},
					durationMs: null,
					exitCode: null,
					signal: null,
					signature: null,
					intentKey: null,
					target: null,
					retryOf: null,
					retryIndex: 0,
					iterationIndex: 0,
					recoveredBy: null
				});
			}
			return items;
		}
		function turnStateItem(seq, time, coordinates, status, message) {
			return {
				id: `turn:${seq}`,
				seq,
				resultSeq: null,
				time,
				resultTime: null,
				turn: coordinates.turn,
				step: coordinates.step,
				source: "turn",
				phase: "failure",
				status,
				title: status === "interrupted" ? "本轮已中断" : "本轮失败",
				subtitle: message,
				toolName: null,
				callId: null,
				args: {},
				argsRaw: null,
				rawText: message,
				rawValue: message,
				presentation: {
					kind: "text",
					text: message
				},
				durationMs: null,
				exitCode: null,
				signal: null,
				signature: null,
				intentKey: null,
				target: null,
				retryOf: null,
				retryIndex: 0,
				iterationIndex: 0,
				recoveredBy: null
			};
		}
		function interactionItem(id, seq, time, coordinates, status, subtitle, durationMs, rawValue) {
			return {
				id: `interaction:${id}`,
				seq,
				resultSeq: null,
				time,
				resultTime: durationMs === null ? null : time + durationMs,
				turn: coordinates.turn,
				step: coordinates.step,
				source: "interaction",
				phase: "wait",
				status,
				title: status === "waiting" ? "等待你决定" : "你已作决定",
				subtitle,
				toolName: null,
				callId: null,
				args: {},
				argsRaw: null,
				rawText: safeStringify(rawValue),
				rawValue,
				presentation: isRecord(rawValue) ? {
					kind: "json",
					data: rawValue
				} : {
					kind: "text",
					text: String(rawValue)
				},
				durationMs,
				exitCode: null,
				signal: null,
				signature: null,
				intentKey: null,
				target: null,
				retryOf: null,
				retryIndex: 0,
				iterationIndex: 0,
				recoveredBy: null
			};
		}
		function modelItem(trace) {
			const attempt = trace.attempts.at(-1);
			const running = attempt?.kind === "running";
			const interrupted = attempt?.kind === "interrupted";
			const resultTime = attempt === void 0 || running ? null : attempt.endedAt;
			const time = trace.startTime ?? attempt?.firstTokenTime ?? attempt?.firstReasoningTime ?? resultTime ?? 0;
			return {
				id: `model:${trace.turn}:${trace.step}`,
				seq: trace.startSeq,
				resultSeq: running ? null : trace.lastSeq,
				time,
				resultTime,
				turn: trace.turn,
				step: trace.step,
				source: "model",
				phase: "model",
				status: running ? "running" : interrupted ? "interrupted" : "returned",
				title: running ? "模型正在生成" : "模型响应",
				subtitle: hasReasoningEvidence(trace) ? "包含可见推理记录" : "模型活动记录",
				toolName: null,
				callId: null,
				args: {},
				argsRaw: null,
				rawText: "",
				rawValue: trace,
				presentation: { kind: "empty" },
				durationMs: resultTime === null ? null : Math.max(0, resultTime - time),
				exitCode: null,
				signal: null,
				signature: null,
				intentKey: null,
				target: null,
				retryOf: null,
				retryIndex: 0,
				iterationIndex: 0,
				recoveredBy: null
			};
		}
		function withModelPlaceholders(items, traces) {
			const occupied = new Set(items.map((item) => `${item.turn}:${item.step}`));
			const next = [...items];
			for (const trace of traces) if (!occupied.has(`${trace.turn}:${trace.step}`)) next.push(modelItem(trace));
			return next;
		}
		function coordinatesOfLocation(value) {
			if (!isRecord(value)) return null;
			if (value.kind === "step") {
				const turn = recordAt(value, "turn");
				const step = recordAt(value, "step");
				if (typeof turn?.turn === "number" && typeof step?.step === "number") return {
					turn: turn.turn,
					step: step.step
				};
			}
			if (value.kind === "turn") {
				const turn = recordAt(value, "turn");
				if (typeof turn?.turn === "number") return {
					turn: turn.turn,
					step: 0
				};
			}
			return null;
		}
		function snapshotLocations(snapshot) {
			const locations = /* @__PURE__ */ new Map();
			const trajectory = snapshot.views.get("trajectory");
			if (isRecord(trajectory) && trajectory.eventLocations instanceof Map) for (const [seq, location] of trajectory.eventLocations) {
				if (typeof seq !== "number") continue;
				const coordinates = coordinatesOfLocation(location);
				if (coordinates !== null) locations.set(seq, coordinates);
			}
			for (const turnNumber of snapshot.chat.timeline.turnOrder) {
				const turn = snapshot.chat.timeline.turns.get(turnNumber);
				if (turn === void 0) continue;
				for (const step of turn.steps) for (const key of snapshot.chat.locations.getStep(turnNumber, step.step)) {
					const node = snapshot.chat.nodes.get(key);
					if (node === void 0) continue;
					const coordinates = {
						turn: turnNumber,
						step: step.step
					};
					if (!locations.has(node.anchorSeq)) locations.set(node.anchorSeq, coordinates);
					const root = recordAt(recordAt(node, "data"), "root");
					const resultSeq = root?.kind === "tool-result" ? numberAt(root, "seq") : null;
					if (resultSeq !== null && !locations.has(resultSeq)) locations.set(resultSeq, coordinates);
				}
			}
			return locations;
		}
		function trajectoryNodes(snapshot) {
			const trajectory = snapshot.views.get("trajectory");
			if (isRecord(trajectory) && Array.isArray(trajectory.eventNodes)) return trajectory.eventNodes;
			return snapshot.nodes;
		}
		function pairFromSettled(node) {
			const argsRaw = node.call?.argsRaw ?? "";
			return {
				callId: node.callId,
				seq: node.callTime === null ? node.seq : node.seq - .5,
				resultSeq: node.seq,
				time: node.callTime ?? node.time,
				resultTime: node.time,
				turn: 0,
				step: 0,
				name: node.call?.name ?? "",
				args: parseArgs(argsRaw),
				argsRaw,
				result: {
					content: node.content,
					isError: node.isError,
					error: node.error
				},
				meta: node.meta,
				callView: null,
				resultView: null,
				orphan: node.call === null
			};
		}
		function pairFromRunning(call, index) {
			return {
				callId: call.callId,
				seq: Number.MAX_SAFE_INTEGER - 1e3 + index,
				resultSeq: null,
				time: call.time,
				resultTime: null,
				turn: call.turn,
				step: call.step,
				name: call.name,
				args: parseArgs(call.argsRaw),
				argsRaw: call.argsRaw,
				result: null,
				meta: null,
				callView: null,
				resultView: null,
				orphan: false
			};
		}
		/** Public RC1 Session/Conversation projection to occurrence-preserving tool pairs. */
		function pairsFromSnapshot(snapshot) {
			const locations = snapshotLocations(snapshot);
			const pairs = [];
			for (const node of trajectoryNodes(snapshot)) {
				if (node.kind !== "tool-result") continue;
				const pair = pairFromSettled(node);
				const coordinates = locations.get(node.seq);
				pair.turn = coordinates?.turn ?? 0;
				pair.step = coordinates?.step ?? 0;
				pairs.push(pair);
			}
			snapshot.runningCalls.forEach((call, index) => pairs.push(pairFromRunning(call, index)));
			pairs.sort((left, right) => left.seq - right.seq || left.time - right.time);
			return pairs;
		}
		function snapshotItems(snapshot) {
			const locations = snapshotLocations(snapshot);
			const items = pairsFromSnapshot(snapshot).map(toolItem);
			for (const node of trajectoryNodes(snapshot)) {
				const coordinates = locations.get(node.seq) ?? {
					turn: "turn" in node ? node.turn : 0,
					step: "step" in node ? node.step : 0
				};
				if (node.kind === "user") {
					if (stringAt(node.source, "kind") !== "user") continue;
					const text = contentText(node.content);
					if (text !== "") items.push(messageItem(node, coordinates, "user", text));
				} else if (node.kind === "steering") {
					const text = contentText(node.content);
					if (text !== "") items.push(messageItem(node, coordinates, "steering", text));
				} else if (node.kind === "assistant") {
					const hasTool = node.blocks.some((block) => block.kind === "tool-call");
					const text = node.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n");
					if (!hasTool && text.trim() !== "") items.push(messageItem(node, coordinates, "assistant", text));
					items.push(...imageItems(node, coordinates));
					if (node.interrupted === true) items.push(turnStateItem(node.seq + .9, node.time, coordinates, "interrupted", "Agent 输出在完成前停止"));
				} else if (node.kind === "turn-error") items.push(turnStateItem(node.seq, node.time, coordinates, "failure", node.message));
				else if (node.kind === "turn-max-tokens") items.push(turnStateItem(node.seq, node.time, coordinates, "interrupted", "达到本轮输出上限"));
			}
			const latestTurn = snapshot.chat.timeline.turnOrder.at(-1) ?? 0;
			const latestStep = snapshot.chat.timeline.turns.get(latestTurn)?.steps.at(-1)?.step ?? 0;
			snapshot.pending.forEach((pending, index) => {
				const name = pending.kind === "approval" ? "等待批准" : "等待回答问题";
				items.push(interactionItem(pending.key, Number.MAX_SAFE_INTEGER - 100 + index, Date.now(), {
					turn: latestTurn,
					step: latestStep
				}, "waiting", name, null, pending));
			});
			return withModelPlaceholders(items, snapshot.chat.timeline.turnOrder.flatMap((turn) => snapshot.chat.timeline.turns.get(turn)?.steps.flatMap((step) => {
				const model = step.data.get("dsh-watcher-model-stage");
				return model === void 0 ? [] : [model];
			}) ?? [])).sort((left, right) => left.seq - right.seq || left.time - right.time);
		}
		function withPatterns(items) {
			const next = items.map((item) => ({ ...item }));
			const lastBySignature = /* @__PURE__ */ new Map();
			const lastByIntent = /* @__PURE__ */ new Map();
			for (let index = 0; index < next.length; index++) {
				const item = next[index];
				if (item === void 0) continue;
				if (item.signature !== null) {
					const previousIndex = lastBySignature.get(item.signature);
					const previous = previousIndex === void 0 ? void 0 : next[previousIndex];
					if (previous !== void 0 && (previous.status === "failure" || previous.status === "unknown")) {
						item.retryOf = previous.id;
						item.retryIndex = previous.retryIndex + 1;
					}
					if (item.status === "success" && previous !== void 0 && previous.status === "failure") previous.recoveredBy = item.id;
					lastBySignature.set(item.signature, index);
				}
				if (item.intentKey !== null) {
					const previousIndex = lastByIntent.get(item.intentKey);
					const previous = previousIndex === void 0 ? void 0 : next[previousIndex];
					if (previous !== void 0 && previous.signature !== item.signature) item.iterationIndex = previous.iterationIndex + 1;
					lastByIntent.set(item.intentKey, index);
				}
			}
			return next;
		}
		function phasePriority(phase) {
			return {
				wait: 100,
				steering: 95,
				request: 90,
				failure: 85,
				activate: 80,
				verify: 70,
				build: 60,
				desktop: 55,
				investigate: 50,
				plan: 40,
				answer: 30,
				model: 25,
				other: 0
			}[phase];
		}
		function statusOfItems(items) {
			if (items.some((item) => item.status === "waiting")) return "waiting";
			if (items.some((item) => item.status === "running")) return "running";
			if (items.some((item) => item.status === "interrupted")) return "interrupted";
			if (items.some((item) => item.status === "failure" && item.recoveredBy === null)) return "failure";
			if (items.some((item) => item.status === "success")) return "success";
			if (items.some((item) => item.status === "returned")) return "returned";
			return "unknown";
		}
		function phaseTitle(phase) {
			return {
				request: "理解任务",
				steering: "接收用户补充",
				plan: "规划工作",
				investigate: "检查与理解",
				build: "修改实现",
				verify: "验证结果",
				activate: "激活插件",
				desktop: "操作界面",
				answer: "完成回复",
				model: "模型响应",
				wait: "等待你决定",
				failure: "处理异常",
				other: "执行其他工作"
			}[phase];
		}
		function compactTargets(items) {
			const values = [...new Set(items.map((item) => item.target).filter((value) => value !== null))];
			if (values.length === 0) return "";
			const head = values.slice(0, 2).map(baseName).join(" · ");
			return values.length > 2 ? `${head} · +${values.length - 2}` : head;
		}
		function stepOf(items, timing, model) {
			const first = items[0];
			if (first === void 0) throw new Error("work step requires at least one item");
			const phase = items.reduce((winner, item) => phasePriority(item.phase) > phasePriority(winner) ? item.phase : winner, first.phase);
			const executionCount = items.filter((item) => item.source === "tool").length;
			const parallel = executionCount > 1;
			const retryCount = items.filter((item) => item.retryOf !== null).length;
			const iterationCount = items.filter((item) => item.iterationIndex > 0).length;
			const unconfirmedFailureCount = items.filter((item) => item.status === "failure" && item.recoveredBy === null).length;
			const targets = compactTargets(items);
			const title = items.length === 1 ? first.title : `${phaseTitle(phase)}${parallel ? ` · ${executionCount} 项并行` : ""}`;
			const detail = [targets, executionCount > 0 ? `${executionCount} 次执行` : `${items.length} 条记录`].filter(Boolean).join(" · ");
			return {
				id: `turn:${first.turn}:step:${first.step}:seq:${first.seq}`,
				turn: first.turn,
				step: first.step,
				phase,
				status: statusOfItems(items),
				title,
				subtitle: detail,
				items,
				parallel,
				executionCount,
				retryCount,
				iterationCount,
				unconfirmedFailureCount,
				firstSeq: first.seq,
				lastSeq: items.at(-1)?.seq ?? first.seq,
				...timing,
				model
			};
		}
		function stepsOf(items, timingOf, modelOf) {
			const steps = [];
			let current = [];
			let key = "";
			for (const item of items) {
				const itemKey = `${item.turn}:${item.step}`;
				if (current.length > 0 && itemKey !== key) {
					const first = current[0];
					if (first !== void 0) steps.push(stepOf(current, timingOf?.(first.turn, first.step) ?? {
						startTime: null,
						endTime: null
					}, modelOf?.(first.turn, first.step) ?? null));
					current = [];
				}
				key = itemKey;
				current.push(item);
			}
			if (current.length > 0) {
				const first = current[0];
				if (first !== void 0) steps.push(stepOf(current, timingOf?.(first.turn, first.step) ?? {
					startTime: null,
					endTime: null
				}, modelOf?.(first.turn, first.step) ?? null));
			}
			return steps;
		}
		function groupOf(steps) {
			const first = steps[0];
			if (first === void 0) throw new Error("work group requires at least one step");
			const items = steps.flatMap((step) => step.items);
			const executionCount = steps.reduce((sum, step) => sum + step.executionCount, 0);
			const parallelStepCount = steps.filter((step) => step.parallel).length;
			const retryCount = steps.reduce((sum, step) => sum + step.retryCount, 0);
			const iterationCount = steps.reduce((sum, step) => sum + step.iterationCount, 0);
			const unconfirmedFailureCount = steps.reduce((sum, step) => sum + step.unconfirmedFailureCount, 0);
			const summary = [
				`${steps.length} 个步骤`,
				executionCount > 0 ? `${executionCount} 次执行` : null,
				parallelStepCount > 0 ? `${parallelStepCount} 次并行` : null
			].filter((part) => part !== null).join(" · ");
			return {
				id: `turn:${first.turn}:phase:${first.phase}:seq:${first.firstSeq}`,
				turn: first.turn,
				phase: first.phase,
				status: statusOfItems(items),
				title: phaseTitle(first.phase),
				subtitle: summary,
				steps,
				items,
				executionCount,
				parallelStepCount,
				retryCount,
				iterationCount,
				unconfirmedFailureCount,
				firstSeq: first.firstSeq,
				lastSeq: steps.at(-1)?.lastSeq ?? first.lastSeq,
				startTime: first.startTime,
				endTime: steps.at(-1)?.endTime ?? null
			};
		}
		function groupsOf(steps) {
			const groups = [];
			let current = [];
			let phase = null;
			let turn = null;
			for (const step of steps) {
				if (current.length > 0 && (step.phase !== phase || step.turn !== turn)) {
					groups.push(groupOf(current));
					current = [];
				}
				phase = step.phase;
				turn = step.turn;
				current.push(step);
			}
			if (current.length > 0) groups.push(groupOf(current));
			return groups;
		}
		function turnTimesFromSnapshot(snapshot, turn) {
			const location = snapshot.chat.timeline.turns.get(turn);
			const timing = snapshot.turnTimings.get(turn);
			return {
				startTime: location?.start?.time ?? timing?.startTime ?? null,
				endTime: location?.end?.time ?? timing?.endTime ?? null
			};
		}
		function stepTimesFromSnapshot(snapshot, turn, step) {
			const location = snapshot.chat.timeline.turns.get(turn)?.steps.find((value) => value.step === step);
			return {
				startTime: location?.start?.time ?? null,
				endTime: location?.end?.time ?? null
			};
		}
		function stepModelFromSnapshot(snapshot, turn, step) {
			return snapshot.chat.timeline.turns.get(turn)?.steps.find((value) => value.step === step)?.data.get("dsh-watcher-model-stage") ?? null;
		}
		function pictureOf(sourceItems, options) {
			if (sourceItems.length === 0) return {
				...EMPTY_PICTURE,
				running: options.running,
				partialHistory: options.partialHistory,
				pendingCount: options.pendingCount
			};
			const occupiedSteps = new Set(sourceItems.filter((item) => item.source !== "model").map((item) => `${item.turn}:${item.step}`));
			const items = withPatterns([...sourceItems.filter((item) => item.source !== "model" || !occupiedSteps.has(`${item.turn}:${item.step}`))].sort((left, right) => left.turn - right.turn || left.step - right.step || left.seq - right.seq || left.time - right.time));
			const steps = stepsOf(items, options.stepTimes, options.modelOf);
			const groups = groupsOf(steps);
			const turns = [];
			for (const turnNumber of [...new Set(groups.map((group) => group.turn))]) {
				const turnGroups = groups.filter((group) => group.turn === turnNumber);
				const timing = options.turnTimes?.(turnNumber) ?? {
					startTime: null,
					endTime: null
				};
				turns.push({
					turn: turnNumber,
					status: statusOfItems(turnGroups.flatMap((group) => group.items)),
					groups: turnGroups,
					...timing
				});
			}
			const latest = items.at(-1);
			return {
				nodes: groups,
				turns,
				now: latest === void 0 ? EMPTY_NOW : {
					phase: latest.phase,
					label: latest.status === "running" ? latest.title : options.running ? "等待 Agent 继续" : latest.title,
					status: latest.status === "running" ? "running" : options.running ? "running" : latest.status
				},
				actionCount: items.filter((item) => item.source === "tool").length,
				stepCount: steps.length,
				turnCount: turns.length,
				parallelStepCount: steps.filter((step) => step.parallel).length,
				retryCount: items.filter((item) => item.retryOf !== null).length,
				iterationCount: items.filter((item) => item.iterationIndex > 0).length,
				pendingCount: options.pendingCount,
				unconfirmedFailureCount: items.filter((item) => item.status === "failure" && item.recoveredBy === null).length,
				running: options.running,
				partialHistory: options.partialHistory
			};
		}
		/** Fold the official RC8 snapshot without flattening Turn/Step identity. */
		function foldSnapshot(snapshot, options = {}) {
			if (snapshot.blank) return {
				...EMPTY_PICTURE,
				running: options.running === true || snapshot.running,
				partialHistory: snapshot.hasMore
			};
			return pictureOf(snapshotItems(snapshot), {
				running: options.running === true || snapshot.running,
				partialHistory: snapshot.hasMore,
				pendingCount: snapshot.pending.length,
				turnTimes: (turn) => turnTimesFromSnapshot(snapshot, turn),
				stepTimes: (turn, step) => stepTimesFromSnapshot(snapshot, turn, step),
				modelOf: (turn, step) => stepModelFromSnapshot(snapshot, turn, step)
			});
		}
		function itemsOfPicture(picture) {
			return picture.nodes.flatMap((group) => group.items);
		}
		function turnTimesOfPicture(picture) {
			return new Map(picture.turns.map((turn) => [turn.turn, {
				startTime: turn.startTime,
				endTime: turn.endTime
			}]));
		}
		function stepTimesOfPicture(picture) {
			return new Map(picture.nodes.flatMap((group) => group.steps.map((step) => [`${step.turn}:${step.step}`, {
				startTime: step.startTime,
				endTime: step.endTime
			}])));
		}
		function stepModelsOfPicture(picture) {
			return new Map(picture.nodes.flatMap((group) => group.steps.flatMap((step) => step.model === null ? [] : [[`${step.turn}:${step.step}`, step.model]])));
		}
		/**
		* Retain every occurrence already observed in this mounted page while the
		* official RC8 window advances. Latest evidence wins by stable occurrence id,
		* so running → result updates one row instead of duplicating or removing it.
		*/
		function mergeObservedPictures(previous, current) {
			if (previous.nodes.length === 0) return current;
			if (current.nodes.length === 0) return {
				...previous,
				running: current.running,
				partialHistory: current.partialHistory,
				pendingCount: current.pendingCount
			};
			const items = /* @__PURE__ */ new Map();
			for (const item of itemsOfPicture(previous)) items.set(item.id, item);
			for (const item of itemsOfPicture(current)) items.set(item.id, item);
			const turns = turnTimesOfPicture(previous);
			for (const [turn, timing] of turnTimesOfPicture(current)) {
				const prior = turns.get(turn);
				turns.set(turn, {
					startTime: timing.startTime ?? prior?.startTime ?? null,
					endTime: timing.endTime ?? prior?.endTime ?? null
				});
			}
			const steps = stepTimesOfPicture(previous);
			for (const [key, timing] of stepTimesOfPicture(current)) {
				const prior = steps.get(key);
				steps.set(key, {
					startTime: timing.startTime ?? prior?.startTime ?? null,
					endTime: timing.endTime ?? prior?.endTime ?? null
				});
			}
			const models = stepModelsOfPicture(previous);
			for (const [key, model] of stepModelsOfPicture(current)) models.set(key, model);
			return pictureOf([...items.values()], {
				running: current.running,
				partialHistory: current.partialHistory,
				pendingCount: current.pendingCount,
				turnTimes: (turn) => turns.get(turn) ?? {
					startTime: null,
					endTime: null
				},
				stepTimes: (turn, step) => steps.get(`${turn}:${step}`) ?? {
					startTime: null,
					endTime: null
				},
				modelOf: (turn, step) => models.get(`${turn}:${step}`) ?? null
			});
		}
		//#endregion
		//#region \0dsh-css:src/client/Watcher.module.css.mjs
		const css$2 = ".PRpy3W_root{--watcher-panel-max-height:min(680px, calc(100vh - 112px));--watcher-motion-fast:.14s;--watcher-motion-panel:.18s;--watcher-ease-out:cubic-bezier(.2, .8, .2, 1);position:relative}.PRpy3W_trigger{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color var(--watcher-motion-fast) ease, border-color var(--watcher-motion-fast) ease, color var(--watcher-motion-fast) ease, transform .1s ease;background:0 0;border-radius:999px;justify-content:center;align-items:center;padding:0;display:inline-flex}.PRpy3W_trigger:hover:not(:disabled),.PRpy3W_trigger:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_trigger:active{transform:scale(.96)}.PRpy3W_trigger:focus-visible{outline:2px solid var(--dsw-static-deepseek-450);outline-offset:2px}.PRpy3W_trigger[data-open]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-static-deepseek-450)}.PRpy3W_trigger[data-live]{color:var(--dsw-static-deepseek-450)}.PRpy3W_trigger[data-alert]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_eye,.PRpy3W_eyeBlink,.PRpy3W_eyePupil{transform-box:fill-box;transform-origin:50%;display:block}.PRpy3W_trigger[data-live] .PRpy3W_eyePupil{animation:PRpy3W_watcher-eye-scan 2.8s var(--watcher-ease-out) infinite}.PRpy3W_trigger[data-live] .PRpy3W_eyeBlink{animation:5.2s ease-in-out infinite PRpy3W_watcher-eye-blink}@keyframes PRpy3W_watcher-eye-scan{0%,12%,92%,to{transform:translate(0)}30%{transform:translate(1.35px)}54%{transform:translate(-1.2px)}74%{transform:translate(.8px)}}@keyframes PRpy3W_watcher-eye-blink{0%,42%,44.5%,to{transform:scaleY(1)}43.2%{transform:scaleY(.12)}}.PRpy3W_menu{z-index:1100;--watcher-panel-limit-w:calc(100vw - 24px);--watcher-panel-limit-h:calc(100vh - 24px);--watcher-panel-max-height:min(680px, var(--watcher-panel-limit-h));--watcher-motion-fast:.14s;--watcher-motion-panel:.18s;--watcher-ease-out:cubic-bezier(.2, .8, .2, 1);box-sizing:border-box;max-width:var(--watcher-panel-limit-w);max-height:var(--watcher-panel-max-height);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);transform-origin:100% 0;animation:PRpy3W_watcher-panel-enter var(--watcher-motion-panel) var(--watcher-ease-out);isolation:isolate;border-radius:12px;align-items:stretch;font-size:13px;line-height:20px;display:flex;position:fixed;top:auto;left:auto;right:auto;overflow:hidden}@keyframes PRpy3W_watcher-panel-enter{0%{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}.PRpy3W_workPicture{width:min(720px, var(--watcher-panel-limit-w));min-width:0;min-height:290px;max-height:var(--watcher-panel-max-height);background:var(--dsw-specific-menu);flex-direction:column;flex:0 auto;display:flex}.PRpy3W_pictureHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 14px 14px 16px;display:flex}.PRpy3W_nowBlock{min-width:0}.PRpy3W_eyebrow{color:var(--dsw-static-deepseek-450);text-overflow:ellipsis;white-space:nowrap;align-items:center;gap:5px;font-size:12px;font-weight:500;line-height:18px;display:flex;overflow:hidden}.PRpy3W_eyebrow[data-alert]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_now{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:17px;font-weight:600;line-height:24px;overflow:hidden}.PRpy3W_summary{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12px;line-height:18px;display:flex}.PRpy3W_summary span+span:before{content:\"·\";color:var(--dsw-alias-label-dimmed);margin:0 6px}.PRpy3W_summary [data-partial]{color:var(--dsw-alias-state-warn-primary)}.PRpy3W_loadAllInlineBtn{background:var(--dsw-specific-menu);color:var(--dsw-static-deepseek-450);cursor:pointer;border:1px solid #4d6bfe66;border-radius:4px;align-items:center;margin-left:6px;padding:1px 7px;font-size:11px;font-weight:500;line-height:16px;transition:all .12s;display:inline-flex}.PRpy3W_loadAllInlineBtn:hover{background:var(--dsw-static-deepseek-450);color:#fff}.PRpy3W_sessionTiming{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;padding:9px 10px;display:grid}.PRpy3W_sessionTimingMetric{min-width:0;padding:0 8px}.PRpy3W_sessionTimingMetric+.PRpy3W_sessionTimingMetric{border-left:1px solid var(--dsw-alias-border-l2)}.PRpy3W_sessionTimingMetric dt,.PRpy3W_sessionTimingMetric dd{text-overflow:ellipsis;white-space:nowrap;margin:0;overflow:hidden}.PRpy3W_sessionTimingMetric dt{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.PRpy3W_sessionTimingMetric dd{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;line-height:19px}.PRpy3W_viewToolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);flex-wrap:wrap;flex:none;justify-content:space-between;align-items:center;gap:6px 14px;min-height:42px;padding:6px 14px;display:flex}.PRpy3W_viewControl{align-items:center;gap:6px;min-width:0;display:flex}.PRpy3W_viewToolbarLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;line-height:18px}.PRpy3W_viewMode{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:7px;flex:none;grid-template-columns:repeat(2,minmax(42px,1fr));padding:2px;display:inline-grid}.PRpy3W_viewMode button{min-height:26px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:5px;padding:2px 9px;font-size:12px;line-height:18px}.PRpy3W_viewMode button:hover{color:var(--dsw-alias-label-primary)}.PRpy3W_viewMode button[data-active]{background:var(--dsw-specific-menu);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}.PRpy3W_historyNotice{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;align-items:center;gap:10px;min-height:48px;padding:7px 14px 8px 16px;display:flex}.PRpy3W_historyNoticeCopy{flex-direction:column;flex:1;min-width:0;display:flex}.PRpy3W_historyNoticeCopy strong{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;line-height:18px;overflow:hidden}.PRpy3W_historyNoticeCopy span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;overflow:hidden}.PRpy3W_historyNotice button{border:1px solid var(--dsw-alias-button-ghost-active-border);background:var(--dsw-specific-menu);min-height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;flex:none;padding:3px 9px;font-size:12px;line-height:18px}.PRpy3W_historyNotice button:hover:not(:disabled){background:var(--dsw-alias-button-ghost-active-hover)}.PRpy3W_historyNotice button:disabled{color:var(--dsw-alias-label-tertiary);cursor:progress}.PRpy3W_follow{white-space:nowrap;flex:none;margin-top:2px}.PRpy3W_unread{border:1px solid var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);width:calc(100% - 28px);min-height:34px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:8px;justify-content:center;align-items:center;gap:6px;margin:10px 14px 0;font-size:12px;display:inline-flex}.PRpy3W_unread:hover{background:var(--dsw-alias-button-ghost-active-hover)}.PRpy3W_unread:focus-visible,.PRpy3W_turnToggle:focus-visible,.PRpy3W_phaseToggle:focus-visible,.PRpy3W_stepToggle:focus-visible,.PRpy3W_analysisClusterToggle:focus-visible,.PRpy3W_modelStageToggle:focus-visible,.PRpy3W_reasoningToggle:focus-visible,.PRpy3W_groupedModelToggle:focus-visible,.PRpy3W_viewMode button:focus-visible,.PRpy3W_historyNotice button:focus-visible,.PRpy3W_overviewOccurrence:focus-visible,.PRpy3W_inspectorBack:focus-visible,.PRpy3W_occurrence:focus-visible,.PRpy3W_tab:focus-visible,.PRpy3W_copyRaw:focus-visible{outline:2px solid var(--dsw-static-deepseek-450);outline-offset:-2px}.PRpy3W_railViewport{overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}.PRpy3W_turns{padding:8px 10px 18px}.PRpy3W_turn+.PRpy3W_turn{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}.PRpy3W_turnHeader{padding:0 2px 2px}.PRpy3W_turnHeader h2{margin:0}.PRpy3W_turnToggle{box-sizing:border-box;width:100%;min-height:50px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px 8px;display:grid}.PRpy3W_turnToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_turnChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out);transform:rotate(0)}.PRpy3W_turnToggle[aria-expanded=true] .PRpy3W_turnChevron{transform:rotate(90deg)}.PRpy3W_turnCopy{flex-direction:column;min-width:0;display:flex}.PRpy3W_turnTitleLine{align-items:center;gap:6px;min-width:0;display:flex}.PRpy3W_turnTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px}.PRpy3W_turnSummary,.PRpy3W_turnDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;font-weight:400;line-height:18px}.PRpy3W_turnSummary{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.PRpy3W_turnPerformance{white-space:nowrap;flex-direction:column;align-items:flex-end;min-width:62px;display:flex}.PRpy3W_turnDuration{white-space:nowrap}.PRpy3W_turnSpeed{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;font-weight:500;line-height:18px}.PRpy3W_turnMetrics{background:var(--dsw-alias-bg-layer-2);border-radius:7px;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:2px 8px 9px 36px;padding:7px 9px;display:grid}.PRpy3W_turnMetric{min-width:0}.PRpy3W_turnMetric dt,.PRpy3W_turnMetric dd{text-overflow:ellipsis;white-space:nowrap;margin:0;overflow:hidden}.PRpy3W_turnMetric dt{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}.PRpy3W_turnMetric dd{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;line-height:19px}.PRpy3W_turnBody[hidden]{display:none}.PRpy3W_groupRail{padding-left:18px;position:relative}.PRpy3W_railLine{background:var(--dsw-alias-border-l2);pointer-events:none;width:1px;position:absolute;top:18px;bottom:18px;left:23px}.PRpy3W_phase{z-index:1;box-sizing:border-box;width:100%;padding:3px 0 11px;position:relative}.PRpy3W_phase+.PRpy3W_phase{margin-top:4px}.PRpy3W_phaseHeader{position:relative}.PRpy3W_phaseToggle{box-sizing:border-box;width:100%;min-height:42px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:7px;grid-template-columns:10px 12px minmax(0,1fr);align-items:center;gap:6px;padding:3px 8px 3px 0;display:grid;position:relative}.PRpy3W_phaseToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_phase[data-now]>.PRpy3W_phaseHeader .PRpy3W_phaseToggle{background:var(--dsw-alias-bg-layer-2);border-radius:7px}.PRpy3W_phaseChevron,.PRpy3W_stepChevron,.PRpy3W_analysisClusterChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out);transform:rotate(0)}.PRpy3W_phaseToggle[aria-expanded=true] .PRpy3W_phaseChevron,.PRpy3W_stepToggle[aria-expanded=true] .PRpy3W_stepChevron,.PRpy3W_analysisClusterToggle[aria-expanded=true] .PRpy3W_analysisClusterChevron{transform:rotate(90deg)}.PRpy3W_phaseMarker{box-sizing:border-box;background:var(--dsw-alias-label-tertiary);width:10px;height:10px;box-shadow:0 0 0 4px var(--dsw-specific-menu);border-radius:50%;display:block;position:relative}.PRpy3W_phaseMarker[data-state=active],.PRpy3W_phaseMarker[data-state=current]{background:var(--dsw-static-deepseek-450)}.PRpy3W_phaseMarker[data-state=waiting]{background:var(--dsw-alias-state-warn-primary)}.PRpy3W_phaseMarker[data-state=failure],.PRpy3W_phaseMarker[data-state=interrupted]{background:var(--dsw-alias-state-error-primary)}.PRpy3W_phaseMarker[data-state=partial]{border:1px dashed var(--dsw-alias-label-tertiary);background:var(--dsw-specific-menu)}.PRpy3W_neutralDot{border:1px solid var(--dsw-alias-label-tertiary);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:10px;height:10px;display:inline-block;position:relative}.PRpy3W_neutralDot[data-status=unknown]{background:var(--dsw-specific-menu);border-style:dashed}.PRpy3W_phaseCopy,.PRpy3W_occurrenceCopy{flex-direction:column;min-width:0;display:flex}.PRpy3W_phaseTitleLine{align-items:center;gap:6px;min-width:0;display:flex}.PRpy3W_phaseTitle{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:550;line-height:21px;overflow:hidden}.PRpy3W_phaseMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_groupBadges{flex:none;align-items:center;gap:4px;display:inline-flex}.PRpy3W_groupBadges span,.PRpy3W_overviewTag,.PRpy3W_patternLabel,.PRpy3W_parallelLabel{border:1px solid var(--dsw-alias-border-l2);min-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;border-radius:999px;align-items:center;padding:0 5px;font-size:11px;font-weight:500;line-height:16px;display:inline-flex}.PRpy3W_groupBadges [data-kind=retry]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_groupBadges [data-kind=parallel],.PRpy3W_overviewTag[data-state=active],.PRpy3W_overviewTag[data-state=current]{color:var(--dsw-static-deepseek-450)}.PRpy3W_overviewTag[data-state=waiting]{color:var(--dsw-alias-state-warn-primary)}.PRpy3W_overviewTag[data-state=failure],.PRpy3W_overviewTag[data-state=interrupted]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_overviewTag[data-state=partial]{color:var(--dsw-alias-label-tertiary)}.PRpy3W_occurrenceChevron{color:var(--dsw-alias-label-dimmed);opacity:0;transition:opacity var(--watcher-motion-fast) ease, transform var(--watcher-motion-fast) ease;flex:none;transform:translate(-2px)}.PRpy3W_occurrence:hover .PRpy3W_occurrenceChevron,.PRpy3W_occurrence[data-selected] .PRpy3W_occurrenceChevron,.PRpy3W_occurrence:focus-visible .PRpy3W_occurrenceChevron{opacity:1;transform:translate(0)}.PRpy3W_stepTimeline{border-left:1px solid var(--dsw-alias-border-l2);margin:1px 8px 0 28px;padding-left:11px;position:relative}.PRpy3W_overviewStep{min-width:0;position:relative}.PRpy3W_overviewStep+.PRpy3W_overviewStep{margin-top:10px;padding-top:8px}.PRpy3W_overviewStep:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:13px;left:-12px}.PRpy3W_overviewStepHeader{min-height:29px}.PRpy3W_stepToggle{box-sizing:border-box;width:100%;min-height:29px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:5px;padding:2px 4px 2px 0;display:grid}.PRpy3W_stepToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_overviewStepLabel,.PRpy3W_overviewStepSignals{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}.PRpy3W_overviewStepLabel{min-width:0;font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.PRpy3W_overviewStepSignals{white-space:nowrap;align-items:center;gap:6px;display:inline-flex}.PRpy3W_overviewOccurrences{position:relative}.PRpy3W_overviewStep[data-parallel] .PRpy3W_overviewOccurrences{border-left:1px solid var(--dsw-static-deepseek-450);padding-left:5px}.PRpy3W_modelStage{border-left:2px solid var(--dsw-static-deepseek-450);background:var(--dsw-alias-bg-layer-2);border-radius:0 7px 7px 0;min-width:0;margin:2px 2px 7px;overflow:hidden}.PRpy3W_modelStage[data-live]{box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}.PRpy3W_modelStageToggle{box-sizing:border-box;width:100%;min-height:42px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px 8px minmax(0,1fr);align-items:center;gap:7px;padding:5px 9px 5px 7px;display:grid}.PRpy3W_modelStageToggle:hover,.PRpy3W_reasoningToggle:hover,.PRpy3W_groupedModelToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_modelStageChevron,.PRpy3W_reasoningChevron,.PRpy3W_groupedModelChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out)}.PRpy3W_modelStageToggle[aria-expanded=true] .PRpy3W_modelStageChevron,.PRpy3W_reasoningToggle[aria-expanded=true] .PRpy3W_reasoningChevron,.PRpy3W_groupedModelToggle[aria-expanded=true] .PRpy3W_groupedModelChevron{transform:rotate(90deg)}.PRpy3W_modelStageGlyph{background:var(--dsw-static-deepseek-450);width:7px;height:7px;box-shadow:0 0 0 3px var(--dsw-alias-button-ghost-active-fill);border-radius:999px}.PRpy3W_modelStageCopy{grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:8px;min-width:0;display:grid}.PRpy3W_modelStageTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;font-size:13px;font-weight:600;line-height:20px}.PRpy3W_modelStageSummary{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_modelStageBody{padding:2px 10px 10px 20px}.PRpy3W_modelStageBar{background:var(--dsw-alias-border-l2);border-radius:999px;gap:2px;height:5px;margin:2px 0 10px;display:flex;overflow:hidden}.PRpy3W_modelStageBar>span{border-radius:inherit;min-width:3px}.PRpy3W_modelStageBar [data-segment=wait],.PRpy3W_modelStageSwatch[data-segment=wait]{background:var(--dsw-alias-label-dimmed)}.PRpy3W_modelStageBar [data-segment=reasoning],.PRpy3W_modelStageSwatch[data-segment=reasoning]{background:var(--dsw-static-deepseek-450)}.PRpy3W_modelStageBar [data-segment=output],.PRpy3W_modelStageSwatch[data-segment=output]{background:var(--dsw-alias-label-secondary)}.PRpy3W_modelStageBar [data-segment=unattributed],.PRpy3W_modelStageSwatch[data-segment=unattributed]{background:var(--dsw-alias-state-warn-primary)}.PRpy3W_modelStageLedger{grid-template-columns:minmax(0,1fr);gap:5px 12px;margin:0;display:grid}.PRpy3W_modelStageMetric{min-width:0;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;justify-content:space-between;align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}.PRpy3W_modelStageMetric dt,.PRpy3W_modelStageMetric dd{margin:0}.PRpy3W_modelStageMetric dt{align-items:center;gap:6px;min-width:0;display:inline-flex}.PRpy3W_modelStageMetric dd{color:var(--dsw-alias-label-secondary);text-align:right;flex:none}.PRpy3W_modelStageSwatch{border-radius:999px;flex:none;width:6px;height:6px}.PRpy3W_modelStageNote{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:18px}.PRpy3W_reasoningAttempts{border-top:1px solid var(--dsw-alias-border-l2);margin-top:8px;padding-top:1px}.PRpy3W_reasoningDisclosure{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:6px;min-width:0;margin-top:5px;overflow:hidden}.PRpy3W_reasoningToggle{box-sizing:border-box;width:100%;min-height:34px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px minmax(0,1fr);align-items:center;gap:6px;padding:5px 8px;display:grid}.PRpy3W_reasoningLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:550;line-height:20px}.PRpy3W_reasoningMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:left;white-space:normal;grid-column:2;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_reasoningBody{box-sizing:border-box;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);max-height:320px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);margin:0;padding:10px 12px;font-size:13px;line-height:1.6;overflow:auto}.PRpy3W_reasoningBody>*{margin-top:0;margin-bottom:8px}.PRpy3W_reasoningBody>:last-child{margin-bottom:0}.PRpy3W_reasoningBody .md-code-block{max-width:100%}.PRpy3W_groupedModelStages{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:7px;margin-bottom:9px;position:relative;overflow:hidden}.PRpy3W_groupedModelStages:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:20px;left:-12px}.PRpy3W_groupedModelToggle{box-sizing:border-box;width:100%;min-height:44px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px minmax(0,1fr);align-items:center;gap:7px;padding:5px 9px;display:grid}.PRpy3W_groupedModelToggle>span{justify-content:space-between;align-items:baseline;gap:10px;min-width:0;display:flex}.PRpy3W_groupedModelToggle strong{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.PRpy3W_groupedModelToggle small{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_groupedModelList{border-top:1px solid var(--dsw-alias-border-l2);padding:0 7px 8px 22px}.PRpy3W_groupedModelStep{min-width:0;padding-top:8px}.PRpy3W_groupedModelStep+.PRpy3W_groupedModelStep{border-top:1px solid var(--dsw-alias-border-l2)}.PRpy3W_groupedModelStepLabel{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);margin:0 2px 4px;font-size:12px;line-height:18px;display:block}.PRpy3W_analysisClusters{border-left:1px solid var(--dsw-alias-border-l2);margin:1px 8px 0 28px;padding-left:11px;position:relative}.PRpy3W_analysisCluster,.PRpy3W_analysisSingleton{min-width:0;position:relative}.PRpy3W_analysisCluster+.PRpy3W_analysisCluster,.PRpy3W_analysisCluster+.PRpy3W_analysisSingleton,.PRpy3W_analysisSingleton+.PRpy3W_analysisCluster,.PRpy3W_analysisSingleton+.PRpy3W_analysisSingleton{margin-top:6px}.PRpy3W_analysisCluster:before,.PRpy3W_analysisSingleton:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:20px;left:-12px}.PRpy3W_analysisClusterToggle{box-sizing:border-box;width:100%;min-height:46px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:7px;grid-template-columns:12px 10px minmax(0,1fr) auto;align-items:center;gap:7px;padding:5px 6px 5px 4px;display:grid}.PRpy3W_analysisClusterToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_analysisCluster[data-open]>.PRpy3W_analysisClusterToggle{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.PRpy3W_analysisClusterDotSlot{width:10px;height:10px;display:block;position:relative}.PRpy3W_analysisClusterDot{inset:0;position:absolute!important}.PRpy3W_analysisClusterCopy{flex-direction:column;min-width:0;display:flex}.PRpy3W_analysisClusterTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550;line-height:20px;overflow:hidden}.PRpy3W_analysisClusterMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_analysisClusterCount{min-width:28px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-size:12px;font-weight:600;line-height:18px}.PRpy3W_analysisClusterItems{border-left:1px solid var(--dsw-alias-border-l2);margin:3px 0 8px 17px;padding-left:5px}.PRpy3W_overviewOccurrence{box-sizing:border-box;width:100%;min-height:45px;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color var(--watcher-motion-fast) var(--watcher-ease-out), border-color var(--watcher-motion-fast) var(--watcher-ease-out), box-shadow var(--watcher-motion-fast) var(--watcher-ease-out);animation:PRpy3W_watcher-live-append var(--watcher-motion-fast) var(--watcher-ease-out);background:0 0;border:1px solid #0000;border-radius:7px;grid-template-columns:22px 10px minmax(0,1fr) auto 12px;align-items:center;gap:7px;padding:5px 5px 5px 7px;display:grid;position:relative}.PRpy3W_overviewOccurrence+.PRpy3W_overviewOccurrence{margin-top:2px}.PRpy3W_overviewOccurrence:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_overviewOccurrence[data-current]:not([data-selected]){background:var(--dsw-alias-bg-layer-2)}.PRpy3W_overviewOccurrence[data-selected]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 2px 0 0 var(--dsw-static-deepseek-450)}.PRpy3W_overviewOccurrenceIndex{color:var(--dsw-alias-label-dimmed);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums;text-align:right;font-size:11px;line-height:18px}.PRpy3W_overviewOccurrenceDotSlot{width:10px;height:10px;display:block;position:relative}.PRpy3W_overviewOccurrenceDot{inset:0;position:absolute!important}.PRpy3W_overviewOccurrenceCopy{flex-direction:column;min-width:0;display:flex}.PRpy3W_overviewOccurrenceTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550;line-height:20px;overflow:hidden}.PRpy3W_overviewOccurrenceMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_overviewOccurrenceDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;line-height:18px}.PRpy3W_overviewOccurrenceChevron{color:var(--dsw-alias-label-dimmed);opacity:0;transition:opacity var(--watcher-motion-fast) ease, transform var(--watcher-motion-fast) ease;transform:translate(-2px)}.PRpy3W_overviewOccurrence:hover .PRpy3W_overviewOccurrenceChevron,.PRpy3W_overviewOccurrence[data-selected] .PRpy3W_overviewOccurrenceChevron,.PRpy3W_overviewOccurrence:focus-visible .PRpy3W_overviewOccurrenceChevron{opacity:1;transform:translate(0)}@keyframes PRpy3W_watcher-live-append{0%{opacity:.5;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}.PRpy3W_empty{min-height:250px;color:var(--dsw-alias-label-tertiary);text-align:center;flex-direction:column;flex:1;justify-content:center;align-items:center;padding:28px;display:flex}.PRpy3W_emptyEye{color:var(--dsw-alias-label-secondary);margin-bottom:12px;display:inline-flex}.PRpy3W_empty strong{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;line-height:21px}.PRpy3W_empty>span:last-child{margin-top:4px;font-size:12px;line-height:18px}.PRpy3W_inspector{width:min(438px, var(--watcher-panel-limit-w));min-width:0;max-height:var(--watcher-panel-max-height);border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-direction:column;flex:0 auto;display:flex}.PRpy3W_inspectorHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;padding:16px 16px 14px}.PRpy3W_inspectorBack{min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;margin:-4px 0 8px -6px;padding:0 7px 0 5px;font-size:12px;display:none}.PRpy3W_inspectorBack:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_inspectorBack svg{transform:rotate(180deg)}.PRpy3W_statusLine,.PRpy3W_detailStatus{color:var(--dsw-alias-label-secondary);align-items:center;gap:7px;font-size:12px;line-height:18px;display:flex}.PRpy3W_statusLine[data-status=failure],.PRpy3W_statusLine[data-status=interrupted],.PRpy3W_detailStatus[data-status=failure],.PRpy3W_detailStatus[data-status=interrupted]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_statusLine[data-status=running],.PRpy3W_detailStatus[data-status=running]{color:var(--dsw-static-deepseek-450)}.PRpy3W_statusLine[data-status=waiting],.PRpy3W_detailStatus[data-status=waiting]{color:var(--dsw-alias-state-warn-primary)}.PRpy3W_location{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:auto}.PRpy3W_inspectorTitle{color:var(--dsw-alias-label-primary);margin:8px 0 0;font-size:18px;font-weight:600;line-height:25px}.PRpy3W_inspectorSummary{color:var(--dsw-alias-label-tertiary);margin:3px 0 0;font-size:12px;line-height:18px}.PRpy3W_groupSignals{flex-wrap:wrap;gap:6px;margin-top:10px;display:flex}.PRpy3W_groupSignals span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}.PRpy3W_groupSignals span+span:before{content:\"·\";color:var(--dsw-alias-label-dimmed);margin-right:6px}.PRpy3W_groupSignals [data-retry]{color:var(--dsw-alias-state-warn-primary)}.PRpy3W_groupSignals [data-error]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_inspectorBody{overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}.PRpy3W_executionSection{border-bottom:1px solid var(--dsw-alias-border-l2);padding:14px 16px 16px}.PRpy3W_sectionHeading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;display:flex}.PRpy3W_sectionHeading h3{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;font-weight:600;line-height:20px}.PRpy3W_sectionHeading>span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}.PRpy3W_executionList{max-height:188px;padding-right:2px;overflow:auto}.PRpy3W_stepBlock+.PRpy3W_stepBlock{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:10px}.PRpy3W_stepHeading{min-height:22px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums;justify-content:space-between;align-items:center;gap:8px;padding:0 3px;font-size:12px;display:flex}.PRpy3W_stepSignals{align-items:center;gap:6px;min-width:0;display:inline-flex}.PRpy3W_stepDuration{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-variant-numeric:tabular-nums;white-space:nowrap}.PRpy3W_parallelLabel{color:var(--dsw-static-deepseek-450);font-family:var(--dsw-font-family)}.PRpy3W_occurrences{margin-top:4px;position:relative}.PRpy3W_stepBlock[data-parallel] .PRpy3W_occurrences{border-left:1px solid var(--dsw-static-deepseek-450);padding-left:10px}.PRpy3W_occurrence{box-sizing:border-box;width:100%;min-height:46px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:8px;grid-template-columns:10px minmax(0,1fr) auto 13px;align-items:center;gap:8px;padding:6px 7px;transition:background-color .14s,border-color .14s;display:grid}.PRpy3W_occurrenceDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;line-height:18px}.PRpy3W_occurrence+.PRpy3W_occurrence{margin-top:2px}.PRpy3W_occurrence:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_occurrence[data-selected]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill)}.PRpy3W_occurrenceTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:550;line-height:19px;overflow:hidden}.PRpy3W_occurrenceMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.PRpy3W_detailSection{padding:16px}.PRpy3W_detailHeader{grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px;display:grid}.PRpy3W_detailIdentity{min-width:0}.PRpy3W_detailIdentity h3{overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);margin:6px 0 0;font-size:16px;font-weight:600;line-height:23px}.PRpy3W_detailIdentity p{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);margin:3px 0 0;font-size:12px;line-height:18px}.PRpy3W_patternLabel{color:var(--dsw-alias-state-warn-primary)}.PRpy3W_metrics{font-variant-numeric:tabular-nums;grid-template-columns:auto auto;gap:2px 8px;margin:0;font-size:12px;line-height:18px;display:grid}.PRpy3W_metrics dt{color:var(--dsw-alias-label-tertiary)}.PRpy3W_metrics dd{color:var(--dsw-alias-label-secondary);text-align:right;margin:0}.PRpy3W_metrics [data-error]{color:var(--dsw-alias-state-error-primary)}.PRpy3W_tabs{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:end;gap:4px;margin-top:16px;display:flex}.PRpy3W_tab{min-width:56px;min-height:36px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:0 10px;font-size:13px;position:relative}.PRpy3W_tab:hover{color:var(--dsw-alias-label-primary)}.PRpy3W_tab[data-active]{color:var(--dsw-alias-label-primary);font-weight:600}.PRpy3W_tab[data-active]:after{content:\"\";background:var(--dsw-static-deepseek-450);border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:9px;right:9px}.PRpy3W_tabPanel{--dsl-terminal-font:400 13px/22px var(--dsw-font-mono);min-height:116px;padding-top:12px}.PRpy3W_tabPanel>*{margin-top:0;margin-bottom:0}.PRpy3W_jsonSurface{font-size:13px;overflow:auto}.PRpy3W_jsonSurface [role=tree]{font-size:13px;line-height:20px}.PRpy3W_rawPanel pre{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);tab-size:2;margin:0;font-size:13px;line-height:20px;overflow:auto}.PRpy3W_documentResult{min-width:0;color:var(--dsw-alias-label-primary);padding:2px 2px 8px}.PRpy3W_documentResult .md-code-block{max-width:100%}.PRpy3W_documentResult blockquote{color:var(--dsw-alias-label-secondary)}.PRpy3W_documentResult table{font-variant-numeric:tabular-nums}.PRpy3W_rawPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);border-radius:8px;overflow:hidden}.PRpy3W_rawToolbar{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:38px;color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:12px;padding:0 10px 0 12px;font-size:12px;display:flex}.PRpy3W_copyRaw{min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;padding:0 6px;font-size:12px;display:inline-flex}.PRpy3W_copyRaw:hover{background:var(--dsw-alias-interactive-bg-hover)}.PRpy3W_rawPanel pre{white-space:pre;max-height:320px;padding:12px}.PRpy3W_artifactResult,.PRpy3W_detailEmpty{border:1px solid var(--dsw-alias-border-l2);min-height:116px;color:var(--dsw-alias-label-tertiary);text-align:center;border-radius:8px;flex-direction:column;justify-content:center;align-items:center;padding:18px;font-size:13px;display:flex}.PRpy3W_artifactResult strong{color:var(--dsw-alias-label-secondary);margin-top:6px;font-size:14px}.PRpy3W_artifactResult>span{margin-top:2px;font-size:12px}.PRpy3W_artifactResult .PRpy3W_jsonSurface{text-align:left;width:100%;margin-top:12px}.PRpy3W_artifactGlyph{color:var(--dsw-static-deepseek-450);font-size:24px;line-height:28px}.PRpy3W_inspectorFooter{border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);flex:none;padding:9px 16px;font-size:12px;line-height:18px}@media (prefers-reduced-motion:reduce){.PRpy3W_menu,.PRpy3W_trigger[data-live] .PRpy3W_eyePupil,.PRpy3W_trigger[data-live] .PRpy3W_eyeBlink{animation:none}.PRpy3W_trigger,.PRpy3W_overviewOccurrence,.PRpy3W_turnChevron,.PRpy3W_phaseChevron,.PRpy3W_stepChevron,.PRpy3W_analysisClusterChevron,.PRpy3W_modelStageChevron,.PRpy3W_reasoningChevron,.PRpy3W_groupedModelChevron,.PRpy3W_occurrence,.PRpy3W_overviewOccurrenceChevron,.PRpy3W_occurrenceChevron{transition-duration:.01ms}.PRpy3W_overviewOccurrence{animation:none}.PRpy3W_root [data-state=ongoing] rect,.PRpy3W_menu [data-state=ongoing] rect{opacity:.55;animation:none!important}}@media (width<=860px){.PRpy3W_menu{--watcher-panel-max-height:min(680px, calc(var(--watcher-panel-limit-h) - 64px));width:min(720px, var(--watcher-panel-limit-w));max-height:var(--watcher-panel-max-height);flex-direction:column-reverse}.PRpy3W_workPicture{width:auto;min-height:250px;max-height:none}.PRpy3W_menu:not(:has(.PRpy3W_inspector)){height:var(--watcher-panel-max-height)}.PRpy3W_menu:not(:has(.PRpy3W_inspector)) .PRpy3W_workPicture{flex:auto}.PRpy3W_inspector{border-right:0;width:auto;max-height:none}.PRpy3W_menu:has(.PRpy3W_inspector){height:var(--watcher-panel-max-height)}.PRpy3W_menu:has(.PRpy3W_inspector) .PRpy3W_workPicture{display:none}.PRpy3W_menu:has(.PRpy3W_inspector) .PRpy3W_inspector{flex:auto;min-height:0;max-height:none}.PRpy3W_inspectorBack{display:inline-flex}.PRpy3W_inspectorHeader{padding-top:14px}.PRpy3W_executionList{max-height:150px}}@media (width<=520px){.PRpy3W_menu{width:var(--watcher-panel-limit-w)}.PRpy3W_pictureHeader{padding:14px 12px}.PRpy3W_now{font-size:16px}.PRpy3W_turns{padding-inline:6px}.PRpy3W_groupBadges span:nth-child(n+2){display:none}.PRpy3W_inspectorHeader,.PRpy3W_executionSection,.PRpy3W_detailSection{padding-inline:12px}.PRpy3W_detailHeader{grid-template-columns:1fr}.PRpy3W_metrics{grid-template-columns:auto 1fr}.PRpy3W_metrics dd{text-align:left}.PRpy3W_modelStageCopy{grid-template-columns:1fr;gap:0}.PRpy3W_modelStageSummary{white-space:normal}.PRpy3W_modelStageLedger{grid-template-columns:1fr}.PRpy3W_reasoningToggle{grid-template-columns:12px minmax(0,1fr)}.PRpy3W_reasoningMeta{text-align:left;white-space:normal;grid-column:2}.PRpy3W_groupedModelToggle>span{gap:0;display:grid}.PRpy3W_groupedModelToggle small{white-space:normal}.PRpy3W_groupedModelList{padding-left:12px}}";
		const tagId$2 = "dsh-watcher/Watcher.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-watcher";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var Watcher_module_css_default = {
			"analysisCluster": "PRpy3W_analysisCluster",
			"analysisClusterChevron": "PRpy3W_analysisClusterChevron",
			"analysisClusterCopy": "PRpy3W_analysisClusterCopy",
			"analysisClusterCount": "PRpy3W_analysisClusterCount",
			"analysisClusterDot": "PRpy3W_analysisClusterDot",
			"analysisClusterDotSlot": "PRpy3W_analysisClusterDotSlot",
			"analysisClusterItems": "PRpy3W_analysisClusterItems",
			"analysisClusterMeta": "PRpy3W_analysisClusterMeta",
			"analysisClusterTitle": "PRpy3W_analysisClusterTitle",
			"analysisClusterToggle": "PRpy3W_analysisClusterToggle",
			"analysisClusters": "PRpy3W_analysisClusters",
			"analysisSingleton": "PRpy3W_analysisSingleton",
			"artifactGlyph": "PRpy3W_artifactGlyph",
			"artifactResult": "PRpy3W_artifactResult",
			"copyRaw": "PRpy3W_copyRaw",
			"detailEmpty": "PRpy3W_detailEmpty",
			"detailHeader": "PRpy3W_detailHeader",
			"detailIdentity": "PRpy3W_detailIdentity",
			"detailSection": "PRpy3W_detailSection",
			"detailStatus": "PRpy3W_detailStatus",
			"documentResult": "PRpy3W_documentResult",
			"empty": "PRpy3W_empty",
			"emptyEye": "PRpy3W_emptyEye",
			"executionList": "PRpy3W_executionList",
			"executionSection": "PRpy3W_executionSection",
			"eye": "PRpy3W_eye",
			"eyeBlink": "PRpy3W_eyeBlink",
			"eyePupil": "PRpy3W_eyePupil",
			"eyebrow": "PRpy3W_eyebrow",
			"follow": "PRpy3W_follow",
			"groupBadges": "PRpy3W_groupBadges",
			"groupRail": "PRpy3W_groupRail",
			"groupSignals": "PRpy3W_groupSignals",
			"groupedModelChevron": "PRpy3W_groupedModelChevron",
			"groupedModelList": "PRpy3W_groupedModelList",
			"groupedModelStages": "PRpy3W_groupedModelStages",
			"groupedModelStep": "PRpy3W_groupedModelStep",
			"groupedModelStepLabel": "PRpy3W_groupedModelStepLabel",
			"groupedModelToggle": "PRpy3W_groupedModelToggle",
			"historyNotice": "PRpy3W_historyNotice",
			"historyNoticeCopy": "PRpy3W_historyNoticeCopy",
			"inspector": "PRpy3W_inspector",
			"inspectorBack": "PRpy3W_inspectorBack",
			"inspectorBody": "PRpy3W_inspectorBody",
			"inspectorFooter": "PRpy3W_inspectorFooter",
			"inspectorHeader": "PRpy3W_inspectorHeader",
			"inspectorSummary": "PRpy3W_inspectorSummary",
			"inspectorTitle": "PRpy3W_inspectorTitle",
			"jsonSurface": "PRpy3W_jsonSurface",
			"loadAllInlineBtn": "PRpy3W_loadAllInlineBtn",
			"location": "PRpy3W_location",
			"menu": "PRpy3W_menu",
			"metrics": "PRpy3W_metrics",
			"modelStage": "PRpy3W_modelStage",
			"modelStageBar": "PRpy3W_modelStageBar",
			"modelStageBody": "PRpy3W_modelStageBody",
			"modelStageChevron": "PRpy3W_modelStageChevron",
			"modelStageCopy": "PRpy3W_modelStageCopy",
			"modelStageGlyph": "PRpy3W_modelStageGlyph",
			"modelStageLedger": "PRpy3W_modelStageLedger",
			"modelStageMetric": "PRpy3W_modelStageMetric",
			"modelStageNote": "PRpy3W_modelStageNote",
			"modelStageSummary": "PRpy3W_modelStageSummary",
			"modelStageSwatch": "PRpy3W_modelStageSwatch",
			"modelStageTitle": "PRpy3W_modelStageTitle",
			"modelStageToggle": "PRpy3W_modelStageToggle",
			"neutralDot": "PRpy3W_neutralDot",
			"now": "PRpy3W_now",
			"nowBlock": "PRpy3W_nowBlock",
			"occurrence": "PRpy3W_occurrence",
			"occurrenceChevron": "PRpy3W_occurrenceChevron",
			"occurrenceCopy": "PRpy3W_occurrenceCopy",
			"occurrenceDuration": "PRpy3W_occurrenceDuration",
			"occurrenceMeta": "PRpy3W_occurrenceMeta",
			"occurrenceTitle": "PRpy3W_occurrenceTitle",
			"occurrences": "PRpy3W_occurrences",
			"overviewOccurrence": "PRpy3W_overviewOccurrence",
			"overviewOccurrenceChevron": "PRpy3W_overviewOccurrenceChevron",
			"overviewOccurrenceCopy": "PRpy3W_overviewOccurrenceCopy",
			"overviewOccurrenceDot": "PRpy3W_overviewOccurrenceDot",
			"overviewOccurrenceDotSlot": "PRpy3W_overviewOccurrenceDotSlot",
			"overviewOccurrenceDuration": "PRpy3W_overviewOccurrenceDuration",
			"overviewOccurrenceIndex": "PRpy3W_overviewOccurrenceIndex",
			"overviewOccurrenceMeta": "PRpy3W_overviewOccurrenceMeta",
			"overviewOccurrenceTitle": "PRpy3W_overviewOccurrenceTitle",
			"overviewOccurrences": "PRpy3W_overviewOccurrences",
			"overviewStep": "PRpy3W_overviewStep",
			"overviewStepHeader": "PRpy3W_overviewStepHeader",
			"overviewStepLabel": "PRpy3W_overviewStepLabel",
			"overviewStepSignals": "PRpy3W_overviewStepSignals",
			"overviewTag": "PRpy3W_overviewTag",
			"parallelLabel": "PRpy3W_parallelLabel",
			"patternLabel": "PRpy3W_patternLabel",
			"phase": "PRpy3W_phase",
			"phaseChevron": "PRpy3W_phaseChevron",
			"phaseCopy": "PRpy3W_phaseCopy",
			"phaseHeader": "PRpy3W_phaseHeader",
			"phaseMarker": "PRpy3W_phaseMarker",
			"phaseMeta": "PRpy3W_phaseMeta",
			"phaseTitle": "PRpy3W_phaseTitle",
			"phaseTitleLine": "PRpy3W_phaseTitleLine",
			"phaseToggle": "PRpy3W_phaseToggle",
			"pictureHeader": "PRpy3W_pictureHeader",
			"railLine": "PRpy3W_railLine",
			"railViewport": "PRpy3W_railViewport",
			"rawPanel": "PRpy3W_rawPanel",
			"rawToolbar": "PRpy3W_rawToolbar",
			"reasoningAttempts": "PRpy3W_reasoningAttempts",
			"reasoningBody": "PRpy3W_reasoningBody",
			"reasoningChevron": "PRpy3W_reasoningChevron",
			"reasoningDisclosure": "PRpy3W_reasoningDisclosure",
			"reasoningLabel": "PRpy3W_reasoningLabel",
			"reasoningMeta": "PRpy3W_reasoningMeta",
			"reasoningToggle": "PRpy3W_reasoningToggle",
			"root": "PRpy3W_root",
			"sectionHeading": "PRpy3W_sectionHeading",
			"sessionTiming": "PRpy3W_sessionTiming",
			"sessionTimingMetric": "PRpy3W_sessionTimingMetric",
			"statusLine": "PRpy3W_statusLine",
			"stepBlock": "PRpy3W_stepBlock",
			"stepChevron": "PRpy3W_stepChevron",
			"stepDuration": "PRpy3W_stepDuration",
			"stepHeading": "PRpy3W_stepHeading",
			"stepSignals": "PRpy3W_stepSignals",
			"stepTimeline": "PRpy3W_stepTimeline",
			"stepToggle": "PRpy3W_stepToggle",
			"summary": "PRpy3W_summary",
			"tab": "PRpy3W_tab",
			"tabPanel": "PRpy3W_tabPanel",
			"tabs": "PRpy3W_tabs",
			"trigger": "PRpy3W_trigger",
			"turn": "PRpy3W_turn",
			"turnBody": "PRpy3W_turnBody",
			"turnChevron": "PRpy3W_turnChevron",
			"turnCopy": "PRpy3W_turnCopy",
			"turnDuration": "PRpy3W_turnDuration",
			"turnHeader": "PRpy3W_turnHeader",
			"turnMetric": "PRpy3W_turnMetric",
			"turnMetrics": "PRpy3W_turnMetrics",
			"turnPerformance": "PRpy3W_turnPerformance",
			"turnSpeed": "PRpy3W_turnSpeed",
			"turnSummary": "PRpy3W_turnSummary",
			"turnTitle": "PRpy3W_turnTitle",
			"turnTitleLine": "PRpy3W_turnTitleLine",
			"turnToggle": "PRpy3W_turnToggle",
			"turns": "PRpy3W_turns",
			"unread": "PRpy3W_unread",
			"viewControl": "PRpy3W_viewControl",
			"viewMode": "PRpy3W_viewMode",
			"viewToolbar": "PRpy3W_viewToolbar",
			"viewToolbarLabel": "PRpy3W_viewToolbarLabel",
			"watcher-eye-blink": "PRpy3W_watcher-eye-blink",
			"watcher-eye-scan": "PRpy3W_watcher-eye-scan",
			"watcher-live-append": "PRpy3W_watcher-live-append",
			"watcher-panel-enter": "PRpy3W_watcher-panel-enter",
			"workPicture": "PRpy3W_workPicture"
		};
		//#endregion
		//#region lib/types/client/panel-position.js
		/**
		* Anchored placement for the Watcher panel, correct under page zoom.
		*
		* The shared `useAnchoredPosition` primitive mixes two coordinate spaces, so a
		* page-level `html { zoom: … }` — a stylesheet a deployment may layer on top of
		* the shell, independent of this plugin — pushes the panel off the right edge:
		*
		* - `getBoundingClientRect()` and `window.innerWidth/innerHeight` are in
		*   VISUAL pixels — the zoom is already applied;
		* - `offsetWidth/offsetHeight` and every inline length (`left`, `max-width`)
		*   are in UNZOOMED layout pixels.
		*
		* Under zoom 1.1 a 720px panel is 792 visual px wide while the clamp subtracts
		* 720 from a 1896 visual viewport, so the panel lands ~176px past the edge.
		* This hook converts the panel's box into visual pixels once, clamps there, and
		* returns every length back in layout pixels. At zoom 1 the math is identical
		* to the primitive.
		* @module dsh-watcher/client/panel-position
		*/
		/**
		* Track an anchor and return zoom-correct fixed coordinates and size limits.
		* @param options - the open state, the two refs, the placement side, and the gap/margin distances.
		* @returns the panel's inline style, or `null` before the first measurement.
		*/
		function useAnchoredPanel(options) {
			const { open, anchorRef, panelRef, side = "bottom", gap, margin } = options;
			const [position, setPosition] = (0, react.useState)(null);
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					setPosition(null);
					return;
				}
				const place = () => {
					const anchor = anchorRef.current;
					const panel = panelRef.current;
					if (anchor === null || panel === null) return;
					const rect = anchor.getBoundingClientRect();
					const measured = panel.getBoundingClientRect();
					const layoutWidth = panel.offsetWidth;
					const layoutHeight = panel.offsetHeight;
					const scale = layoutWidth > 0 && measured.width > 0 ? measured.width / layoutWidth : 1;
					const limitW = Math.max(0, window.innerWidth - margin * 2 * scale);
					const limitH = Math.max(0, window.innerHeight - margin * 2 * scale);
					const visualWidth = Math.min(layoutWidth * scale, limitW);
					const visualHeight = Math.min(layoutHeight * scale, limitH);
					const visualMargin = margin * scale;
					let left = rect.left;
					let top = side === "top" ? rect.top - gap * scale - visualHeight : rect.bottom + gap * scale;
					if (visualWidth > 0) left = Math.min(Math.max(left, visualMargin), window.innerWidth - visualWidth - visualMargin);
					if (visualHeight > 0) top = Math.min(Math.max(top, visualMargin), window.innerHeight - visualHeight - visualMargin);
					setPosition({
						left: `${String(left / scale)}px`,
						top: `${String(top / scale)}px`,
						"--watcher-panel-limit-w": `${String(limitW / scale)}px`,
						"--watcher-panel-limit-h": `${String(limitH / scale)}px`
					});
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				let observer = null;
				const observed = panelRef.current;
				if (typeof ResizeObserver !== "undefined" && observed !== null) {
					observer = new ResizeObserver(place);
					observer.observe(observed);
				}
				const settled = panelRef.current;
				settled?.addEventListener("animationend", place);
				return () => {
					observer?.disconnect();
					settled?.removeEventListener("animationend", place);
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [
				open,
				anchorRef,
				panelRef,
				side,
				gap,
				margin
			]);
			return position;
		}
		//#endregion
		//#region src/insights/presentation.mjs
		/** Browser-safe analysis. No agent commands or model calls. */
		/** @type {{silenceSeconds:number, reasoningSeconds:number}} */
		const DEFAULT_LIMITS = Object.freeze({
			silenceSeconds: 30,
			reasoningSeconds: 90
		});
		function limitsOf(raw) {
			const safe = (v, fallback) => Number.isFinite(v) && v >= 5 && v <= 3600 ? Math.round(v) : fallback;
			return {
				silenceSeconds: safe(raw?.silenceSeconds, 30),
				reasoningSeconds: safe(raw?.reasoningSeconds, 90)
			};
		}
		/** @param {any} view @param {number} now @param {{running?:boolean,waiting?:boolean,limits?:{silenceSeconds:number,reasoningSeconds:number}}} options */
		function alertsOf(view, now, { running = false, waiting = false, limits = DEFAULT_LIMITS } = {}) {
			if (!view) return [];
			const alerts = (view.findings ?? []).filter((f) => f.turn === view.turn?.number).slice(-3);
			const p = view.pending;
			if (!running || waiting || !p) return alerts;
			const last = p.lastContentAt ?? p.start;
			if (last !== null && now >= last && now - last >= limits.silenceSeconds * 1e3) alerts.push({
				id: "silence",
				kind: "silence",
				turn: p.turn,
				steps: [p.step],
				seqs: [],
				title: `${Math.floor((now - last) / 1e3)} 秒未收到模型内容`,
				detail: "可能是首响应等待、连接或服务端停顿；这不是内部思考时长，也不能据此确定空转。"
			});
			if (p.reasoningFirst !== null && p.reasoningLast !== null && p.reasoningLast - p.reasoningFirst >= limits.reasoningSeconds * 1e3) alerts.push({
				id: "reasoning-span",
				kind: "reasoning-span",
				turn: p.turn,
				steps: [p.step],
				seqs: [],
				title: `本次可见推理采样跨度 ${Math.round((p.reasoningLast - p.reasoningFirst) / 1e3)} 秒`,
				detail: "只按已收到片段的首末时间计算，可能包含片段间等待。时长偏长不是任务质量结论。"
			});
			return alerts;
		}
		/**
		* RC1 follow() can promote a cold Session after its first yielded snapshot.
		* Do NOT use follow() to scan sessions, even with early abort.
		* list() provides attached projections and cold hints without Agent activation.
		* @param {any} remote
		* @param {{signal?:AbortSignal,limit?:number,onProgress?:(value:any)=>void}} options
		*/
		async function scanSessions(remote, { signal, limit = 30, onProgress = () => {} } = {}) {
			const res = await remote.session.list({}, signal);
			signal?.throwIfAborted();
			const rawItems = res?.value?.items ?? res?.items ?? res;
			if (!Array.isArray(rawItems)) throw new TypeError("Session list response has no items array");
			const unique = [...new Map(rawItems.filter((x) => typeof x.sessionId === "string" && !x.blank).map((x) => [x.sessionId, x])).values()];
			const picked = unique.slice(0, Math.min(100, Math.max(1, limit)));
			const result = {
				rows: picked.map((row) => {
					const candidate = row.projections?.values?.watcherInsights;
					let value = null, error = null;
					if (row.origin === "subagent") error = "直接子代理暂未纳入；避免重复计算继承前缀";
					else if (candidate?.version === 1 && candidate.sessionId === row.sessionId && candidate.totals && Array.isArray(candidate.models) && Array.isArray(candidate.findings)) value = candidate;
					else error = "尚无 Watcher 统计缓存；在加载插件后运行或打开此会话，再刷新统计";
					return {
						sessionId: row.sessionId,
						value,
						error,
						updatedAt: Number(row.updatedAt) || 0
					};
				}),
				total: unique.length,
				selected: picked.length
			};
			onProgress(result);
			return result;
		}
		//#endregion
		//#region \0dsh-css:src/client/Insights.module.css.mjs
		const css$1 = ".U3JAba_hudBox{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);width:100%;font-family:var(--dsw-font-family);flex:none}.U3JAba_hudTop{background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:12px;padding:8px 14px;display:flex}.U3JAba_hudTopLeft{flex-wrap:nowrap;align-items:center;gap:8px;min-width:0;display:flex}.U3JAba_hudHeading{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:11px;font-weight:600}.U3JAba_currentModelTag{background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap;border-radius:4px;flex-shrink:1;align-items:center;gap:5px;min-width:0;max-width:100%;padding:1px 6px;font-size:11px;display:inline-flex}.U3JAba_modelTagText{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:600;overflow:hidden}.U3JAba_effortTag{color:var(--dsw-static-deepseek-450,#5686fe);white-space:nowrap;background:#5686fe1f;border-radius:3px;flex-shrink:0;padding:0 5px;font-size:10px;font-weight:600;line-height:14px}.U3JAba_contextTag{color:var(--dsw-alias-label-secondary,#5f636d);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);font-variant-numeric:tabular-nums;white-space:nowrap;border-radius:4px;flex-shrink:0;padding:1px 7px;font-size:11px}.U3JAba_hudTopRight{flex-shrink:0;align-items:center;gap:10px;display:flex}.U3JAba_tokenStat{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:11px}.U3JAba_tokenStat strong{color:var(--dsw-alias-label-primary)}.U3JAba_scopeGroup{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:5px;gap:1px;padding:1px;display:inline-flex}.U3JAba_scopeBtn{color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;background:0 0;border:0;border-radius:3px;padding:2px 7px;font-size:11px;line-height:14px;transition:all .12s}.U3JAba_scopeBtn[data-active]{background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1);font-weight:600}.U3JAba_modelTabBar{background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);gap:4px;padding:6px 14px;display:flex;overflow-x:auto}.U3JAba_modelTabBtn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;border-radius:4px;padding:2px 8px;font-size:11px;transition:all .12s}.U3JAba_modelTabBtn[data-active]{background:var(--dsw-static-deepseek-450,#5686fe);color:#fff;border-color:var(--dsw-static-deepseek-450,#5686fe);font-weight:600}.U3JAba_hudBody{padding:10px 14px}.U3JAba_alertSection{flex-direction:column;gap:6px;margin-top:8px;display:flex}.U3JAba_alertCard{border-radius:6px;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;display:flex}.U3JAba_alertCardDanger{background:#e5484d14;border:1px solid #e5484d40}.U3JAba_alertCardWarn{background:#f59e0b14;border:1px solid #f59e0b40}.U3JAba_alertLeft{align-items:center;gap:8px;min-width:0;display:flex}.U3JAba_alertTag{color:#fff;border-radius:3px;flex:none;padding:1px 5px;font-size:10px;font-weight:600}.U3JAba_tagDanger{background:var(--dsw-alias-state-error-primary,#e5484d)}.U3JAba_tagWarn{background:#f59e0b}.U3JAba_alertTexts{flex-direction:column;min-width:0;display:flex}.U3JAba_alertMainText{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}.U3JAba_alertSubText{color:var(--dsw-alias-label-secondary);font-size:11px}.U3JAba_alertActionBtn{color:var(--dsw-static-deepseek-450,#5686fe);cursor:pointer;white-space:nowrap;background:0 0;border:none;padding:2px 6px;font-size:11px;font-weight:600}.U3JAba_settingsContainer{width:100%;min-width:0;max-width:100%;color:var(--dsw-alias-label-primary);box-sizing:border-box;flex-direction:column;gap:14px;padding:0 0 24px;display:flex;overflow-x:hidden}.U3JAba_cockpitHeader{flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;display:flex}.U3JAba_cockpitTitleArea h2{color:var(--dsw-alias-label-primary);letter-spacing:-.3px;margin:0;font-size:17px;font-weight:700}.U3JAba_cockpitSubTitle{color:var(--dsw-alias-label-tertiary);margin:3px 0 0;font-size:12px}.U3JAba_headerRightControls{align-items:center;gap:8px;display:flex}.U3JAba_rangeSwitchGroup{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px;display:flex}.U3JAba_rangeBtn{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;transition:all .12s}.U3JAba_rangeBtn[data-active]{background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}.U3JAba_settingsScanBtn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:500;transition:all .12s}.U3JAba_heroStatsRow{border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px;padding-bottom:10px;display:flex}.U3JAba_heroBigNum{letter-spacing:-.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;align-items:baseline;gap:6px;font-size:26px;font-weight:800;display:flex}.U3JAba_heroUnit{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500}.U3JAba_heroMetaCol{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-wrap:nowrap;gap:14px;font-size:12px;display:flex}.U3JAba_heroMetaCol strong{color:var(--dsw-alias-label-primary)}.U3JAba_roastGrid{box-sizing:border-box;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;display:grid}@media (width<=440px){.U3JAba_roastGrid{grid-template-columns:1fr}}.U3JAba_roastItem{background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);min-height:136px;box-shadow:var(--dsw-shadow-lv1);cursor:pointer;user-select:none;box-sizing:border-box;border-radius:8px;flex-direction:column;justify-content:space-between;padding:12px 14px;transition:all .12s;display:flex}.U3JAba_roastItem:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}.U3JAba_roastItemActive{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px var(--dsw-static-deepseek-450,#5686fe);border-color:var(--dsw-static-deepseek-450,#5686fe)!important}.U3JAba_roastHead{justify-content:space-between;align-items:center;margin-bottom:4px;display:flex}.U3JAba_roastTag{letter-spacing:.3px;font-size:11px;font-weight:700}.U3JAba_roastCategoryBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1,#0000000f);border-radius:3px;padding:1px 4px;font-size:9px;line-height:1.2}.U3JAba_roastTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700;line-height:18px;overflow:hidden}.U3JAba_roastDesc{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:10px;line-height:15px;overflow:hidden}.U3JAba_roastVal{font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;margin-top:6px;font-size:12px;font-weight:700;overflow:hidden}.U3JAba_roastFooter{border-top:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;font-size:10px;line-height:1;display:flex}.U3JAba_roastFooterLeft{text-overflow:ellipsis;white-space:nowrap;max-width:110px;overflow:hidden}.U3JAba_roastAction{color:var(--dsw-alias-label-secondary);flex-shrink:0;font-weight:600;transition:color .12s}.U3JAba_roastItem:hover .U3JAba_roastAction,.U3JAba_roastItemActive .U3JAba_roastAction{color:var(--dsw-static-deepseek-450,#5686fe)}.U3JAba_drilldownPanel{background:var(--dsw-specific-menu);border:1px solid var(--dsw-static-deepseek-450,#5686fe);box-shadow:var(--dsw-shadow-lv2,0 4px 12px #00000014);border-radius:10px;flex-direction:column;gap:12px;min-width:0;padding:14px 16px;animation:.15s ease-out U3JAba_slideDown;display:flex}@keyframes U3JAba_slideDown{0%{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}.U3JAba_drilldownHead{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:12px;min-width:0;padding-bottom:8px;display:flex}.U3JAba_drilldownTitleGroup{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.U3JAba_drilldownTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700;overflow:hidden}.U3JAba_drilldownSub{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.U3JAba_drilldownCloseBtn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:4px;flex-shrink:0;padding:3px 8px;font-size:11px;transition:all .12s}.U3JAba_drilldownCloseBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}.U3JAba_drilldownEmpty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:16px;font-size:12px}.U3JAba_rankList{flex-direction:column;gap:8px;display:flex}.U3JAba_rankItem{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1,#0000000f);border-radius:6px;flex-direction:column;gap:6px;min-width:0;padding:8px 12px;display:flex}.U3JAba_rankItemTop{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.U3JAba_rankItemLeft{flex:1;align-items:center;gap:8px;min-width:0;display:flex}.U3JAba_rankBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);font-variant-numeric:tabular-nums;border-radius:3px;flex-shrink:0;padding:1px 5px;font-size:10px;font-weight:700;line-height:1.2}.U3JAba_rankBadgeGold{color:#d97706;background:#f59e0b1f;border-color:#f59e0b66}.U3JAba_rankName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;overflow:hidden}.U3JAba_rankValMain{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0;font-size:12px;font-weight:700}.U3JAba_rankTrack{background:var(--dsw-specific-menu);border-radius:3px;width:100%;height:6px;overflow:hidden}.U3JAba_rankBar{border-radius:3px;height:100%;transition:width .2s}.U3JAba_rankSubText{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;justify-content:space-between;align-items:center;gap:8px;font-size:10px;line-height:1.2;display:flex;overflow:hidden}.U3JAba_rankSubText strong{color:var(--dsw-alias-label-primary)}.U3JAba_toolDrillSection{flex-direction:column;gap:12px;min-width:0;display:flex}.U3JAba_toolCompoundBox{flex-direction:column;gap:6px;display:flex}.U3JAba_toolCompoundTrack{background:var(--dsw-alias-bg-layer-2);border-radius:4px;gap:1px;height:10px;display:flex;overflow:hidden}.U3JAba_toolSliceBash{background:var(--dsw-static-green-500,#10b981);height:100%}.U3JAba_toolSliceFile{background:#0ea5e9;height:100%}.U3JAba_toolCompoundLegend{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:16px;font-size:11px;display:flex}.U3JAba_toolCompoundLegend span{align-items:center;gap:6px;display:flex}.U3JAba_toolCompoundLegend strong{color:var(--dsw-alias-label-primary)}.U3JAba_toolGridCards{grid-template-columns:1fr 1fr;gap:10px;display:grid}@media (width<=600px){.U3JAba_toolGridCards{grid-template-columns:1fr}}.U3JAba_toolMiniCard{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;flex-direction:column;gap:4px;min-width:0;padding:10px 12px;display:flex}.U3JAba_toolMiniTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;align-items:center;gap:6px;font-size:11px;font-weight:600;display:flex;overflow:hidden}.U3JAba_toolMiniNum{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin:2px 0;font-size:15px;font-weight:700}.U3JAba_toolMiniDesc{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}.U3JAba_toolTopList{border-top:1px dashed var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding-top:8px;display:flex}.U3JAba_toolTopListTitle{color:var(--dsw-alias-label-secondary);margin-bottom:2px;font-size:11px;font-weight:600}.U3JAba_errorDrillSection{flex-direction:column;gap:8px;display:flex}.U3JAba_errorAllGoodBox{color:var(--dsw-static-green-500,#10b981);text-align:center;background:#10b98114;border:1px solid #10b9814d;border-radius:6px;padding:16px;font-size:12px;font-weight:600}.U3JAba_errorSessionList{flex-direction:column;gap:6px;display:flex}.U3JAba_errorSessionRow{background:var(--dsw-alias-bg-layer-2);font-variant-numeric:tabular-nums;border-radius:4px;grid-template-columns:28px 110px 1fr 75px 75px;align-items:center;gap:8px;min-width:0;padding:6px 10px;font-size:11px;display:grid}.U3JAba_vizSplitGrid{box-sizing:border-box;grid-template-columns:1fr;gap:12px;width:100%;display:grid}.U3JAba_vizPanel{background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv1);box-sizing:border-box;border-radius:10px;flex-direction:column;gap:10px;width:100%;min-width:0;padding:12px 14px;display:flex;overflow:hidden}.U3JAba_vizHead{justify-content:space-between;align-items:center;font-size:12px;display:flex}.U3JAba_vizTitle{color:var(--dsw-alias-label-primary);font-weight:700}.U3JAba_vizSub{color:var(--dsw-alias-label-secondary);font-size:10px}.U3JAba_donutWrap{box-sizing:border-box;flex-direction:row;align-items:center;gap:20px;width:100%;display:flex}@media (width<=480px){.U3JAba_donutWrap{flex-direction:column;align-items:center}}.U3JAba_donutSvgBox{width:140px;height:140px;position:relative}.U3JAba_donutSvg{width:100%;height:100%}.U3JAba_donutCenterText{text-align:center;pointer-events:none;flex-direction:column;justify-content:center;align-items:center;width:68px;display:flex;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.U3JAba_donutCenterNum{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:17px;font-weight:800;line-height:1.1}.U3JAba_donutCenterSub{color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin-top:2px;font-size:10px;font-weight:500;line-height:1}.U3JAba_donutLegendList{flex-direction:column;flex:1;gap:3px;width:100%;min-width:0;display:flex}.U3JAba_donutLegendRow{cursor:pointer;border-radius:4px;justify-content:space-between;align-items:center;min-width:0;padding:3px 6px;font-size:11px;transition:background .12s;display:flex}.U3JAba_donutLegendRow:hover,.U3JAba_donutLegendRowActive{background:var(--dsw-alias-bg-layer-2)}.U3JAba_dlLeft{flex:1;align-items:center;gap:6px;min-width:0;margin-right:8px;display:flex}.U3JAba_dlDot{border-radius:2px;flex-shrink:0;width:8px;height:8px}.U3JAba_dlName{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden}.U3JAba_dlRight{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-shrink:0;font-weight:600}.U3JAba_donutInspectBar{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;align-items:center;gap:8px;min-width:0;margin-top:2px;padding:6px 10px;font-size:11px;display:flex}.U3JAba_donutInspectName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-weight:600;overflow:hidden}.U3JAba_donutInspectTag{color:var(--dsw-static-deepseek-450,#5686fe);background:#5686fe1f;border-radius:3px;flex-shrink:0;padding:1px 5px;font-size:9px;font-weight:600;line-height:1.2}.U3JAba_donutInspectVal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-shrink:0;font-size:11px;font-weight:600}.U3JAba_dayStack{align-items:stretch;gap:3px;min-width:0;height:160px;display:flex}.U3JAba_dayStackWeek{justify-content:center;gap:12px}.U3JAba_dayStackWeek .U3JAba_dayCol{max-width:48px}.U3JAba_dayCol{flex-direction:column;flex:1 1 0;align-items:stretch;gap:4px;min-width:0;display:flex}.U3JAba_dayColFill{background:var(--dsw-alias-bg-layer-2);border-radius:4px;flex-direction:column-reverse;flex:1;justify-content:flex-start;min-height:0;transition:filter .12s;display:flex;overflow:hidden}.U3JAba_dayColFill:hover{filter:brightness(1.1)}.U3JAba_daySeg{flex:none;width:100%;min-height:0}.U3JAba_dayEmptyDot{background:var(--dsw-alias-border-l2);border-radius:2px;width:100%;height:3px;margin-top:auto}.U3JAba_dayLabel{color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;font-size:10px;line-height:1;overflow:visible}.U3JAba_chartAreaBox{width:100%;height:180px;position:relative}.U3JAba_chartSvg{width:100%;height:100%;overflow:visible}.U3JAba_chartAxisLabel{fill:var(--dsw-alias-label-tertiary);font-size:9px}.U3JAba_chartGridLine{stroke:var(--dsw-alias-border-l2);stroke-dasharray:2 3}.U3JAba_chartFoot{color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px;font-size:10px}.U3JAba_tableTitleGroup{flex-direction:column;gap:2px;min-width:0;display:flex}.U3JAba_tableSortGroup{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;flex-shrink:0;gap:2px;padding:2px;display:flex}.U3JAba_sortBtn{color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:4px;padding:2px 7px;font-size:10px;line-height:16px;transition:all .12s}.U3JAba_sortBtn:hover{color:var(--dsw-alias-label-primary)}.U3JAba_sortBtn[data-active]{background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1);font-weight:600}.U3JAba_sessionTableBox{box-sizing:border-box;flex-direction:column;gap:4px;width:100%;display:flex}.U3JAba_sessionTableHeader{color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-sizing:border-box;border-radius:6px;grid-template-columns:minmax(0,1.2fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,.7fr) 14px;align-items:center;gap:6px;padding:6px 10px;font-size:10px;font-weight:600;display:grid}.U3JAba_sessionItemRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:6px;transition:border-color .12s;overflow:hidden}.U3JAba_sessionItemRow:hover{border-color:var(--dsw-alias-border-l3)}.U3JAba_tableRankNum{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-right:4px;font-size:10px}.U3JAba_sessionItemHead{width:100%;color:inherit;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums;box-sizing:border-box;background:0 0;border:0;grid-template-columns:minmax(0,1.2fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,.7fr) 14px;align-items:center;gap:6px;padding:8px 10px;font-size:11px;display:grid}.U3JAba_sessionTokenCell{flex-direction:column;align-items:flex-end;gap:2px;min-width:0;display:flex}.U3JAba_sessionTokenBar{background:var(--dsw-static-deepseek-450,#5686fe);border-radius:1px;max-width:100%;height:2px}.U3JAba_sessionModelCell{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.U3JAba_statusOk{color:var(--dsw-static-green-500,#10b981)}.U3JAba_statusWarn{color:#b45309}.U3JAba_statusBad{color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:600}.U3JAba_sessionIdTag{color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace;font-size:11px;font-weight:600}.U3JAba_arrowIcon{color:var(--dsw-alias-label-tertiary);transition:transform .12s}.U3JAba_sessionItemOpen .U3JAba_arrowIcon{transform:rotate(90deg)}.U3JAba_sessionItemDrawer{background:var(--dsw-specific-menu);border-top:1px dashed var(--dsw-alias-border-l2);padding:10px 12px;font-size:11px}.U3JAba_drawerTitle{color:var(--dsw-alias-label-primary);margin-bottom:6px;font-weight:600}.U3JAba_drawerBarTrack{background:var(--dsw-alias-bg-layer-2);border-radius:4px;gap:1px;height:8px;margin-bottom:6px;display:flex;overflow:hidden}.U3JAba_drawerSliceModel{background:var(--dsw-static-deepseek-450,#5686fe);height:100%}.U3JAba_drawerSliceTool{background:var(--dsw-static-green-500,#10b981);height:100%}.U3JAba_drawerMetaRow{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;justify-content:space-between;gap:6px;font-size:10px;display:flex}.U3JAba_settingsDrawer{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-specific-menu);border-radius:8px;padding:8px 12px;font-size:11px}.U3JAba_settingsSummary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-weight:500}.U3JAba_settingsDrawerContent{flex-wrap:wrap;align-items:center;gap:14px;padding-top:10px;display:flex}.U3JAba_settingInlineItem{align-items:center;gap:6px;display:flex}.U3JAba_settingsMiniInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:50px;color:var(--dsw-alias-label-primary);text-align:right;border-radius:4px;outline:none;padding:3px 6px;font-size:11px}.U3JAba_settingsMiniSaveBtn{background:var(--dsw-static-deepseek-450,#5686fe);color:#fff;cursor:pointer;border:none;border-radius:4px;padding:3px 10px;font-size:11px}.U3JAba_emptyScan{text-align:center;color:var(--dsw-alias-label-tertiary);padding:20px;font-size:12px}";
		const tagId$1 = "dsh-watcher/Insights.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-watcher";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var Insights_module_css_default = {
			"alertActionBtn": "U3JAba_alertActionBtn",
			"alertCard": "U3JAba_alertCard",
			"alertCardDanger": "U3JAba_alertCardDanger",
			"alertCardWarn": "U3JAba_alertCardWarn",
			"alertLeft": "U3JAba_alertLeft",
			"alertMainText": "U3JAba_alertMainText",
			"alertSection": "U3JAba_alertSection",
			"alertSubText": "U3JAba_alertSubText",
			"alertTag": "U3JAba_alertTag",
			"alertTexts": "U3JAba_alertTexts",
			"arrowIcon": "U3JAba_arrowIcon",
			"chartAreaBox": "U3JAba_chartAreaBox",
			"chartAxisLabel": "U3JAba_chartAxisLabel",
			"chartFoot": "U3JAba_chartFoot",
			"chartGridLine": "U3JAba_chartGridLine",
			"chartSvg": "U3JAba_chartSvg",
			"cockpitHeader": "U3JAba_cockpitHeader",
			"cockpitSubTitle": "U3JAba_cockpitSubTitle",
			"cockpitTitleArea": "U3JAba_cockpitTitleArea",
			"contextTag": "U3JAba_contextTag",
			"currentModelTag": "U3JAba_currentModelTag",
			"dayCol": "U3JAba_dayCol",
			"dayColFill": "U3JAba_dayColFill",
			"dayEmptyDot": "U3JAba_dayEmptyDot",
			"dayLabel": "U3JAba_dayLabel",
			"daySeg": "U3JAba_daySeg",
			"dayStack": "U3JAba_dayStack",
			"dayStackWeek": "U3JAba_dayStackWeek",
			"dlDot": "U3JAba_dlDot",
			"dlLeft": "U3JAba_dlLeft",
			"dlName": "U3JAba_dlName",
			"dlRight": "U3JAba_dlRight",
			"donutCenterNum": "U3JAba_donutCenterNum",
			"donutCenterSub": "U3JAba_donutCenterSub",
			"donutCenterText": "U3JAba_donutCenterText",
			"donutInspectBar": "U3JAba_donutInspectBar",
			"donutInspectName": "U3JAba_donutInspectName",
			"donutInspectTag": "U3JAba_donutInspectTag",
			"donutInspectVal": "U3JAba_donutInspectVal",
			"donutLegendList": "U3JAba_donutLegendList",
			"donutLegendRow": "U3JAba_donutLegendRow",
			"donutLegendRowActive": "U3JAba_donutLegendRowActive",
			"donutSvg": "U3JAba_donutSvg",
			"donutSvgBox": "U3JAba_donutSvgBox",
			"donutWrap": "U3JAba_donutWrap",
			"drawerBarTrack": "U3JAba_drawerBarTrack",
			"drawerMetaRow": "U3JAba_drawerMetaRow",
			"drawerSliceModel": "U3JAba_drawerSliceModel",
			"drawerSliceTool": "U3JAba_drawerSliceTool",
			"drawerTitle": "U3JAba_drawerTitle",
			"drilldownCloseBtn": "U3JAba_drilldownCloseBtn",
			"drilldownEmpty": "U3JAba_drilldownEmpty",
			"drilldownHead": "U3JAba_drilldownHead",
			"drilldownPanel": "U3JAba_drilldownPanel",
			"drilldownSub": "U3JAba_drilldownSub",
			"drilldownTitle": "U3JAba_drilldownTitle",
			"drilldownTitleGroup": "U3JAba_drilldownTitleGroup",
			"effortTag": "U3JAba_effortTag",
			"emptyScan": "U3JAba_emptyScan",
			"errorAllGoodBox": "U3JAba_errorAllGoodBox",
			"errorDrillSection": "U3JAba_errorDrillSection",
			"errorSessionList": "U3JAba_errorSessionList",
			"errorSessionRow": "U3JAba_errorSessionRow",
			"headerRightControls": "U3JAba_headerRightControls",
			"heroBigNum": "U3JAba_heroBigNum",
			"heroMetaCol": "U3JAba_heroMetaCol",
			"heroStatsRow": "U3JAba_heroStatsRow",
			"heroUnit": "U3JAba_heroUnit",
			"hudBody": "U3JAba_hudBody",
			"hudBox": "U3JAba_hudBox",
			"hudHeading": "U3JAba_hudHeading",
			"hudTop": "U3JAba_hudTop",
			"hudTopLeft": "U3JAba_hudTopLeft",
			"hudTopRight": "U3JAba_hudTopRight",
			"modelTabBar": "U3JAba_modelTabBar",
			"modelTabBtn": "U3JAba_modelTabBtn",
			"modelTagText": "U3JAba_modelTagText",
			"rangeBtn": "U3JAba_rangeBtn",
			"rangeSwitchGroup": "U3JAba_rangeSwitchGroup",
			"rankBadge": "U3JAba_rankBadge",
			"rankBadgeGold": "U3JAba_rankBadgeGold",
			"rankBar": "U3JAba_rankBar",
			"rankItem": "U3JAba_rankItem",
			"rankItemLeft": "U3JAba_rankItemLeft",
			"rankItemTop": "U3JAba_rankItemTop",
			"rankList": "U3JAba_rankList",
			"rankName": "U3JAba_rankName",
			"rankSubText": "U3JAba_rankSubText",
			"rankTrack": "U3JAba_rankTrack",
			"rankValMain": "U3JAba_rankValMain",
			"roastAction": "U3JAba_roastAction",
			"roastCategoryBadge": "U3JAba_roastCategoryBadge",
			"roastDesc": "U3JAba_roastDesc",
			"roastFooter": "U3JAba_roastFooter",
			"roastFooterLeft": "U3JAba_roastFooterLeft",
			"roastGrid": "U3JAba_roastGrid",
			"roastHead": "U3JAba_roastHead",
			"roastItem": "U3JAba_roastItem",
			"roastItemActive": "U3JAba_roastItemActive",
			"roastTag": "U3JAba_roastTag",
			"roastTitle": "U3JAba_roastTitle",
			"roastVal": "U3JAba_roastVal",
			"scopeBtn": "U3JAba_scopeBtn",
			"scopeGroup": "U3JAba_scopeGroup",
			"sessionIdTag": "U3JAba_sessionIdTag",
			"sessionItemDrawer": "U3JAba_sessionItemDrawer",
			"sessionItemHead": "U3JAba_sessionItemHead",
			"sessionItemOpen": "U3JAba_sessionItemOpen",
			"sessionItemRow": "U3JAba_sessionItemRow",
			"sessionModelCell": "U3JAba_sessionModelCell",
			"sessionTableBox": "U3JAba_sessionTableBox",
			"sessionTableHeader": "U3JAba_sessionTableHeader",
			"sessionTokenBar": "U3JAba_sessionTokenBar",
			"sessionTokenCell": "U3JAba_sessionTokenCell",
			"settingInlineItem": "U3JAba_settingInlineItem",
			"settingsContainer": "U3JAba_settingsContainer",
			"settingsDrawer": "U3JAba_settingsDrawer",
			"settingsDrawerContent": "U3JAba_settingsDrawerContent",
			"settingsMiniInput": "U3JAba_settingsMiniInput",
			"settingsMiniSaveBtn": "U3JAba_settingsMiniSaveBtn",
			"settingsScanBtn": "U3JAba_settingsScanBtn",
			"settingsSummary": "U3JAba_settingsSummary",
			"slideDown": "U3JAba_slideDown",
			"sortBtn": "U3JAba_sortBtn",
			"statusBad": "U3JAba_statusBad",
			"statusOk": "U3JAba_statusOk",
			"statusWarn": "U3JAba_statusWarn",
			"tableRankNum": "U3JAba_tableRankNum",
			"tableSortGroup": "U3JAba_tableSortGroup",
			"tableTitleGroup": "U3JAba_tableTitleGroup",
			"tagDanger": "U3JAba_tagDanger",
			"tagWarn": "U3JAba_tagWarn",
			"tokenStat": "U3JAba_tokenStat",
			"toolCompoundBox": "U3JAba_toolCompoundBox",
			"toolCompoundLegend": "U3JAba_toolCompoundLegend",
			"toolCompoundTrack": "U3JAba_toolCompoundTrack",
			"toolDrillSection": "U3JAba_toolDrillSection",
			"toolGridCards": "U3JAba_toolGridCards",
			"toolMiniCard": "U3JAba_toolMiniCard",
			"toolMiniDesc": "U3JAba_toolMiniDesc",
			"toolMiniNum": "U3JAba_toolMiniNum",
			"toolMiniTitle": "U3JAba_toolMiniTitle",
			"toolSliceBash": "U3JAba_toolSliceBash",
			"toolSliceFile": "U3JAba_toolSliceFile",
			"toolTopList": "U3JAba_toolTopList",
			"toolTopListTitle": "U3JAba_toolTopListTitle",
			"vizHead": "U3JAba_vizHead",
			"vizPanel": "U3JAba_vizPanel",
			"vizSplitGrid": "U3JAba_vizSplitGrid",
			"vizSub": "U3JAba_vizSub",
			"vizTitle": "U3JAba_vizTitle"
		};
		//#endregion
		//#region \0dsh-css:src/client/TimingPanel.module.css.mjs
		const css = ".QeXL-G_panelBox{--c-ttft:#94a3b8;--c-think:#3b82f6;--c-output:#38bdf8;--c-bash:#059669;--c-file:#34d399;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:8px;width:100%;padding:12px 14px;position:relative}body[data-ds-dark-theme] .QeXL-G_panelBox{--c-ttft:#64748b;--c-think:#60a5fa;--c-output:#38bdf8;--c-bash:#10b981;--c-file:#6ee7b7}.QeXL-G_topRow{white-space:nowrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;font-size:11px;display:flex}.QeXL-G_titleArea{white-space:nowrap;flex-wrap:nowrap;align-items:center;gap:8px;min-width:0;display:flex}.QeXL-G_mainTitle{color:var(--dsw-alias-label-primary,#17181c);white-space:nowrap;font-size:12px;font-weight:700}.QeXL-G_liveSpeed{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);color:var(--dsw-alias-label-primary,#17181c);font-variant-numeric:tabular-nums;white-space:nowrap;border-radius:4px;align-items:center;gap:4px;padding:1px 6px;font-size:10px;font-weight:600;display:inline-flex}.QeXL-G_speedDot{background:var(--c-output);border-radius:50%;width:5px;height:5px;animation:1.5s infinite QeXL-G_pulse}.QeXL-G_totalDuration{color:var(--dsw-alias-label-secondary,#5f636d);font-variant-numeric:tabular-nums;white-space:nowrap}.QeXL-G_bottleneckText{color:var(--dsw-alias-label-primary,#17181c);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0;font-size:11px;font-weight:600}.QeXL-G_chartBox{width:100%;margin-bottom:8px;position:relative}.QeXL-G_barTrack{background:var(--dsw-alias-bg-layer-1,#e2e8f0);cursor:crosshair;border-radius:5px;gap:1px;width:100%;height:20px;display:flex;overflow:hidden;box-shadow:inset 0 1px 2px #0000000a}.QeXL-G_modelCluster,.QeXL-G_toolCluster{height:100%;transition:opacity .12s;display:flex;position:relative}.QeXL-G_slice{cursor:pointer;height:100%;transition:all .12s;position:relative}.QeXL-G_slice:hover{filter:brightness(1.15);z-index:5;box-shadow:0 0 6px #0003}.QeXL-G_slice+.QeXL-G_slice{border-left:1px solid #ffffff59}.QeXL-G_sliceTtft{background:var(--c-ttft)}.QeXL-G_sliceThink{background:var(--c-think)}.QeXL-G_sliceOutput{background:var(--c-output)}.QeXL-G_sliceBash{background:var(--c-bash)}.QeXL-G_sliceFile{background:var(--c-file)}.QeXL-G_legendRow{color:var(--dsw-alias-label-secondary,#5f636d);white-space:nowrap;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:8px;font-size:11px;display:flex}.QeXL-G_legendGroup{white-space:nowrap;flex-wrap:nowrap;align-items:center;gap:12px;display:flex}.QeXL-G_legendItem{cursor:pointer;white-space:nowrap;align-items:center;gap:4px;transition:opacity .12s;display:flex}.QeXL-G_legendItem:hover{opacity:.75}.QeXL-G_dot{border-radius:2px;flex-shrink:0;width:7px;height:7px}.QeXL-G_statusPill{white-space:nowrap;border-radius:4px;flex-shrink:0;align-items:center;gap:4px;padding:1px 7px;font-size:10px;font-weight:600;display:inline-flex}.QeXL-G_statusOk{color:var(--dsw-static-green-500,#15803d)}.QeXL-G_statusWarn{color:#b45309;background:#f59e0b1f}.QeXL-G_statusDanger{color:#b91c1c;background:#ef44441f}.QeXL-G_popover{color:#f8fafc;pointer-events:none;z-index:50;box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;background:#0f172a;border-radius:8px;width:360px;max-width:calc(100% - 16px);padding:10px 14px;font-size:11px;animation:.12s ease-out QeXL-G_popIn;position:absolute;top:auto;bottom:calc(100% + 8px);box-shadow:0 8px 24px #00000059}.QeXL-G_popover:after{content:\"\";bottom:-5px;left:var(--arrow-left,50%);border:5px solid #0000;border-top-color:#0f172a;border-bottom-width:0;position:absolute;transform:translate(-50%)}.QeXL-G_popTitle{border-bottom:1px solid #ffffff26;justify-content:space-between;align-items:center;gap:16px;margin-bottom:6px;padding-bottom:5px;font-weight:600;display:flex}.QeXL-G_popTitle span{min-width:0}.QeXL-G_popList{flex-direction:column;gap:3px;display:flex}.QeXL-G_popRow{justify-content:space-between;align-items:center;gap:16px;padding:2px 0;display:flex}.QeXL-G_popLeft{color:#ffffffd9;flex-shrink:1;align-items:center;gap:6px;min-width:0;display:flex}.QeXL-G_popRight{font-variant-numeric:tabular-nums;color:#fff;white-space:nowrap;text-align:right;flex-shrink:0;font-weight:600}@media (width<=520px){.QeXL-G_popRow{flex-wrap:wrap;gap:2px 8px}.QeXL-G_popRight{text-align:left}}.QeXL-G_activeVal{color:#fbbf24;font-weight:700}@keyframes QeXL-G_pulse{0%,to{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}@keyframes QeXL-G_popIn{0%{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}";
		const tagId = "dsh-watcher/TimingPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-watcher";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var TimingPanel_module_css_default = {
			"activeVal": "QeXL-G_activeVal",
			"barTrack": "QeXL-G_barTrack",
			"bottleneckText": "QeXL-G_bottleneckText",
			"chartBox": "QeXL-G_chartBox",
			"dot": "QeXL-G_dot",
			"legendGroup": "QeXL-G_legendGroup",
			"legendItem": "QeXL-G_legendItem",
			"legendRow": "QeXL-G_legendRow",
			"liveSpeed": "QeXL-G_liveSpeed",
			"mainTitle": "QeXL-G_mainTitle",
			"modelCluster": "QeXL-G_modelCluster",
			"panelBox": "QeXL-G_panelBox",
			"popIn": "QeXL-G_popIn",
			"popLeft": "QeXL-G_popLeft",
			"popList": "QeXL-G_popList",
			"popRight": "QeXL-G_popRight",
			"popRow": "QeXL-G_popRow",
			"popTitle": "QeXL-G_popTitle",
			"popover": "QeXL-G_popover",
			"pulse": "QeXL-G_pulse",
			"slice": "QeXL-G_slice",
			"sliceBash": "QeXL-G_sliceBash",
			"sliceFile": "QeXL-G_sliceFile",
			"sliceOutput": "QeXL-G_sliceOutput",
			"sliceThink": "QeXL-G_sliceThink",
			"sliceTtft": "QeXL-G_sliceTtft",
			"speedDot": "QeXL-G_speedDot",
			"statusDanger": "QeXL-G_statusDanger",
			"statusOk": "QeXL-G_statusOk",
			"statusPill": "QeXL-G_statusPill",
			"statusWarn": "QeXL-G_statusWarn",
			"titleArea": "QeXL-G_titleArea",
			"toolCluster": "QeXL-G_toolCluster",
			"topRow": "QeXL-G_topRow",
			"totalDuration": "QeXL-G_totalDuration"
		};
		//#endregion
		//#region lib/types/client/TimingPanel.js
		const duration = (ms) => {
			if (ms < 1e3) return `${Math.round(ms)} ms`;
			if (ms < 6e4) return `${(ms / 1e3).toFixed(1)} 秒`;
			const seconds = Math.round(ms / 1e3);
			return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
		};
		const fmtNum = (n) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(n);
		function TimingPanel({ stats, scope, tokensPerSecond }) {
			const [hoverSlice, setHoverSlice] = (0, react.useState)(null);
			const [popoverLeft, setPopoverLeft] = (0, react.useState)(0);
			const [arrowLeft, setArrowLeft] = (0, react.useState)(120);
			const chartBoxRef = (0, react.useRef)(null);
			const ttftMs = stats.firstMs ?? 0;
			const thinkMs = stats.reasoningMs ?? 0;
			const modelTotalMs = stats.modelMs ?? 0;
			const outputMs = Math.max(0, modelTotalMs - ttftMs - thinkMs);
			const toolTotalMs = stats.toolMs ?? 0;
			const bashMs = stats.bashMs ?? 0;
			const fileMs = Math.max(0, toolTotalMs - bashMs);
			const combinedMs = modelTotalMs + toolTotalMs;
			const modelPct = combinedMs > 0 ? modelTotalMs / combinedMs * 100 : 50;
			const toolPct = combinedMs > 0 ? toolTotalMs / combinedMs * 100 : 50;
			const ttftSubPct = modelTotalMs > 0 ? Math.min(100, Math.round(ttftMs / modelTotalMs * 100)) : 0;
			const thinkSubPct = modelTotalMs > 0 ? Math.min(100 - ttftSubPct, Math.round(thinkMs / modelTotalMs * 100)) : 0;
			const outputSubPct = modelTotalMs > 0 ? Math.max(0, 100 - ttftSubPct - thinkSubPct) : 0;
			const bashSubPct = toolTotalMs > 0 ? Math.min(100, Math.round(bashMs / toolTotalMs * 100)) : toolTotalMs > 0 ? 100 : 0;
			const fileSubPct = toolTotalMs > 0 ? Math.max(0, 100 - bashSubPct) : 0;
			const totalGenTokens = (stats.output ?? 0) + (stats.reasoning ?? 0);
			const thinkTokenRatio = totalGenTokens > 0 ? Math.round((stats.reasoning ?? 0) / totalGenTokens * 100) : 0;
			const outputTokenRatio = totalGenTokens > 0 ? Math.max(0, 100 - thinkTokenRatio) : 0;
			const samples = stats.firstSamples ?? 0;
			const ttftAvg = samples > 0 ? ttftMs / samples : ttftMs;
			const ttftLabel = samples > 1 ? `平均首响应 ${duration(ttftAvg)} (共 ${samples} 次)` : `首响应 ${duration(ttftMs)}`;
			let bottleneck = "运行正常";
			if (combinedMs > 0) if (bashMs > combinedMs * .4 && bashMs > 1e4) bottleneck = `终端命令占 ${Math.round(bashMs / combinedMs * 100)}%`;
			else if (thinkMs > combinedMs * .4 && thinkMs > 1e4) bottleneck = `深度思考占 ${Math.round(thinkMs / combinedMs * 100)}%`;
			else if (ttftMs > combinedMs * .4 && ttftMs > 8e3) bottleneck = `云端排队占 ${Math.round(ttftMs / combinedMs * 100)}%`;
			else if (modelTotalMs > toolTotalMs) bottleneck = `模型处理占 ${Math.round(modelPct)}%`;
			else bottleneck = `工具执行占 ${Math.round(toolPct)}%`;
			const hasError = (stats.toolErrors ?? 0) > 0;
			const hasRetry = (stats.retries ?? 0) > 0;
			let statusText = "✓ 0 报错 · 0 重试 (稳定)";
			let statusClass = TimingPanel_module_css_default.statusOk;
			if (hasError && hasRetry) {
				statusText = `! ${stats.toolErrors} 报错 · ${stats.retries} 次重试`;
				statusClass = TimingPanel_module_css_default.statusDanger;
			} else if (hasError) {
				statusText = `! ${stats.toolErrors} 次工具报错`;
				statusClass = TimingPanel_module_css_default.statusDanger;
			} else if (hasRetry) {
				statusText = `! ${stats.retries} 次网络重试排队`;
				statusClass = TimingPanel_module_css_default.statusWarn;
			}
			const handleSliceHover = (slice, e) => {
				setHoverSlice(slice);
				const box = chartBoxRef.current;
				if (box === null) return;
				const rect = e.currentTarget.getBoundingClientRect();
				const parentRect = box.getBoundingClientRect();
				const zoom = box.offsetWidth > 0 && parentRect.width > 0 ? parentRect.width / box.offsetWidth : 1;
				const boxWidth = box.offsetWidth;
				const sliceCenter = (rect.left - parentRect.left + rect.width / 2) / zoom;
				const popoverWidth = Math.min(360, Math.max(0, boxWidth - 16));
				const maxLeft = Math.max(8, boxWidth - popoverWidth - 8);
				const left = Math.max(8, Math.min(maxLeft, sliceCenter - popoverWidth / 2));
				setPopoverLeft(left);
				setArrowLeft(Math.max(16, Math.min(Math.max(16, popoverWidth - 16), sliceCenter - left)));
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: TimingPanel_module_css_default.panelBox,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: TimingPanel_module_css_default.topRow,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: TimingPanel_module_css_default.titleArea,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: TimingPanel_module_css_default.mainTitle,
									children: "耗时分布与瓶颈"
								}),
								tokensPerSecond && tokensPerSecond > 0 ? (0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.liveSpeed,
									title: "当前模型实际流式生成吞吐",
									children: [(0, react_jsx_runtime.jsx)("i", { className: TimingPanel_module_css_default.speedDot }), (0, react_jsx_runtime.jsxs)("span", { children: [tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1), " t/s"] })]
								}) : null,
								(0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.totalDuration,
									children: [
										scope === "turn" ? "本轮" : "全会话",
										" 耗时 ",
										duration(combinedMs)
									]
								})
							]
						}), (0, react_jsx_runtime.jsx)("div", {
							className: TimingPanel_module_css_default.bottleneckText,
							children: combinedMs > 0 ? `主要耗时：${bottleneck}` : "暂无耗时记录"
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: TimingPanel_module_css_default.chartBox,
						ref: chartBoxRef,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: TimingPanel_module_css_default.barTrack,
							role: "img",
							"aria-label": "耗时复合柱图",
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: TimingPanel_module_css_default.modelCluster,
								style: { width: `${modelPct}%` },
								children: [
									ttftSubPct > 0 ? (0, react_jsx_runtime.jsx)("div", {
										className: `${TimingPanel_module_css_default.slice} ${TimingPanel_module_css_default.sliceTtft}`,
										style: { width: `${ttftSubPct}%` },
										onMouseEnter: (e) => handleSliceHover("ttft", e),
										onMouseLeave: () => setHoverSlice(null)
									}) : null,
									thinkSubPct > 0 ? (0, react_jsx_runtime.jsx)("div", {
										className: `${TimingPanel_module_css_default.slice} ${TimingPanel_module_css_default.sliceThink}`,
										style: { width: `${thinkSubPct}%` },
										onMouseEnter: (e) => handleSliceHover("think", e),
										onMouseLeave: () => setHoverSlice(null)
									}) : null,
									outputSubPct > 0 ? (0, react_jsx_runtime.jsx)("div", {
										className: `${TimingPanel_module_css_default.slice} ${TimingPanel_module_css_default.sliceOutput}`,
										style: { width: `${outputSubPct}%` },
										onMouseEnter: (e) => handleSliceHover("output", e),
										onMouseLeave: () => setHoverSlice(null)
									}) : null
								]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: TimingPanel_module_css_default.toolCluster,
								style: { width: `${toolPct}%` },
								children: [bashSubPct > 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: `${TimingPanel_module_css_default.slice} ${TimingPanel_module_css_default.sliceBash}`,
									style: { width: `${bashSubPct}%` },
									onMouseEnter: (e) => handleSliceHover("bash", e),
									onMouseLeave: () => setHoverSlice(null)
								}) : null, fileSubPct > 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: `${TimingPanel_module_css_default.slice} ${TimingPanel_module_css_default.sliceFile}`,
									style: { width: `${fileSubPct}%` },
									onMouseEnter: (e) => handleSliceHover("file", e),
									onMouseLeave: () => setHoverSlice(null)
								}) : null]
							})]
						}), hoverSlice ? (0, react_jsx_runtime.jsxs)("div", {
							className: TimingPanel_module_css_default.popover,
							style: {
								left: `${popoverLeft}px`,
								["--arrow-left"]: `${arrowLeft}px`
							},
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: TimingPanel_module_css_default.popTitle,
								children: [(0, react_jsx_runtime.jsxs)("span", { children: [
									hoverSlice === "think" && "深度推导阶段 (思考过程)",
									hoverSlice === "ttft" && "首字排队响应 (TTFT)",
									hoverSlice === "output" && "正文流式输出阶段",
									hoverSlice === "bash" && "本地终端命令 (Bash)",
									hoverSlice === "file" && "文件读写与其它工具"
								] }), (0, react_jsx_runtime.jsxs)("span", { children: [
									hoverSlice === "think" && `${duration(thinkMs)} (${thinkSubPct}%)`,
									hoverSlice === "ttft" && `${duration(ttftMs)} (${ttftSubPct}%)`,
									hoverSlice === "output" && `${duration(outputMs)} (${outputSubPct}%)`,
									hoverSlice === "bash" && `${duration(bashMs)} (${bashSubPct}%)`,
									hoverSlice === "file" && `${duration(fileMs)} (${fileSubPct}%)`
								] })]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: TimingPanel_module_css_default.popList,
								children: [
									hoverSlice === "think" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: TimingPanel_module_css_default.dot,
													style: { background: "var(--c-think)" }
												}), (0, react_jsx_runtime.jsx)("span", { children: "推导思考总耗时" })]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													duration(thinkMs),
													" (占模型 ",
													thinkSubPct,
													"%)"
												]
											})]
										}),
										stats.reasoning ? (0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "思考 Token 用量" })
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [fmtNum(stats.reasoning), " Token"]
											})]
										}) : null,
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "生成算力分配" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: totalGenTokens > 0 ? `思考占 ${thinkTokenRatio}% · 正文占 ${outputTokenRatio}%` : "—"
											})]
										}),
										thinkMs > 0 && stats.reasoning ? (0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "推导生成速率" })
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [Math.round(stats.reasoning / (thinkMs / 1e3)), " Token/秒"]
											})]
										}) : null,
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											style: {
												borderTop: "1px dashed rgba(255,255,255,0.15)",
												marginTop: "4px",
												paddingTop: "4px"
											},
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "思考耗时诊断" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: thinkMs > 25e3 ? "推导耗时较长，任务较复杂" : "推导节奏健康，无卡顿停顿"
											})]
										})
									] }),
									hoverSlice === "ttft" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: TimingPanel_module_css_default.dot,
													style: { background: "var(--c-ttft)" }
												}), (0, react_jsx_runtime.jsx)("span", { children: "首响应排队延迟" })]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													duration(ttftMs),
													" (占模型 ",
													ttftSubPct,
													"%)"
												]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "采样统计详情" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: samples > 1 ? `累计 ${samples} 次 (均值 ${(ttftAvg / 1e3).toFixed(2)}s)` : "单次握手"
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											style: {
												borderTop: "1px dashed rgba(255,255,255,0.15)",
												marginTop: "4px",
												paddingTop: "4px"
											},
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "网络排队诊断" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: ttftAvg < 1e3 ? "极度敏捷 (网络与云端极速响应)" : ttftAvg < 3e3 ? "正常 (标准网络往返与握手)" : "排队偏长 (云端并发高或网络延迟)"
											})]
										})
									] }),
									hoverSlice === "output" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: TimingPanel_module_css_default.dot,
													style: { background: "var(--c-output)" }
												}), (0, react_jsx_runtime.jsx)("span", { children: "正文与代码耗时" })]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													duration(outputMs),
													" (占模型 ",
													outputSubPct,
													"%)"
												]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "实付正文输出量" })
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [fmtNum(stats.output), " Token"]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "实际生成速率" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: tokensPerSecond && tokensPerSecond > 0 ? `${tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1)} Token/秒 (实时)` : outputMs > 0 ? `${Math.round(stats.output / (outputMs / 1e3))} Token/秒 (均值)` : "—"
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											style: {
												borderTop: "1px dashed rgba(255,255,255,0.15)",
												marginTop: "4px",
												paddingTop: "4px"
											},
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "生成算力分配" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: totalGenTokens > 0 ? `正文占 ${outputTokenRatio}% · 思考占 ${thinkTokenRatio}%` : "—"
											})]
										})
									] }),
									hoverSlice === "bash" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: TimingPanel_module_css_default.dot,
													style: { background: "var(--c-bash)" }
												}), (0, react_jsx_runtime.jsx)("span", { children: "终端 Bash 总耗时" })]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													duration(bashMs),
													" (占工具 ",
													bashSubPct,
													"%)"
												]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "占轮次总时间比" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: combinedMs > 0 ? `${Math.round(bashMs / combinedMs * 100)}%` : "0%"
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "命令可靠度监控" })
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													stats.tools,
													" 次 (",
													stats.toolErrors > 0 ? `${stats.toolErrors} 次报错中断` : "零非零退出码",
													")"
												]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											style: {
												borderTop: "1px dashed rgba(255,255,255,0.15)",
												marginTop: "4px",
												paddingTop: "4px"
											},
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "耗时瓶颈归因" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: bashMs > modelTotalMs ? "本地环境为主要瓶颈 (耗时超模型)" : "本地开销极小 (主要耗时在云端)"
											})]
										})
									] }),
									hoverSlice === "file" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: TimingPanel_module_css_default.dot,
													style: { background: "var(--c-file)" }
												}), (0, react_jsx_runtime.jsx)("span", { children: "文件读写总耗时" })]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [
													duration(fileMs),
													" (占工具 ",
													fileSubPct,
													"%)"
												]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "占轮次总时间比" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: combinedMs > 0 ? `${Math.round(fileMs / combinedMs * 100)}%` : "0%"
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "单次调用平均耗时" })
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: [Math.round(fileMs / Math.max(1, stats.tools)), " ms / 次"]
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: TimingPanel_module_css_default.popRow,
											style: {
												borderTop: "1px dashed rgba(255,255,255,0.15)",
												marginTop: "4px",
												paddingTop: "4px"
											},
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: TimingPanel_module_css_default.popLeft,
												children: (0, react_jsx_runtime.jsx)("span", { children: "文件 IO 评价" })
											}), (0, react_jsx_runtime.jsx)("span", {
												className: TimingPanel_module_css_default.popRight,
												children: fileMs < 2e3 ? "毫秒级极速读写，无性能损耗" : "读写较为密集，轻微耗时累积"
											})]
										})
									] })
								]
							})]
						}) : null]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: TimingPanel_module_css_default.legendRow,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: TimingPanel_module_css_default.legendGroup,
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.legendItem,
									children: [(0, react_jsx_runtime.jsx)("i", {
										className: TimingPanel_module_css_default.dot,
										style: { background: "var(--c-ttft)" }
									}), (0, react_jsx_runtime.jsx)("span", { children: ttftLabel })]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.legendItem,
									children: [(0, react_jsx_runtime.jsx)("i", {
										className: TimingPanel_module_css_default.dot,
										style: { background: "var(--c-think)" }
									}), (0, react_jsx_runtime.jsxs)("span", { children: ["思考 ", duration(thinkMs)] })]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.legendItem,
									children: [(0, react_jsx_runtime.jsx)("i", {
										className: TimingPanel_module_css_default.dot,
										style: { background: "var(--c-output)" }
									}), (0, react_jsx_runtime.jsxs)("span", { children: ["输出 ", duration(outputMs)] })]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: TimingPanel_module_css_default.legendItem,
									children: [(0, react_jsx_runtime.jsx)("i", {
										className: TimingPanel_module_css_default.dot,
										style: { background: "var(--c-bash)" }
									}), (0, react_jsx_runtime.jsxs)("span", { children: ["工具 ", duration(toolTotalMs)] })]
								})
							]
						}), (0, react_jsx_runtime.jsx)("div", {
							className: `${TimingPanel_module_css_default.statusPill} ${statusClass}`,
							children: statusText
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/Insights.js
		const STORAGE = "dsh-watcher:insights-display:v1";
		function readLimits() {
			try {
				return limitsOf(JSON.parse(localStorage.getItem(STORAGE) ?? "{}"));
			} catch {
				return { ...DEFAULT_LIMITS };
			}
		}
		function useLimits() {
			const [limits, setLimits] = (0, react.useState)(readLimits);
			(0, react.useEffect)(() => {
				const update = () => setLimits(readLimits());
				window.addEventListener("watcher-insights-settings", update);
				return () => window.removeEventListener("watcher-insights-settings", update);
			}, []);
			return limits;
		}
		const fmt = (n) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(n);
		const fmtCompact = (n) => {
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
			if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
			return fmt(n);
		};
		const dayKey = (ms) => {
			const d = new Date(ms);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		};
		const dayLabel = (key) => {
			const [, m, d] = key.split("-");
			return `${Number(m)}/${Number(d)}`;
		};
		const PALETTE = [
			"#3b82f6",
			"#8b5cf6",
			"#f59e0b",
			"#10b981",
			"#ec4899",
			"#6366f1"
		];
		function effortLabel(effort) {
			if (!effort) return "";
			return {
				high: "高",
				medium: "中",
				low: "低"
			}[effort.toLowerCase()] ?? effort;
		}
		function SessionInsights({ value, now, running, waiting, onEvidence }) {
			const limits = useLimits();
			const [scope, setScope] = (0, react.useState)("turn");
			const [modelFilter, setModelFilter] = (0, react.useState)("all");
			if (!value) return null;
			const isMultiModel = (value.models?.length ?? 0) > 1;
			const selectedModel = scope === "session" && modelFilter !== "all" && value.models[modelFilter] ? value.models[modelFilter] : void 0;
			const stats = scope === "turn" && value.turn ? value.turn.stats : selectedModel ?? value.totals;
			const alerts = alertsOf(value, now, {
				running,
				waiting,
				limits
			});
			const currentRoute = value.turn?.route ?? (value.models && value.models.length > 0 ? value.models[0] : void 0);
			const totalIn = (stats.input ?? 0) + (stats.cacheRead ?? 0);
			const cachePct = totalIn > 0 ? Math.round((stats.cacheRead ?? 0) / totalIn * 100) : 0;
			return (0, react_jsx_runtime.jsxs)("section", {
				className: Insights_module_css_default.hudBox,
				"aria-label": "耗时分布与运行健康度",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.hudTop,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.hudTopLeft,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: Insights_module_css_default.hudHeading,
									children: scope === "turn" ? "本轮" : selectedModel ? `模型: ${selectedModel.model}` : "全会话"
								}),
								scope === "turn" && currentRoute?.model ? (0, react_jsx_runtime.jsxs)("span", {
									className: Insights_module_css_default.currentModelTag,
									title: currentRoute.model,
									children: [(0, react_jsx_runtime.jsx)("strong", {
										className: Insights_module_css_default.modelTagText,
										children: currentRoute.model
									}), currentRoute.effort ? (0, react_jsx_runtime.jsxs)("span", {
										className: Insights_module_css_default.effortTag,
										children: ["思考: ", effortLabel(currentRoute.effort)]
									}) : null]
								}) : null,
								(0, react_jsx_runtime.jsxs)("span", {
									className: Insights_module_css_default.contextTag,
									children: [
										"上下文 ",
										(0, react_jsx_runtime.jsx)("strong", { children: fmt(stats.input ?? 0) }),
										" Token"
									]
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.hudTopRight,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: Insights_module_css_default.tokenStat,
								children: [
									(0, react_jsx_runtime.jsx)("strong", { children: fmt(stats.tokens ?? 0) }),
									" Token (",
									cachePct,
									"% 命中)"
								]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.scopeGroup,
								role: "group",
								"aria-label": "统计范围切换",
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.scopeBtn,
									"data-active": scope === "turn" ? "" : void 0,
									onClick: () => {
										setScope("turn");
										setModelFilter("all");
									},
									children: "本轮"
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.scopeBtn,
									"data-active": scope === "session" ? "" : void 0,
									onClick: () => setScope("session"),
									children: "全会话"
								})]
							})]
						})]
					}),
					scope === "session" && isMultiModel ? (0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.modelTabBar,
						role: "tablist",
						"aria-label": "多模型切换",
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: Insights_module_css_default.modelTabBtn,
							"data-active": modelFilter === "all" ? "" : void 0,
							onClick: () => setModelFilter("all"),
							children: [
								"全部模型汇总 (",
								value.models.length,
								")"
							]
						}), value.models.map((m, idx) => (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: Insights_module_css_default.modelTabBtn,
							"data-active": modelFilter === idx ? "" : void 0,
							onClick: () => setModelFilter(idx),
							children: [
								m.model,
								" (",
								m.calls,
								"次)"
							]
						}, idx))]
					}) : null,
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.hudBody,
						children: [(0, react_jsx_runtime.jsx)(TimingPanel, {
							stats,
							scope
						}), alerts.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
							className: Insights_module_css_default.alertSection,
							"aria-live": "polite",
							children: alerts.map((a) => {
								const isRepeat = a.kind === "repeated-failure" || a.id.startsWith("repeat");
								const isSilence = a.id === "silence";
								const isReason = a.id === "reasoning-span";
								const tag = isRepeat ? "连续报错" : isSilence ? "网络停顿" : isReason ? "思考超时" : "异常";
								return (0, react_jsx_runtime.jsxs)("div", {
									className: `${Insights_module_css_default.alertCard} ${isRepeat ? Insights_module_css_default.alertCardDanger : Insights_module_css_default.alertCardWarn}`,
									children: [(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.alertLeft,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: `${Insights_module_css_default.alertTag} ${isRepeat ? Insights_module_css_default.tagDanger : Insights_module_css_default.tagWarn}`,
											children: tag
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.alertTexts,
											children: [(0, react_jsx_runtime.jsx)("strong", {
												className: Insights_module_css_default.alertMainText,
												children: a.title
											}), (0, react_jsx_runtime.jsx)("span", {
												className: Insights_module_css_default.alertSubText,
												children: a.detail
											})]
										})]
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Insights_module_css_default.alertActionBtn,
										onClick: () => onEvidence(a),
										children: "定位现场"
									})]
								}, a.id);
							})
						}) : null]
					})
				]
			});
		}
		function InsightsSettings(props) {
			const limits = useLimits();
			const [silence, setSilence] = (0, react.useState)(limits.silenceSeconds);
			const [reasoning, setReasoning] = (0, react.useState)(limits.reasoningSeconds);
			const [saved, setSaved] = (0, react.useState)(false);
			const [userPickedRange, setUserPickedRange] = (0, react.useState)(false);
			const [range, setRange] = (0, react.useState)("7");
			const [sessionSort, setSessionSort] = (0, react.useState)("tokens");
			const [loading, setLoading] = (0, react.useState)(false);
			const [sessions, setSessions] = (0, react.useState)(null);
			const [openSessionId, setOpenSessionId] = (0, react.useState)(null);
			const [hoveredIdx, setHoveredIdx] = (0, react.useState)(null);
			const [activeDrilldown, setActiveDrilldown] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!props.remote) return;
				let active = true;
				setLoading(true);
				scanSessions(props.remote, { limit: 100 }).then((res) => {
					if (active) {
						setSessions(res);
						if (!userPickedRange) {
							const times = (res?.rows ?? []).map((r) => r.updatedAt).filter((t) => typeof t === "number" && t > 0);
							if (times.length >= 2) {
								if (Math.max(...times) - Math.min(...times) > 7 * 864e5) setRange("30");
							}
						}
					}
				}).catch(console.error).finally(() => {
					if (active) setLoading(false);
				});
				return () => {
					active = false;
				};
			}, [props.remote, userPickedRange]);
			const refresh = () => {
				if (!props.remote || loading) return;
				setLoading(true);
				scanSessions(props.remote, { limit: 100 }).then(setSessions).catch(console.error).finally(() => setLoading(false));
			};
			const save = () => {
				localStorage.setItem(STORAGE, JSON.stringify({
					silenceSeconds: silence,
					reasoningSeconds: reasoning
				}));
				window.dispatchEvent(new CustomEvent("watcher-insights-settings"));
				setSaved(true);
				setTimeout(() => setSaved(false), 2e3);
			};
			const analytics = (0, react.useMemo)(() => {
				if (!sessions) return null;
				const days = Number(range);
				const cutoff = Date.now() - days * 864e5;
				const validRows = sessions.rows.filter((r) => r.value && (!r.updatedAt || r.updatedAt >= cutoff));
				const validViews = validRows.map((r) => r.value);
				let totalTokens = 0;
				let totalModelMs = 0;
				let totalToolMs = 0;
				let totalBashMs = 0;
				let totalTools = 0;
				let totalCacheRead = 0;
				let totalInput = 0;
				let totalErrors = 0;
				let totalRetries = 0;
				validViews.forEach((v) => {
					totalTokens += v.totals.tokens ?? 0;
					totalModelMs += v.totals.modelMs ?? 0;
					totalToolMs += v.totals.toolMs ?? 0;
					totalBashMs += v.totals.bashMs ?? 0;
					totalTools += v.totals.tools ?? 0;
					totalCacheRead += v.totals.cacheRead ?? 0;
					totalInput += v.totals.input ?? 0;
					totalErrors += v.totals.toolErrors ?? 0;
					totalRetries += v.totals.retries ?? 0;
				});
				const totalWallMs = totalModelMs + totalToolMs;
				const toolTimePct = totalWallMs > 0 ? Math.round(totalToolMs / totalWallMs * 100) : 0;
				const totalFileMs = Math.max(0, totalToolMs - totalBashMs);
				const bashPct = totalToolMs > 0 ? Math.round(totalBashMs / totalToolMs * 100) : 0;
				const filePct = Math.max(0, 100 - bashPct);
				const totalInAll = totalInput + totalCacheRead;
				const cacheHitPct = totalInAll > 0 ? Math.round(totalCacheRead / totalInAll * 100) : 0;
				const modelMap = /* @__PURE__ */ new Map();
				for (const view of validViews) for (const m of view.models ?? []) {
					const name = m.model || "未标注";
					let row = modelMap.get(name);
					if (!row) {
						row = {
							model: name,
							calls: 0,
							tokens: 0,
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							reasoning: 0,
							modelMs: 0,
							firstMs: 0,
							firstSamples: 0
						};
						modelMap.set(name, row);
					}
					for (const k of [
						"calls",
						"tokens",
						"input",
						"output",
						"cacheRead",
						"cacheWrite",
						"reasoning",
						"modelMs",
						"firstMs",
						"firstSamples"
					]) if (typeof m[k] === "number" && Number.isFinite(m[k])) row[k] += m[k];
				}
				const uniqueModels = [...modelMap.values()];
				const speedList = uniqueModels.filter((m) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0).sort((a, b) => a.firstMs / a.firstSamples - b.firstMs / b.firstSamples);
				const latencyList = uniqueModels.filter((m) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0).sort((a, b) => b.firstMs / b.firstSamples - a.firstMs / a.firstSamples);
				const thinkList = uniqueModels.filter((m) => (m.reasoning ?? 0) > 0).sort((a, b) => {
					const ratioA = a.reasoning / ((a.reasoning ?? 0) + (a.output ?? 0) || 1);
					return b.reasoning / ((b.reasoning ?? 0) + (b.output ?? 0) || 1) - ratioA || b.reasoning - a.reasoning;
				});
				const cacheList = uniqueModels.filter((m) => (m.tokens ?? 0) > 0).sort((a, b) => {
					const rateA = (a.cacheRead ?? 0) / ((a.input ?? 0) + (a.cacheRead ?? 0) || 1);
					return (b.cacheRead ?? 0) / ((b.input ?? 0) + (b.cacheRead ?? 0) || 1) - rateA || (b.cacheRead ?? 0) - (a.cacheRead ?? 0);
				});
				const fastKing = speedList[0];
				const slowKing = latencyList[0];
				const thinkKing = thinkList[0];
				const bestCacheModel = cacheList[0];
				const topToolSessions = [...validRows].filter((r) => (r.value?.totals?.toolMs ?? 0) > 0).sort((a, b) => (b.value.totals.toolMs ?? 0) - (a.value.totals.toolMs ?? 0)).slice(0, 3);
				const errorSessions = [...validRows].filter((r) => (r.value?.totals?.toolErrors ?? 0) > 0 || (r.value?.totals?.retries ?? 0) > 0).sort((a, b) => {
					const scoreA = (a.value.totals.toolErrors ?? 0) * 100 + (a.value.totals.retries ?? 0);
					return (b.value.totals.toolErrors ?? 0) * 100 + (b.value.totals.retries ?? 0) - scoreA;
				}).slice(0, 6);
				const sortedSessions = [...validRows].sort((a, b) => {
					const va = a.value.totals;
					const vb = b.value.totals;
					if (sessionSort === "tokens") return (vb.tokens ?? 0) - (va.tokens ?? 0);
					if (sessionSort === "time") {
						const timeA = (va.modelMs ?? 0) + (va.toolMs ?? 0);
						return (vb.modelMs ?? 0) + (vb.toolMs ?? 0) - timeA;
					}
					if (sessionSort === "errors") {
						const scoreA = (va.toolErrors ?? 0) * 100 + (va.retries ?? 0);
						return (vb.toolErrors ?? 0) * 100 + (vb.retries ?? 0) - scoreA || (vb.tokens ?? 0) - (va.tokens ?? 0);
					}
					return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
				});
				const maxSessionTokens = Math.max(1, ...sortedSessions.map((s) => s.value?.totals?.tokens ?? 0));
				const tokenRankedModels = [...uniqueModels].sort((a, b) => b.tokens - a.tokens);
				const topModels = tokenRankedModels.slice(0, 4);
				const restTokens = tokenRankedModels.slice(4).reduce((sum, m) => sum + (m.tokens ?? 0), 0);
				const donutModels = [...topModels];
				if (restTokens > 0) donutModels.push({
					model: "其他模型",
					tokens: restTokens
				});
				donutModels.sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
				const donutTotal = donutModels.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
				const colorOf = (name) => {
					const found = donutModels.findIndex((m) => m.model === name);
					return PALETTE[(found >= 0 ? found : 0) % PALETTE.length];
				};
				const circumference = 2 * Math.PI * 38;
				let accumulated = 0;
				const donutSegments = donutTotal <= 0 ? [] : donutModels.map((m, idx) => {
					const pctRatio = m.tokens / donutTotal;
					const strokeLength = idx === donutModels.length - 1 ? Math.max(0, circumference - accumulated) : pctRatio * circumference;
					const gapLength = Math.max(0, circumference - strokeLength);
					const offset = -accumulated;
					accumulated += strokeLength;
					return {
						model: m.model,
						tokens: m.tokens,
						pct: Math.round(pctRatio * 100),
						color: PALETTE[idx % PALETTE.length],
						dasharray: `${strokeLength} ${gapLength}`,
						dashoffset: offset
					};
				});
				const keys = [];
				for (let i = days - 1; i >= 0; i--) keys.push(dayKey(Date.now() - i * 864e5));
				const byDay = new Map(keys.map((k) => [k, /* @__PURE__ */ new Map()]));
				validRows.forEach((row) => {
					const key = row.updatedAt ? dayKey(row.updatedAt) : keys[keys.length - 1];
					const bucket = byDay.get(key);
					if (!bucket) return;
					(row.value.models?.length ? row.value.models : [{
						model: "未标注",
						tokens: row.value.totals.tokens ?? 0
					}]).forEach((m) => {
						bucket.set(m.model, (bucket.get(m.model) ?? 0) + (m.tokens ?? 0));
					});
				});
				const todayStr = dayKey(Date.now());
				const yesterdayStr = dayKey(Date.now() - 864e5);
				const daySeries = keys.map((key) => {
					const segments = [...(byDay.get(key) ?? /* @__PURE__ */ new Map()).entries()].map(([model, tokens]) => ({
						model,
						tokens,
						color: colorOf(model)
					})).sort((a, b) => b.tokens - a.tokens);
					return {
						key,
						label: range === "7" ? key === todayStr ? "今天" : key === yesterdayStr ? "昨天" : dayLabel(key) : key.endsWith("01") || key.endsWith("05") || key.endsWith("10") || key.endsWith("15") || key.endsWith("20") || key.endsWith("25") ? dayLabel(key) : "",
						total: segments.reduce((s, x) => s + x.tokens, 0),
						segments
					};
				});
				const dayMax = Math.max(1, ...daySeries.map((d) => d.total));
				return {
					validCount: validRows.length,
					listed: sessions.total,
					totalTokens,
					totalTimeHours: ((totalModelMs + totalToolMs) / 36e5).toFixed(1),
					cacheHitPct,
					totalCacheRead,
					totalToolMs,
					totalBashMs,
					totalFileMs,
					bashPct,
					filePct,
					topToolSessions,
					errorSessions,
					sortedSessions,
					maxSessionTokens,
					totalTools,
					toolTimePct,
					totalErrors,
					totalRetries,
					speedList,
					latencyList,
					thinkList,
					cacheList,
					donutModels,
					donutTotal,
					donutSegments,
					thinkKing,
					fastKing,
					slowKing,
					bestCacheModel,
					daySeries,
					dayMax
				};
			}, [
				sessions,
				range,
				sessionSort
			]);
			const cacheNote = !analytics ? "" : analytics.cacheHitPct >= 70 ? "命中较高" : analytics.cacheHitPct >= 40 ? "一般" : "命中偏低";
			const activeSeg = hoveredIdx !== null && analytics?.donutSegments[hoveredIdx] ? analytics.donutSegments[hoveredIdx] : null;
			const topModel = analytics?.donutSegments[0];
			return (0, react_jsx_runtime.jsxs)("div", {
				className: Insights_module_css_default.settingsContainer,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.cockpitHeader,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.cockpitTitleArea,
							children: [(0, react_jsx_runtime.jsx)("h2", {
								className: Insights_module_css_default.cockpitMainTitle,
								children: "对话开销与模型风云榜"
							}), (0, react_jsx_runtime.jsx)("p", {
								className: Insights_module_css_default.cockpitSubTitle,
								children: "只读汇总本地已缓存的对话。按活动日期归组，无额外后台开销。"
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.headerRightControls,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.rangeSwitchGroup,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.rangeBtn,
									"data-active": range === "7" ? "" : void 0,
									onClick: () => {
										setUserPickedRange(true);
										setRange("7");
									},
									children: "近 7 天"
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.rangeBtn,
									"data-active": range === "30" ? "" : void 0,
									onClick: () => {
										setUserPickedRange(true);
										setRange("30");
									},
									children: "近 30 天"
								})]
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Insights_module_css_default.settingsScanBtn,
								onClick: refresh,
								disabled: loading || !props.remote,
								children: loading ? "正在刷新" : "刷新"
							})]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.heroStatsRow,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.heroBigNum,
							children: [
								analytics ? fmtCompact(analytics.totalTokens) : "-",
								" ",
								(0, react_jsx_runtime.jsx)("span", {
									className: Insights_module_css_default.heroUnit,
									children: "Token"
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.heroMetaCol,
							children: [
								(0, react_jsx_runtime.jsxs)("span", { children: ["累计耗时 ", (0, react_jsx_runtime.jsx)("strong", { children: analytics ? `${analytics.totalTimeHours} 小时` : "-" })] }),
								(0, react_jsx_runtime.jsxs)("span", { children: ["缓存命中 ", (0, react_jsx_runtime.jsx)("strong", { children: analytics ? `${analytics.cacheHitPct}% (${cacheNote})` : "-" })] }),
								(0, react_jsx_runtime.jsxs)("span", { children: ["有统计的对话 ", (0, react_jsx_runtime.jsx)("strong", { children: analytics ? `${analytics.validCount} / ${analytics.listed}` : "-" })] })
							]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.roastGrid,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "speed" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "speed" ? null : "speed"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: "#10b981" },
											children: "极致打字机"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "速度王者"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										title: analytics?.fastKing?.model,
										children: analytics?.fastKing?.model ?? "暂无数据"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: "首字响应最迅速，轻量改错利器",
										children: "首字响应最迅速，轻量改错利器"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: "#10b981" },
										children: analytics?.fastKing?.firstSamples ? `首字均值 ${(analytics.fastKing.firstMs / analytics.fastKing.firstSamples / 1e3).toFixed(2)} 秒` : "暂无数据"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "首响应耗时"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "speed" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "latency" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "latency" ? null : "latency"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: "#d97706" },
											children: "最慢树懒"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "延迟瓶颈"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										title: analytics?.slowKing?.model,
										children: analytics?.slowKing?.model ?? "暂无数据"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: "首字排队最久，点根烟等它开工",
										children: "首字排队最久，点根烟等它开工"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: "#d97706" },
										children: analytics?.slowKing?.firstSamples ? `首字均值 ${(analytics.slowKing.firstMs / analytics.slowKing.firstSamples / 1e3).toFixed(2)} 秒` : "暂无数据"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "排队瓶颈"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "latency" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "thinking" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "thinking" ? null : "thinking"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: "#8b5cf6" },
											children: "深度沉思狂"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "推理硬核"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										title: analytics?.thinkKing?.model,
										children: analytics?.thinkKing?.model ?? "暂无思考记录"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: "思考 Token 占自身输出比例最高",
										children: "思考 Token 占自身输出比例最高"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: "#8b5cf6" },
										children: analytics?.thinkKing ? `思考占比 ${Math.round((analytics.thinkKing.reasoning ?? 0) / ((analytics.thinkKing.reasoning ?? 0) + (analytics.thinkKing.output ?? 0) || 1) * 100)}%` : "无推理记录"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "推导占比"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "thinking" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "cache" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "cache" ? null : "cache"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: (analytics?.cacheHitPct ?? 0) >= 40 ? "#10b981" : "#f59e0b" },
											children: (analytics?.cacheHitPct ?? 0) >= 40 ? "省流小能手" : "缓存待提升"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "成本控制"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										title: analytics?.bestCacheModel?.model,
										children: (analytics?.cacheHitPct ?? 0) >= 40 ? analytics?.bestCacheModel?.model ?? "上下文复用" : "上下文重传较多"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: (analytics?.cacheHitPct ?? 0) >= 40 ? "前缀缓存命中率高，大幅节约 Token" : "较多长文本全量重传，可利用前缀缓存",
										children: (analytics?.cacheHitPct ?? 0) >= 40 ? "前缀缓存命中率高，大幅节约 Token" : "较多长文本全量重传，可利用前缀缓存"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: (analytics?.cacheHitPct ?? 0) >= 40 ? "#10b981" : "#f59e0b" },
										children: analytics ? `命中 ${analytics.cacheHitPct}% (${fmtCompact(analytics.totalCacheRead)} Token)` : "-"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "缓存效率"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "cache" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "tool" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "tool" ? null : "tool"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: (analytics?.toolTimePct ?? 0) >= 30 ? "#f59e0b" : "#3b82f6" },
											children: (analytics?.toolTimePct ?? 0) >= 30 ? "终端耗时狂" : "秒级放行"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "工程归因"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										children: (analytics?.toolTimePct ?? 0) >= 30 ? `本地命令占 ${analytics?.toolTimePct}% 耗时` : `本地损耗仅 ${analytics?.toolTimePct ?? 0}%`
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: (analytics?.toolTimePct ?? 0) >= 30 ? "很多时候不是模型卡，是本地脚本跑太久" : "本地工具极速执行，等待时间主要在云端",
										children: (analytics?.toolTimePct ?? 0) >= 30 ? "很多时候不是模型卡，是本地脚本跑太久" : "本地工具极速执行，等待时间主要在云端"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: (analytics?.toolTimePct ?? 0) >= 30 ? "#f59e0b" : "#3b82f6" },
										children: analytics ? `工具耗时 ${Math.round(analytics.totalToolMs / 1e3)} 秒 (${analytics.totalTools} 次)` : "-"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "本地耗时"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "tool" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: `${Insights_module_css_default.roastItem} ${activeDrilldown === "reliability" ? Insights_module_css_default.roastItemActive : ""}`,
								onClick: () => setActiveDrilldown(activeDrilldown === "reliability" ? null : "reliability"),
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastHead,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastTag,
											style: { color: (analytics?.totalErrors ?? 0) > 0 ? "#ef4444" : "#10b981" },
											children: (analytics?.totalErrors ?? 0) > 0 ? "翻车排查" : "运行可靠度"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastCategoryBadge,
											children: "稳定性"
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastTitle,
										title: (analytics?.totalErrors ?? 0) > 0 ? "存在工具报错" : "执行顺畅",
										children: (analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次工具报错` : "100% 顺畅"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastDesc,
										title: (analytics?.totalErrors ?? 0) > 0 ? "命令执行或参数错误，注意环境排查" : "未发生命令报错或异常，执行稳健",
										children: (analytics?.totalErrors ?? 0) > 0 ? "命令执行或参数错误，注意环境排查" : "未发生命令报错或异常，执行稳健"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.roastVal,
										style: { color: (analytics?.totalErrors ?? 0) > 0 ? "#ef4444" : "#10b981" },
										children: (analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次报错 · ${analytics?.totalRetries} 次重试` : "0 报错 · 0 重试"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.roastFooter,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastFooterLeft,
											children: "异常检测"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.roastAction,
											children: activeDrilldown === "reliability" ? "收起透视 ▴" : "透视详情 ›"
										})]
									})
								]
							})
						]
					}),
					activeDrilldown && analytics ? (0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.drilldownPanel,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.drilldownHead,
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.drilldownTitleGroup,
									children: [(0, react_jsx_runtime.jsxs)("span", {
										className: Insights_module_css_default.drilldownTitle,
										children: [
											activeDrilldown === "speed" && "⚡ 模型首字响应延迟对比 (TTFT)",
											activeDrilldown === "latency" && "🐢 模型首字排队耗时排行榜",
											activeDrilldown === "thinking" && "🧠 深度推导算力分配明细",
											activeDrilldown === "cache" && "💰 前缀缓存命中率排行榜",
											activeDrilldown === "tool" && "⏱️ 本地工具与终端命令耗时全景拆解",
											activeDrilldown === "reliability" && "🛡️ 运行可靠度与报错排查"
										]
									}), (0, react_jsx_runtime.jsxs)("span", {
										className: Insights_module_css_default.drilldownSub,
										children: [
											activeDrilldown === "speed" && "按首响应延迟升序排列（最快在上，首字响应最迅速）",
											activeDrilldown === "latency" && "按排队耗时降序排列（排队最久在上，定位卡顿瓶颈）",
											activeDrilldown === "thinking" && "按思考 Token 占比降序排列（对比自我推导与正文算力比重）",
											activeDrilldown === "cache" && "按前缀缓存命中率降序排列（直接决定上下文成本与省钱效率）",
											activeDrilldown === "tool" && "本地工具耗时全景拆解（按单会话本地执行耗时由大到小降序排查）",
											activeDrilldown === "reliability" && "按报错与重试次数降序排查（优先定位最高频故障会话）"
										]
									})]
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.drilldownCloseBtn,
									onClick: () => setActiveDrilldown(null),
									children: "收起 ✕"
								})]
							}),
							activeDrilldown === "speed" && (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.rankList,
								children: [analytics.speedList.map((m, idx) => {
									const avgMs = m.firstMs / m.firstSamples;
									const minMs = analytics.speedList[0].firstMs / analytics.speedList[0].firstSamples;
									const score = Math.max(10, Math.min(100, Math.round(minMs / avgMs * 100)));
									const color = avgMs < 1e3 ? "#10b981" : avgMs < 3e3 ? "#3b82f6" : "#f59e0b";
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.rankItem,
										children: [
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankItemTop,
												children: [(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.rankItemLeft,
													children: [(0, react_jsx_runtime.jsxs)("span", {
														className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
														children: ["#", idx + 1]
													}), (0, react_jsx_runtime.jsx)("span", {
														className: Insights_module_css_default.rankName,
														title: m.model,
														children: m.model
													})]
												}), (0, react_jsx_runtime.jsxs)("span", {
													className: Insights_module_css_default.rankValMain,
													style: { color },
													children: [(avgMs / 1e3).toFixed(2), " 秒"]
												})]
											}),
											(0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.rankTrack,
												children: (0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.rankBar,
													style: {
														width: `${score}%`,
														background: color
													}
												})
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankSubText,
												children: [(0, react_jsx_runtime.jsxs)("span", { children: [
													"速度敏捷得分 ",
													(0, react_jsx_runtime.jsxs)("strong", { children: [score, "分"] }),
													" (首字均值 ",
													(avgMs / 1e3).toFixed(2),
													"s)"
												] }), (0, react_jsx_runtime.jsxs)("span", { children: [
													"累计采样 ",
													m.firstSamples,
													" 次"
												] })]
											})
										]
									}, m.model);
								}), analytics.speedList.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.drilldownEmpty,
									children: "暂无模型首字响应延迟采样数据。"
								}) : null]
							}),
							activeDrilldown === "latency" && (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.rankList,
								children: [analytics.latencyList.map((m, idx) => {
									const avgMs = m.firstMs / m.firstSamples;
									const maxMs = analytics.latencyList[0].firstMs / analytics.latencyList[0].firstSamples;
									const bottleneckPct = Math.max(10, Math.min(100, Math.round(avgMs / maxMs * 100)));
									const color = avgMs > 5e3 ? "#ef4444" : avgMs > 2e3 ? "#f59e0b" : "#3b82f6";
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.rankItem,
										children: [
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankItemTop,
												children: [(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.rankItemLeft,
													children: [(0, react_jsx_runtime.jsxs)("span", {
														className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
														children: ["#", idx + 1]
													}), (0, react_jsx_runtime.jsx)("span", {
														className: Insights_module_css_default.rankName,
														title: m.model,
														children: m.model
													})]
												}), (0, react_jsx_runtime.jsxs)("span", {
													className: Insights_module_css_default.rankValMain,
													style: { color },
													children: [(avgMs / 1e3).toFixed(2), " 秒"]
												})]
											}),
											(0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.rankTrack,
												children: (0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.rankBar,
													style: {
														width: `${bottleneckPct}%`,
														background: color
													}
												})
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankSubText,
												children: [(0, react_jsx_runtime.jsxs)("span", { children: [
													"排队延迟 ",
													(0, react_jsx_runtime.jsxs)("strong", { children: [(avgMs / 1e3).toFixed(2), "s"] }),
													" (瓶颈权重 ",
													bottleneckPct,
													"%)"
												] }), (0, react_jsx_runtime.jsxs)("span", { children: [
													"累计采样 ",
													m.firstSamples,
													" 次"
												] })]
											})
										]
									}, m.model);
								}), analytics.latencyList.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.drilldownEmpty,
									children: "暂无模型排队延迟采样数据。"
								}) : null]
							}),
							activeDrilldown === "thinking" && (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.rankList,
								children: [analytics.thinkList.map((m, idx) => {
									const totalTokens = (m.reasoning ?? 0) + (m.output ?? 0);
									const thinkPct = totalTokens > 0 ? Math.round(m.reasoning / totalTokens * 100) : 0;
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.rankItem,
										children: [
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankItemTop,
												children: [(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.rankItemLeft,
													children: [(0, react_jsx_runtime.jsxs)("span", {
														className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
														children: ["#", idx + 1]
													}), (0, react_jsx_runtime.jsx)("span", {
														className: Insights_module_css_default.rankName,
														title: m.model,
														children: m.model
													})]
												}), (0, react_jsx_runtime.jsxs)("span", {
													className: Insights_module_css_default.rankValMain,
													style: { color: "#8b5cf6" },
													children: [
														"思考占比 ",
														thinkPct,
														"%"
													]
												})]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.toolCompoundTrack,
												style: { height: "8px" },
												children: [(0, react_jsx_runtime.jsx)("div", {
													style: {
														width: `${thinkPct}%`,
														background: "#8b5cf6",
														height: "100%"
													},
													title: `思考: ${thinkPct}%`
												}), (0, react_jsx_runtime.jsx)("div", {
													style: {
														width: `${100 - thinkPct}%`,
														background: "#38bdf8",
														height: "100%"
													},
													title: `正文: ${100 - thinkPct}%`
												})]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankSubText,
												children: [(0, react_jsx_runtime.jsxs)("span", { children: [
													"思考推导 ",
													(0, react_jsx_runtime.jsx)("strong", { children: fmtCompact(m.reasoning) }),
													" Token (",
													thinkPct,
													"%)"
												] }), (0, react_jsx_runtime.jsxs)("span", { children: [
													"正文输出 ",
													(0, react_jsx_runtime.jsx)("strong", { children: fmtCompact(m.output) }),
													" Token"
												] })]
											})
										]
									}, m.model);
								}), analytics.thinkList.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.drilldownEmpty,
									children: "当前时间范围内未检测到调用带推导思考过程的模型。"
								}) : null]
							}),
							activeDrilldown === "cache" && (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.rankList,
								children: [analytics.cacheList.map((m, idx) => {
									const totalIn = (m.input ?? 0) + (m.cacheRead ?? 0);
									const hitPct = totalIn > 0 ? Math.round((m.cacheRead ?? 0) / totalIn * 100) : 0;
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.rankItem,
										children: [
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankItemTop,
												children: [(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.rankItemLeft,
													children: [(0, react_jsx_runtime.jsxs)("span", {
														className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
														children: ["#", idx + 1]
													}), (0, react_jsx_runtime.jsx)("span", {
														className: Insights_module_css_default.rankName,
														title: m.model,
														children: m.model
													})]
												}), (0, react_jsx_runtime.jsxs)("span", {
													className: Insights_module_css_default.rankValMain,
													style: { color: "#10b981" },
													children: [
														"命中率 ",
														hitPct,
														"%"
													]
												})]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.toolCompoundTrack,
												style: { height: "8px" },
												children: [(0, react_jsx_runtime.jsx)("div", {
													style: {
														width: `${hitPct}%`,
														background: "#10b981",
														height: "100%"
													},
													title: `缓存命中: ${hitPct}%`
												}), (0, react_jsx_runtime.jsx)("div", {
													style: {
														width: `${100 - hitPct}%`,
														background: "var(--dsw-alias-border-l3, #94a3b8)",
														height: "100%"
													},
													title: `未命中: ${100 - hitPct}%`
												})]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankSubText,
												children: [(0, react_jsx_runtime.jsxs)("span", { children: [
													"命中复用 ",
													(0, react_jsx_runtime.jsx)("strong", { children: fmtCompact(m.cacheRead ?? 0) }),
													" Token (",
													hitPct,
													"%)"
												] }), (0, react_jsx_runtime.jsxs)("span", { children: [
													"实付输入 ",
													(0, react_jsx_runtime.jsx)("strong", { children: fmtCompact(m.input ?? 0) }),
													" Token"
												] })]
											})
										]
									}, m.model);
								}), analytics.cacheList.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.drilldownEmpty,
									children: "暂无模型缓存使用记录。"
								}) : null]
							}),
							activeDrilldown === "tool" && (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.toolDrillSection,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.toolCompoundBox,
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.toolCompoundTrack,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.toolSliceBash,
												style: { width: `${analytics.bashPct}%` }
											}), (0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.toolSliceFile,
												style: { width: `${analytics.filePct}%` }
											})]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.toolCompoundLegend,
											children: [(0, react_jsx_runtime.jsxs)("span", { children: [
												(0, react_jsx_runtime.jsx)("i", {
													className: Insights_module_css_default.dlDot,
													style: { background: "var(--dsw-static-green-500, #10b981)" }
												}),
												" 终端命令 (Bash): ",
												(0, react_jsx_runtime.jsxs)("strong", { children: [
													Math.round(analytics.totalBashMs / 1e3),
													"秒 (",
													analytics.bashPct,
													"%)"
												] })
											] }), (0, react_jsx_runtime.jsxs)("span", { children: [
												(0, react_jsx_runtime.jsx)("i", {
													className: Insights_module_css_default.dlDot,
													style: { background: "#0ea5e9" }
												}),
												" 文件与通用读写: ",
												(0, react_jsx_runtime.jsxs)("strong", { children: [
													Math.round(analytics.totalFileMs / 1e3),
													"秒 (",
													analytics.filePct,
													"%)"
												] })
											] })]
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.toolGridCards,
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.toolMiniCard,
											children: [
												(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.toolMiniTitle,
													children: [(0, react_jsx_runtime.jsx)("i", {
														className: Insights_module_css_default.dlDot,
														style: { background: "var(--dsw-static-green-500, #10b981)" }
													}), (0, react_jsx_runtime.jsx)("span", { children: "终端 Bash 命令 (测试/构建/脚本)" })]
												}),
												(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.toolMiniNum,
													children: [Math.round(analytics.totalBashMs / 1e3), " 秒"]
												}),
												(0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.toolMiniDesc,
													children: "包含 npm run, cargo, git, Python 以及本地自动化测试脚本等高耗时运行环节。"
												})
											]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.toolMiniCard,
											children: [
												(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.toolMiniTitle,
													children: [(0, react_jsx_runtime.jsx)("i", {
														className: Insights_module_css_default.dlDot,
														style: { background: "#0ea5e9" }
													}), (0, react_jsx_runtime.jsx)("span", { children: "文件操作与其他工具 (读写/检索)" })]
												}),
												(0, react_jsx_runtime.jsxs)("div", {
													className: Insights_module_css_default.toolMiniNum,
													children: [Math.round(analytics.totalFileMs / 1e3), " 秒"]
												}),
												(0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.toolMiniDesc,
													children: "包含 read, write, edit, glob, grep 等轻量快速文件读写。单次耗时通常在毫秒级。"
												})
											]
										})]
									}),
									analytics.topToolSessions && analytics.topToolSessions.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.toolTopList,
										children: [(0, react_jsx_runtime.jsx)("div", {
											className: Insights_module_css_default.toolTopListTitle,
											children: "单会话工具总耗时 TOP 3 (降序排查)"
										}), analytics.topToolSessions.slice(0, 3).map((s, idx) => {
											const tMs = s.value?.totals?.toolMs ?? 0;
											const bMs = s.value?.totals?.bashMs ?? 0;
											const fMs = Math.max(0, tMs - bMs);
											const bPct = tMs > 0 ? Math.round(bMs / tMs * 100) : 0;
											return (0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.rankItem,
												children: [
													(0, react_jsx_runtime.jsxs)("div", {
														className: Insights_module_css_default.rankItemTop,
														children: [(0, react_jsx_runtime.jsxs)("div", {
															className: Insights_module_css_default.rankItemLeft,
															children: [
																(0, react_jsx_runtime.jsxs)("span", {
																	className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
																	children: ["#", idx + 1]
																}),
																(0, react_jsx_runtime.jsxs)("span", {
																	className: Insights_module_css_default.sessionIdTag,
																	children: [s.sessionId.slice(0, 14), "…"]
																}),
																(0, react_jsx_runtime.jsx)("span", {
																	className: Insights_module_css_default.rankName,
																	title: s.value?.models?.[0]?.model,
																	children: s.value?.models?.[0]?.model ?? "通用会话"
																})
															]
														}), (0, react_jsx_runtime.jsxs)("span", {
															className: Insights_module_css_default.rankValMain,
															children: [
																"总计 ",
																Math.round(tMs / 1e3),
																" 秒"
															]
														})]
													}),
													(0, react_jsx_runtime.jsxs)("div", {
														className: Insights_module_css_default.toolCompoundTrack,
														style: { height: "8px" },
														children: [(0, react_jsx_runtime.jsx)("div", {
															style: {
																width: `${bPct}%`,
																background: "var(--dsw-static-green-500, #10b981)",
																height: "100%"
															},
															title: `终端命令: ${Math.round(bMs / 1e3)}s`
														}), (0, react_jsx_runtime.jsx)("div", {
															style: {
																width: `${100 - bPct}%`,
																background: "#0ea5e9",
																height: "100%"
															},
															title: `文件读写: ${Math.round(fMs / 1e3)}s`
														})]
													}),
													(0, react_jsx_runtime.jsxs)("div", {
														className: Insights_module_css_default.rankSubText,
														children: [(0, react_jsx_runtime.jsxs)("span", { children: [
															"终端 Bash ",
															(0, react_jsx_runtime.jsxs)("strong", { children: [Math.round(bMs / 1e3), "s"] }),
															" (",
															bPct,
															"%)"
														] }), (0, react_jsx_runtime.jsxs)("span", { children: [
															"文件读写 ",
															(0, react_jsx_runtime.jsxs)("strong", { children: [Math.round(fMs / 1e3), "s"] }),
															" (",
															100 - bPct,
															"%)"
														] })]
													})
												]
											}, s.sessionId);
										})]
									}) : null
								]
							}),
							activeDrilldown === "reliability" && (0, react_jsx_runtime.jsx)("div", {
								className: Insights_module_css_default.errorDrillSection,
								children: analytics.totalErrors === 0 && analytics.totalRetries === 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.errorAllGoodBox,
									children: "✓ 全部会话工具执行 100% 顺畅，未记录到任何非零退出码或重试异常！"
								}) : (0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.errorSessionList,
									children: [(0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.toolTopListTitle,
										children: "报错与重试排查列表 (按异常严重度降序)"
									}), analytics.errorSessions.map((s, idx) => (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.errorSessionRow,
										children: [
											(0, react_jsx_runtime.jsxs)("span", {
												className: `${Insights_module_css_default.rankBadge} ${idx === 0 ? Insights_module_css_default.rankBadgeGold : ""}`,
												children: ["#", idx + 1]
											}),
											(0, react_jsx_runtime.jsxs)("span", {
												className: Insights_module_css_default.sessionIdTag,
												children: [s.sessionId.slice(0, 14), "…"]
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: Insights_module_css_default.rankName,
												children: s.value?.models?.[0]?.model ?? "通用对话"
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: s.value?.totals?.toolErrors > 0 ? Insights_module_css_default.statusBad : Insights_module_css_default.statusOk,
												children: s.value?.totals?.toolErrors > 0 ? `${s.value.totals.toolErrors} 次报错` : "0 报错"
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: s.value?.totals?.retries > 0 ? Insights_module_css_default.statusWarn : Insights_module_css_default.statusOk,
												children: s.value?.totals?.retries > 0 ? `${s.value.totals.retries} 次重试` : "0 重试"
											})
										]
									}, s.sessionId))]
								})
							})
						]
					}) : null,
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.vizSplitGrid,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.vizPanel,
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.vizHead,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: Insights_module_css_default.vizTitle,
										children: "模型支出份额"
									}), (0, react_jsx_runtime.jsx)("span", {
										className: Insights_module_css_default.vizSub,
										children: "按消耗 Token 降序排列"
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.donutWrap,
									children: [(0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.donutSvgBox,
										children: [(0, react_jsx_runtime.jsxs)("svg", {
											viewBox: "0 0 100 100",
											className: Insights_module_css_default.donutSvg,
											children: [(0, react_jsx_runtime.jsx)("circle", {
												cx: "50",
												cy: "50",
												r: "38",
												fill: "none",
												stroke: "var(--dsw-alias-bg-layer-2)",
												strokeWidth: "12"
											}), (0, react_jsx_runtime.jsx)("g", {
												transform: "rotate(-90 50 50)",
												children: (analytics?.donutSegments.length ?? 0) === 1 ? (0, react_jsx_runtime.jsx)("circle", {
													cx: "50",
													cy: "50",
													r: "38",
													fill: "none",
													stroke: analytics.donutSegments[0].color,
													strokeWidth: "12"
												}) : analytics?.donutSegments.map((seg, idx) => (0, react_jsx_runtime.jsx)("circle", {
													cx: "50",
													cy: "50",
													r: "38",
													fill: "none",
													stroke: seg.color,
													strokeWidth: "12",
													strokeDasharray: seg.dasharray,
													strokeDashoffset: seg.dashoffset
												}, idx))
											})]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: Insights_module_css_default.donutCenterText,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.donutCenterNum,
												children: activeSeg ? `${activeSeg.pct}%` : topModel ? `${topModel.pct}%` : `${analytics?.donutSegments.length ?? 0}款`
											}), (0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.donutCenterSub,
												children: activeSeg ? "选中占比" : "主力占比"
											})]
										})]
									}), (0, react_jsx_runtime.jsx)("div", {
										className: Insights_module_css_default.donutLegendList,
										children: analytics?.donutSegments.map((seg, idx) => (0, react_jsx_runtime.jsxs)("div", {
											className: `${Insights_module_css_default.donutLegendRow} ${hoveredIdx === idx ? Insights_module_css_default.donutLegendRowActive : ""}`,
											onMouseEnter: () => setHoveredIdx(idx),
											onMouseLeave: () => setHoveredIdx(null),
											children: [(0, react_jsx_runtime.jsxs)("span", {
												className: Insights_module_css_default.dlLeft,
												children: [(0, react_jsx_runtime.jsx)("i", {
													className: Insights_module_css_default.dlDot,
													style: { background: seg.color }
												}), (0, react_jsx_runtime.jsx)("span", {
													className: Insights_module_css_default.dlName,
													title: seg.model,
													children: seg.model
												})]
											}), (0, react_jsx_runtime.jsxs)("span", {
												className: Insights_module_css_default.dlRight,
												children: [
													fmtCompact(seg.tokens),
													" · ",
													seg.pct,
													"%"
												]
											})]
										}, idx))
									})]
								}),
								activeSeg || topModel ? (0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.donutInspectBar,
									children: [
										(0, react_jsx_runtime.jsx)("i", {
											className: Insights_module_css_default.dlDot,
											style: { background: (activeSeg || topModel)?.color }
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.donutInspectName,
											title: (activeSeg || topModel)?.model,
											children: (activeSeg || topModel)?.model
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.donutInspectTag,
											children: activeSeg ? "当前高亮" : "全场主力"
										}),
										(0, react_jsx_runtime.jsxs)("span", {
											className: Insights_module_css_default.donutInspectVal,
											children: [
												fmtCompact((activeSeg || topModel)?.tokens ?? 0),
												" Token (",
												(activeSeg || topModel)?.pct,
												"%)"
											]
										})
									]
								}) : null
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.vizPanel,
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: Insights_module_css_default.vizHead,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: Insights_module_css_default.vizTitle,
										children: "每日编码活跃度"
									}), (0, react_jsx_runtime.jsxs)("span", {
										className: Insights_module_css_default.vizSub,
										children: [
											"近 ",
											range,
											" 天分布"
										]
									})]
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: `${Insights_module_css_default.dayStack} ${range === "7" ? Insights_module_css_default.dayStackWeek : ""}`,
									"aria-label": "按日活跃柱图",
									children: (analytics?.daySeries ?? []).map((day) => (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.dayCol,
										title: `${day.key} · ${fmtCompact(day.total)} Token`,
										children: [(0, react_jsx_runtime.jsx)("div", {
											className: Insights_module_css_default.dayColFill,
											children: day.total > 0 ? day.segments.map((seg) => (0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.daySeg,
												style: {
													height: `${seg.tokens / analytics.dayMax * 100}%`,
													background: seg.color
												}
											}, seg.model)) : (0, react_jsx_runtime.jsx)("div", { className: Insights_module_css_default.dayEmptyDot })
										}), (0, react_jsx_runtime.jsx)("span", {
											className: Insights_module_css_default.dayLabel,
											children: day.label
										})]
									}, day.key))
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: Insights_module_css_default.chartFoot,
									children: "每日柱高代表当天最后活动的对话 Token 汇总，分色对应左侧调用模型。"
								})
							]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: Insights_module_css_default.vizPanel,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.vizHead,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.tableTitleGroup,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: Insights_module_css_default.vizTitle,
									children: "重点对话账单"
								}), (0, react_jsx_runtime.jsxs)("span", {
									className: Insights_module_css_default.vizSub,
									children: [
										sessionSort === "tokens" && "按 Token 消耗由高到低严格排序",
										sessionSort === "time" && "按执行总耗时由长到短严格排序",
										sessionSort === "errors" && "按报错与重试次数降序排查"
									]
								})]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.tableSortGroup,
								role: "group",
								"aria-label": "对话账单排序切换",
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Insights_module_css_default.sortBtn,
										"data-active": sessionSort === "tokens" ? "" : void 0,
										onClick: () => setSessionSort("tokens"),
										children: "Token 消耗 ↓"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Insights_module_css_default.sortBtn,
										"data-active": sessionSort === "time" ? "" : void 0,
										onClick: () => setSessionSort("time"),
										children: "总耗时 ↓"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Insights_module_css_default.sortBtn,
										"data-active": sessionSort === "errors" ? "" : void 0,
										onClick: () => setSessionSort("errors"),
										children: "故障数 ↓"
									})
								]
							})]
						}), sessions && sessions.rows.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.sessionTableBox,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: Insights_module_css_default.sessionTableHeader,
								children: [
									(0, react_jsx_runtime.jsx)("span", { children: "排名 · 会话ID" }),
									(0, react_jsx_runtime.jsx)("span", { children: "主用模型" }),
									(0, react_jsx_runtime.jsx)("span", {
										style: { textAlign: "right" },
										children: "Token 消耗"
									}),
									(0, react_jsx_runtime.jsx)("span", {
										style: { textAlign: "right" },
										children: "总耗时"
									}),
									(0, react_jsx_runtime.jsx)("span", {
										style: { textAlign: "center" },
										children: "运行状态"
									}),
									(0, react_jsx_runtime.jsx)("span", {})
								]
							}), analytics?.sortedSessions.slice(0, 10).map((row, idx) => {
								const val = row.value;
								const isOpen = openSessionId === row.sessionId;
								const errCount = val.totals.toolErrors ?? 0;
								const retryCount = val.totals.retries ?? 0;
								const modelMs = val.totals.modelMs ?? 0;
								const toolMs = val.totals.toolMs ?? 0;
								const totalMs = modelMs + toolMs;
								const modelPct = totalMs > 0 ? Math.round(modelMs / totalMs * 100) : 50;
								const status = errCount > 0 ? `${errCount} 次报错` : retryCount > 0 ? `${retryCount} 次重试` : "顺畅";
								const tokenBarPct = Math.max(4, Math.round((val.totals.tokens ?? 0) / analytics.maxSessionTokens * 100));
								return (0, react_jsx_runtime.jsxs)("div", {
									className: `${Insights_module_css_default.sessionItemRow} ${isOpen ? Insights_module_css_default.sessionItemOpen : ""}`,
									children: [(0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Insights_module_css_default.sessionItemHead,
										onClick: () => setOpenSessionId(isOpen ? null : row.sessionId),
										children: [
											(0, react_jsx_runtime.jsxs)("span", {
												className: Insights_module_css_default.sessionIdTag,
												title: row.sessionId,
												children: [
													(0, react_jsx_runtime.jsxs)("strong", {
														className: Insights_module_css_default.tableRankNum,
														children: ["#", idx + 1]
													}),
													" ",
													row.sessionId.length > 12 ? `${row.sessionId.slice(0, 6)}…${row.sessionId.slice(-3)}` : row.sessionId
												]
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: Insights_module_css_default.sessionModelCell,
												title: val.models?.[0]?.model,
												children: val.models?.[0]?.model ?? "未标注"
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.sessionTokenCell,
												children: [(0, react_jsx_runtime.jsx)("span", { children: fmtCompact(val.totals.tokens) }), (0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.sessionTokenBar,
													style: { width: `${tokenBarPct}%` }
												})]
											}),
											(0, react_jsx_runtime.jsxs)("span", {
												style: { textAlign: "right" },
												children: [Math.round(totalMs / 1e3), " 秒"]
											}),
											(0, react_jsx_runtime.jsx)("span", {
												style: { textAlign: "center" },
												className: errCount > 0 ? Insights_module_css_default.statusBad : retryCount > 0 ? Insights_module_css_default.statusWarn : Insights_module_css_default.statusOk,
												children: status
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: Insights_module_css_default.arrowIcon,
												children: "›"
											})
										]
									}), isOpen ? (0, react_jsx_runtime.jsxs)("div", {
										className: Insights_module_css_default.sessionItemDrawer,
										children: [
											(0, react_jsx_runtime.jsx)("div", {
												className: Insights_module_css_default.drawerTitle,
												children: "耗时构成下钻：模型响应 vs 本地工具"
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.drawerBarTrack,
												children: [(0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.drawerSliceModel,
													style: { width: `${modelPct}%` }
												}), (0, react_jsx_runtime.jsx)("div", {
													className: Insights_module_css_default.drawerSliceTool,
													style: { width: `${100 - modelPct}%` }
												})]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: Insights_module_css_default.drawerMetaRow,
												children: [
													(0, react_jsx_runtime.jsxs)("span", { children: [
														"模型 ",
														Math.round(modelMs / 1e3),
														" 秒 (首响应均值 ",
														val.totals.firstSamples ? (val.totals.firstMs / val.totals.firstSamples / 1e3).toFixed(1) : 0,
														"s)"
													] }),
													(0, react_jsx_runtime.jsxs)("span", { children: [
														"工具 ",
														Math.round(toolMs / 1e3),
														" 秒 · ",
														val.totals.tools,
														" 次执行"
													] }),
													(0, react_jsx_runtime.jsxs)("span", { children: [
														"缓存命中率 ",
														val.totals.input + val.totals.cacheRead > 0 ? Math.round(val.totals.cacheRead / (val.totals.input + val.totals.cacheRead) * 100) : 0,
														"%"
													] })
												]
											})
										]
									}) : null]
								}, row.sessionId);
							})]
						}) : (0, react_jsx_runtime.jsx)("div", {
							className: Insights_module_css_default.emptyScan,
							children: "暂无已缓存的对话统计。"
						})]
					}),
					(0, react_jsx_runtime.jsxs)("details", {
						className: Insights_module_css_default.settingsDrawer,
						children: [(0, react_jsx_runtime.jsx)("summary", {
							className: Insights_module_css_default.settingsSummary,
							children: "⚙ 高级报警阈值设置 (默认开箱即用，无需频繁调整)"
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: Insights_module_css_default.settingsDrawerContent,
							children: [
								(0, react_jsx_runtime.jsxs)("label", {
									className: Insights_module_css_default.settingInlineItem,
									children: [
										(0, react_jsx_runtime.jsx)("span", { children: "等多久没字算卡顿:" }),
										(0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 5,
											max: 300,
											className: Insights_module_css_default.settingsMiniInput,
											value: silence,
											onChange: (e) => setSilence(Number(e.target.value))
										}),
										(0, react_jsx_runtime.jsx)("span", { children: "秒" })
									]
								}),
								(0, react_jsx_runtime.jsxs)("label", {
									className: Insights_module_css_default.settingInlineItem,
									children: [
										(0, react_jsx_runtime.jsx)("span", { children: "单次推导思考超时:" }),
										(0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 10,
											max: 600,
											className: Insights_module_css_default.settingsMiniInput,
											value: reasoning,
											onChange: (e) => setReasoning(Number(e.target.value))
										}),
										(0, react_jsx_runtime.jsx)("span", { children: "秒" })
									]
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Insights_module_css_default.settingsMiniSaveBtn,
									onClick: save,
									children: saved ? "已保存 ✓" : "保存"
								})
							]
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/hub/overview.js
		const OVERVIEW_STATE_LABEL = Object.freeze({
			active: "进行中",
			current: "当前",
			waiting: "等待你",
			failure: "有失败记录",
			interrupted: "已中断",
			settled: "已结束",
			partial: "数据不完整"
		});
		/** Project evidence status into the one question overview markers answer: where should the user look? */
		function overviewStateOf(status, isLatest) {
			if (status === "waiting") return "waiting";
			if (status === "failure") return "failure";
			if (status === "interrupted") return "interrupted";
			if (status === "running") return "active";
			if (status === "unknown") return "partial";
			return isLatest ? "current" : "settled";
		}
		function turnOverviewSummary(turn) {
			const executionCount = turn.groups.reduce((sum, group) => sum + group.executionCount, 0);
			return [`${turn.groups.length} 个阶段`, executionCount > 0 ? `${executionCount} 次执行` : null].filter((part) => part !== null).join(" · ");
		}
		function turnNeedsDefaultDisclosure(state, isLatest) {
			return isLatest || state === "active" || state === "waiting" || state === "partial";
		}
		//#endregion
		//#region lib/types/observation/performance.js
		function outputTokensOf(usage) {
			if (typeof usage !== "object" || usage === null || !("outputTokens" in usage)) return null;
			const value = usage.outputTokens;
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		}
		function toolDurationOf(turn) {
			let durationMs = 0;
			let sampled = false;
			for (const group of turn.groups) for (const item of group.items) {
				if (item.source !== "tool" || item.durationMs === null) continue;
				durationMs += item.durationMs;
				sampled = true;
			}
			return sampled ? durationMs : null;
		}
		function foldAssistantNodes(nodes) {
			const folds = /* @__PURE__ */ new Map();
			for (const node of nodes) {
				if (node.kind !== "assistant") continue;
				const timing = node.timing;
				const ttftMs = timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null;
				const modelMs = timing !== void 0 && timing.stepStartTime !== null ? Math.max(0, timing.completedTime - timing.stepStartTime) : null;
				const decodeMs = timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null;
				const outputTokens = outputTokensOf(node.usage);
				let fold = folds.get(node.turn);
				if (fold === void 0) {
					fold = {
						firstStep: node.step,
						firstStepTtftMs: ttftMs,
						modelMs: 0,
						modelSampled: false,
						decodeMs: 0,
						outputTokens: 0,
						decodeSampled: false
					};
					folds.set(node.turn, fold);
				} else if (node.step < fold.firstStep) {
					fold.firstStep = node.step;
					fold.firstStepTtftMs = ttftMs;
				}
				if (modelMs !== null) {
					fold.modelMs += modelMs;
					fold.modelSampled = true;
				}
				if (decodeMs !== null && outputTokens !== null) {
					fold.decodeMs += decodeMs;
					fold.outputTokens += outputTokens;
					fold.decodeSampled = true;
				}
			}
			return folds;
		}
		/**
		* Correlate durable assistant timing/usage with Watcher's occurrence-preserving Turns.
		* Missing timing or provider usage stays unavailable; this function never estimates it.
		*/
		function deriveTurnPerformance(nodes, turns) {
			const assistantFolds = foldAssistantNodes(nodes);
			const performance = /* @__PURE__ */ new Map();
			for (const turn of turns) {
				const fold = assistantFolds.get(turn.turn);
				const throughput = fold !== void 0 && fold.decodeSampled && fold.decodeMs > 0 ? {
					kind: "measured",
					decodeMs: fold.decodeMs,
					outputTokens: fold.outputTokens,
					tokensPerSecond: fold.outputTokens / (fold.decodeMs / 1e3)
				} : { kind: "unavailable" };
				performance.set(turn.turn, {
					modelMs: fold?.modelSampled === true ? fold.modelMs : null,
					toolMs: toolDurationOf(turn),
					ttftMs: fold?.firstStepTtftMs ?? null,
					throughput
				});
			}
			return performance;
		}
		function itemEndTime(item) {
			return item.resultTime ?? item.time;
		}
		function observedTurnRange(turn, live, now) {
			const items = turn.groups.flatMap((group) => group.items);
			const observedStarts = [...turn.groups.flatMap((group) => group.startTime === null ? [] : [group.startTime]), ...items.map((item) => item.time)];
			const observedEnds = [...turn.groups.flatMap((group) => group.endTime === null ? [] : [group.endTime]), ...items.map(itemEndTime)];
			const fallbackStart = observedStarts.length === 0 ? null : Math.min(...observedStarts);
			const fallbackEnd = observedEnds.length === 0 ? null : Math.max(...observedEnds);
			const startTime = turn.startTime ?? fallbackStart;
			const endTime = turn.endTime ?? (live ? now : fallbackEnd);
			if (startTime === null || endTime === null) return null;
			return {
				startTime,
				endTime: Math.max(startTime, endTime),
				exactBounds: turn.startTime !== null && (turn.endTime !== null || live)
			};
		}
		/** Settled Turn duration, live current duration, or a lower bound for a clipped Turn start. */
		function turnElapsedReading(turn, live, now) {
			const range = observedTurnRange(turn, live, now);
			if (range === null) return { kind: "unavailable" };
			return {
				kind: range.exactBounds ? "exact" : "lower-bound",
				durationMs: range.endTime - range.startTime
			};
		}
		function boundedElapsed(startTime, endTime, live, now) {
			if (startTime === null) return null;
			const end = endTime ?? (live ? now : null);
			return end === null ? null : Math.max(0, end - startTime);
		}
		/** One phase's wall-clock span from its first Step start to its last Step end. */
		function groupElapsedMs(group, live, now) {
			return boundedElapsed(group.startTime, group.endTime, live, now);
		}
		/** One Step's wall-clock span, including model, tools, and in-step waits. */
		function stepElapsedMs(step, live, now) {
			return boundedElapsed(step.startTime, step.endTime, live, now);
		}
		/** One execution's settled duration or live elapsed interval. */
		function itemElapsedMs(item, live, now) {
			return item.durationMs ?? (live ? Math.max(0, now - item.time) : null);
		}
		/** Whole tokens from ten up, one decimal below, matching DSH's RC8 chat chrome. */
		function formatTokensPerSecond(tokensPerSecond) {
			const clamped = Math.max(0, tokensPerSecond);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		//#endregion
		//#region lib/types/client/step-timeline.js
		/** Compose the visible rows owned by one authoritative DSH Step. */
		function stepTimelineEntries(step) {
			const occurrences = step.items.filter((item) => item.source !== "model").map((item, occurrenceIndex) => ({
				kind: "occurrence",
				item,
				occurrenceIndex
			}));
			if (step.model === null) return occurrences;
			const firstAgentOccurrence = occurrences.findIndex((entry) => entry.item.source !== "user");
			const modelIndex = firstAgentOccurrence < 0 ? occurrences.length : firstAgentOccurrence;
			return [
				...occurrences.slice(0, modelIndex),
				{
					kind: "model",
					trace: step.model
				},
				...occurrences.slice(modelIndex)
			];
		}
		//#endregion
		//#region lib/types/client/disclosure-depth.js
		function emptyLayerOverrides() {
			return {
				phase: {},
				step: {},
				cluster: {},
				model: {},
				reasoning: {}
			};
		}
		function createDisclosureState(depth = "overview") {
			return {
				depth,
				turns: {},
				layers: emptyLayerOverrides()
			};
		}
		/** Overview keeps the automatic Turn policy; detail opens every Turn by default. */
		function turnDisclosureOpen(state, turn, overviewDefaultOpen) {
			return state.turns[turn] ?? (state.depth === "detail" || overviewDefaultOpen);
		}
		/** Overview stops at phase headers; detail opens every nested level by default. */
		function layerDisclosureOpen(state, layer, key) {
			return state.layers[layer][key] ?? state.depth === "detail";
		}
		function setLayerDisclosure(state, layer, key, open) {
			return {
				...state,
				layers: {
					...state.layers,
					[layer]: {
						...state.layers[layer],
						[key]: open
					}
				}
			};
		}
		function toggleTurnDisclosure(state, turn, overviewDefaultOpen) {
			return {
				...state,
				turns: {
					...state.turns,
					[turn]: !turnDisclosureOpen(state, turn, overviewDefaultOpen)
				}
			};
		}
		function toggleLayerDisclosure(state, layer, key) {
			return setLayerDisclosure(state, layer, key, !layerDisclosureOpen(state, layer, key));
		}
		/** Choosing a depth applies it immediately instead of inheriting stale manual folds. */
		function chooseDisclosureDepth(depth) {
			return createDisclosureState(depth);
		}
		/** Session-specific ids may change, while the user's chosen depth remains useful. */
		function resetDisclosureOverrides(state) {
			return createDisclosureState(state.depth);
		}
		//#endregion
		//#region lib/types/client/Watcher.js
		const PANEL_GAP = 8;
		const PANEL_MARGIN = 12;
		const UNPLACED_PANEL_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		const MARKDOWN_LABELS = Object.freeze({
			code: Object.freeze({
				copyLabel: "复制",
				copiedLabel: "已复制"
			}),
			footnotes: "脚注"
		});
		const TERMINAL_LABELS = Object.freeze({
			signal: (signal) => `信号 ${signal}`,
			exitCode: (exitCode) => `退出码 ${exitCode}`,
			running: "运行中",
			failed: "失败",
			done: "完成",
			copy: "复制",
			copied: "已复制",
			noOutput: "没有输出",
			collapseAria: "收起终端输出",
			collapse: "收起",
			expandAria: (hidden) => `展开其余 ${hidden} 行终端输出`,
			expand: (hidden) => `展开 ${hidden} 行`
		});
		const READ_LABELS = Object.freeze({
			window: (shown, total) => `显示 ${shown}/${total} 行`,
			copy: "复制",
			copied: "已复制",
			collapseAria: "收起文件内容",
			expandAria: (hidden) => `展开其余 ${hidden} 行文件内容`,
			collapse: "收起",
			expand: (hidden) => `展开 ${hidden} 行`
		});
		const DIFF_LABELS = Object.freeze({
			copy: "复制",
			copied: "已复制",
			collapseAria: "收起变更内容",
			expandAria: (hidden) => `展开其余 ${hidden} 行变更`,
			collapse: "收起",
			expand: (hidden) => `展开 ${hidden} 行`,
			files: (count) => `${count} 个文件`
		});
		const JSON_LABELS = Object.freeze({
			copyValue: "复制值",
			copyJson: "复制 JSON",
			copyPath: "复制路径",
			copyPrettyJson: "复制格式化 JSON",
			copyCompactJson: "复制紧凑 JSON",
			copied: "已复制",
			copyFailed: "复制失败",
			collapseNode: "收起节点",
			expandNode: "展开节点",
			copyButtonTitle: (action) => action
		});
		const STATUS_LABEL = {
			running: "进行中",
			waiting: "等待你",
			success: "成功",
			failure: "失败",
			returned: "已返回",
			interrupted: "已中断",
			unknown: "未知"
		};
		function dotState(status) {
			if (status === "running") return "ongoing";
			if (status === "waiting") return "warning";
			if (status === "failure" || status === "interrupted") return "error";
			if (status === "success") return "done";
			return null;
		}
		function StatusMark({ status, className }) {
			const state = dotState(status);
			return state === null ? (0, react_jsx_runtime.jsx)("span", {
				className: `${Watcher_module_css_default.neutralDot}${className === void 0 ? "" : ` ${className}`}`,
				"data-status": status,
				"aria-hidden": "true"
			}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
				state,
				size: 10,
				className
			});
		}
		function formatDuration(durationMs) {
			if (durationMs === null) return null;
			if (durationMs < 1e3) return `${Math.round(durationMs)} ms`;
			const secondsWithDecimal = Math.round(durationMs / 100) / 10;
			if (secondsWithDecimal < 60) return `${secondsWithDecimal < 10 ? secondsWithDecimal.toFixed(1) : Math.round(secondsWithDecimal)} s`;
			const totalSeconds = Math.round(durationMs / 1e3);
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = totalSeconds % 60;
			if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
			return `${minutes}m ${seconds}s`;
		}
		function turnDuration(turn, live, now) {
			const reading = turnElapsedReading(turn, live, now);
			if (reading.kind === "unavailable") return null;
			const duration = formatDuration(reading.durationMs);
			if (duration === null) return null;
			return {
				kind: reading.kind === "exact" ? "exact" : "partial",
				value: duration
			};
		}
		function useLiveClock(enabled) {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				if (!enabled) return;
				setNow(Date.now());
				const timer = setInterval(() => setNow(Date.now()), 1e3);
				return () => clearInterval(timer);
			}, [enabled]);
			return now;
		}
		function TurnMetricStrip({ performance }) {
			const metrics = [
				["模型", formatDuration(performance.modelMs)],
				["工具", formatDuration(performance.toolMs)],
				["首 token", formatDuration(performance.ttftMs)]
			].filter((metric) => metric[1] !== null);
			if (metrics.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("dl", {
				className: Watcher_module_css_default.turnMetrics,
				"aria-label": "对话轮次性能分解",
				children: metrics.map(([label, value]) => (0, react_jsx_runtime.jsxs)("div", {
					className: Watcher_module_css_default.turnMetric,
					children: [(0, react_jsx_runtime.jsx)("dt", { children: label }), (0, react_jsx_runtime.jsx)("dd", { children: value })]
				}, label))
			});
		}
		function rawOf(item) {
			if (item.rawText.trim() !== "") return item.rawText;
			try {
				return JSON.stringify(item.rawValue, null, 2) ?? String(item.rawValue);
			} catch {
				return String(item.rawValue);
			}
		}
		function isJsonValue(value) {
			return typeof value === "object" && value !== null;
		}
		function CopyRawButton({ text }) {
			const [copied, setCopied] = (0, react.useState)(false);
			const timerRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				if (timerRef.current !== null) clearTimeout(timerRef.current);
			}, []);
			const copy = () => {
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text).then((ok) => {
					if (!ok) return;
					setCopied(true);
					if (timerRef.current !== null) clearTimeout(timerRef.current);
					timerRef.current = setTimeout(() => setCopied(false), 1500);
				});
			};
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: Watcher_module_css_default.copyRaw,
				onClick: copy,
				"aria-label": copied ? "原始数据已复制" : "复制原始数据",
				children: [copied ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, { size: 14 }), copied ? "已复制" : "复制"]
			});
		}
		function ResultPresentation({ presentation }) {
			switch (presentation.kind) {
				case "terminal": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
					command: presentation.command,
					cwd: presentation.cwd ?? void 0,
					output: presentation.output,
					exitCode: presentation.exitCode ?? void 0,
					signal: presentation.signal ?? void 0,
					running: presentation.running,
					maxLines: 18,
					labels: TERMINAL_LABELS
				});
				case "read": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ReadBlock, {
					label: presentation.label,
					lang: presentation.lang ?? void 0,
					lines: presentation.lines,
					totalLines: presentation.totalLines,
					maxLines: 18,
					labels: READ_LABELS
				});
				case "diff": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DiffBlock, {
					diffs: presentation.diffs,
					maxLines: 18,
					labels: DIFF_LABELS
				});
				case "json": return (0, react_jsx_runtime.jsx)("div", {
					className: Watcher_module_css_default.jsonSurface,
					children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
						data: presentation.data,
						label: "结构化结果",
						labels: JSON_LABELS
					})
				});
				case "text": return (0, react_jsx_runtime.jsx)("article", {
					className: Watcher_module_css_default.documentResult,
					"data-watcher-document": "",
					children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: presentation.text,
						labels: MARKDOWN_LABELS
					})
				});
				case "image": return (0, react_jsx_runtime.jsxs)("div", {
					className: Watcher_module_css_default.artifactResult,
					children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.artifactGlyph,
							"aria-hidden": "true",
							children: "▧"
						}),
						(0, react_jsx_runtime.jsx)("strong", { children: "图片附件" }),
						(0, react_jsx_runtime.jsx)("span", { children: "附件已保留在本次会话记录中" }),
						isJsonValue(presentation.attachment) ? (0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.jsonSurface,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
								data: presentation.attachment,
								label: "图片附件信息",
								labels: JSON_LABELS
							})
						}) : null
					]
				});
				case "empty": return (0, react_jsx_runtime.jsx)("div", {
					className: Watcher_module_css_default.detailEmpty,
					children: "这次执行还没有可显示的结果"
				});
			}
		}
		function preferredItem(group) {
			return group.items.find((item) => item.status === "failure" && item.recoveredBy === null) ?? group.items.find((item) => item.status === "waiting" || item.status === "running") ?? group.items.at(-1) ?? null;
		}
		function groupStatusLabel(group) {
			return group.status === "failure" ? "含失败记录" : STATUS_LABEL[group.status];
		}
		function itemPattern(item) {
			if (item.retryIndex > 0) return `重试 ${item.retryIndex} 次`;
			if (item.iterationIndex > 0) return `迭代第 ${item.iterationIndex + 1} 版`;
			if (item.recoveredBy !== null) return "后续已恢复";
			return null;
		}
		function ExecutionInspector({ group, selectedItemId, live, now, onSelectItem, onBack }) {
			const [tab, setTab] = (0, react.useState)("result");
			const fallback = preferredItem(group);
			const selected = group.items.find((item) => item.id === selectedItemId) ?? fallback;
			(0, react.useEffect)(() => setTab("result"), [group.id, selected?.id]);
			if (selected === null) return null;
			const duration = formatDuration(itemElapsedMs(selected, live && selected.status === "running", now));
			const groupDuration = formatDuration(groupElapsedMs(group, live, now));
			const raw = rawOf(selected);
			const hasInput = Object.keys(selected.args).length > 0;
			const pattern = itemPattern(selected);
			return (0, react_jsx_runtime.jsxs)("aside", {
				className: Watcher_module_css_default.inspector,
				"aria-label": `${group.title} 的执行详情`,
				"data-ud-check": "watcher-inspector",
				"data-ud-role": "panel",
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: Watcher_module_css_default.inspectorHeader,
						children: [
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.inspectorBack,
								onClick: onBack,
								"aria-label": "返回工作路径",
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
									size: 13,
									"aria-hidden": "true"
								}), "工作路径"]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.statusLine,
								"data-status": group.status,
								children: [
									(0, react_jsx_runtime.jsx)(StatusMark, { status: group.status }),
									(0, react_jsx_runtime.jsx)("span", { children: groupStatusLabel(group) }),
									(0, react_jsx_runtime.jsxs)("span", {
										className: Watcher_module_css_default.location,
										children: [
											"对话轮次 ",
											group.turn || "—",
											" · ",
											group.steps.length,
											" 个步骤",
											groupDuration === null ? "" : ` · ${groupDuration}`
										]
									})
								]
							}),
							(0, react_jsx_runtime.jsx)("h2", {
								className: Watcher_module_css_default.inspectorTitle,
								children: group.title
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: Watcher_module_css_default.inspectorSummary,
								children: group.subtitle
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.groupSignals,
								"aria-label": "工作模式",
								children: [
									group.parallelStepCount > 0 ? (0, react_jsx_runtime.jsxs)("span", { children: [
										"并行 ",
										group.parallelStepCount,
										" 次"
									] }) : null,
									group.retryCount > 0 ? (0, react_jsx_runtime.jsxs)("span", {
										"data-retry": "",
										children: [
											"重试 ",
											group.retryCount,
											" 次"
										]
									}) : null,
									group.iterationCount > 0 ? (0, react_jsx_runtime.jsxs)("span", { children: [
										"有 ",
										group.iterationCount,
										" 次迭代"
									] }) : null,
									group.unconfirmedFailureCount > 0 ? (0, react_jsx_runtime.jsxs)("span", {
										"data-error": "",
										children: [group.unconfirmedFailureCount, " 条失败后未见成功证据"]
									}) : null
								]
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: Watcher_module_css_default.inspectorBody,
						children: [(0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.executionSection,
							"aria-labelledby": `execution-title-${group.id}`,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.sectionHeading,
								children: [(0, react_jsx_runtime.jsx)("h3", {
									id: `execution-title-${group.id}`,
									children: "执行路径"
								}), (0, react_jsx_runtime.jsxs)("span", { children: [group.items.length, " 条记录"] })]
							}), (0, react_jsx_runtime.jsx)("div", {
								className: Watcher_module_css_default.executionList,
								children: group.steps.map((step, stepIndex) => {
									const stepLive = live && stepIndex === group.steps.length - 1;
									const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now));
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.stepBlock,
										"data-parallel": step.parallel ? "" : void 0,
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.stepHeading,
											children: [(0, react_jsx_runtime.jsxs)("span", { children: ["步骤 ", step.step || "—"] }), (0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.stepSignals,
												children: [stepDuration === null ? null : (0, react_jsx_runtime.jsx)("span", {
													className: Watcher_module_css_default.stepDuration,
													children: stepDuration
												}), step.parallel ? (0, react_jsx_runtime.jsxs)("span", {
													className: Watcher_module_css_default.parallelLabel,
													children: [step.executionCount, " 项并行"]
												}) : null]
											})]
										}), (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.occurrences,
											children: step.items.map((item, itemIndex) => {
												const itemDuration = formatDuration(itemElapsedMs(item, stepLive && item.status === "running", now));
												return (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: Watcher_module_css_default.occurrence,
													"data-selected": item.id === selected.id ? "" : void 0,
													"data-status": item.status,
													"aria-pressed": item.id === selected.id,
													onClick: () => onSelectItem(item.id),
													children: [
														(0, react_jsx_runtime.jsx)(StatusMark, {
															status: item.status,
															className: Watcher_module_css_default.occurrenceDot
														}),
														(0, react_jsx_runtime.jsxs)("span", {
															className: Watcher_module_css_default.occurrenceCopy,
															children: [(0, react_jsx_runtime.jsx)("span", {
																className: Watcher_module_css_default.occurrenceTitle,
																children: item.title
															}), (0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.occurrenceMeta,
																children: [
																	item.toolName ?? item.source,
																	step.items.length > 1 ? ` · 分支 ${itemIndex + 1}` : "",
																	itemPattern(item) === null ? "" : ` · ${itemPattern(item)}`
																]
															})]
														}),
														itemDuration === null ? null : (0, react_jsx_runtime.jsx)("span", {
															className: Watcher_module_css_default.occurrenceDuration,
															children: itemDuration
														}),
														(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
															size: 12,
															className: Watcher_module_css_default.occurrenceChevron
														})
													]
												}, item.id);
											})
										})]
									}, step.id);
								})
							})]
						}), (0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.detailSection,
							"aria-labelledby": `detail-title-${selected.id}`,
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.detailHeader,
									children: [(0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.detailIdentity,
										children: [
											(0, react_jsx_runtime.jsxs)("div", {
												className: Watcher_module_css_default.detailStatus,
												"data-status": selected.status,
												children: [
													(0, react_jsx_runtime.jsx)(StatusMark, { status: selected.status }),
													(0, react_jsx_runtime.jsx)("span", { children: STATUS_LABEL[selected.status] }),
													pattern === null ? null : (0, react_jsx_runtime.jsx)("span", {
														className: Watcher_module_css_default.patternLabel,
														children: pattern
													})
												]
											}),
											(0, react_jsx_runtime.jsx)("h3", {
												id: `detail-title-${selected.id}`,
												children: selected.title
											}),
											(0, react_jsx_runtime.jsx)("p", {
												title: selected.subtitle,
												children: selected.subtitle || "没有补充说明"
											})
										]
									}), (0, react_jsx_runtime.jsxs)("dl", {
										className: Watcher_module_css_default.metrics,
										children: [
											duration === null ? null : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: "耗时" }), (0, react_jsx_runtime.jsx)("dd", { children: duration })] }),
											selected.exitCode === null ? null : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: "退出码" }), (0, react_jsx_runtime.jsx)("dd", {
												"data-error": selected.exitCode === 0 ? void 0 : "",
												children: selected.exitCode
											})] }),
											selected.signal === null ? null : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: "信号" }), (0, react_jsx_runtime.jsx)("dd", {
												"data-error": "",
												children: selected.signal
											})] })
										]
									})]
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: Watcher_module_css_default.tabs,
									role: "tablist",
									"aria-label": "执行数据",
									children: [
										["result", "结果"],
										["input", "输入"],
										["raw", "原始"]
									].map(([id, label]) => (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === id,
										className: Watcher_module_css_default.tab,
										"data-active": tab === id ? "" : void 0,
										onClick: () => setTab(id),
										children: label
									}, id))
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.tabPanel,
									role: "tabpanel",
									children: [
										tab === "result" ? (0, react_jsx_runtime.jsx)(ResultPresentation, { presentation: selected.presentation }) : null,
										tab === "input" ? hasInput ? (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.jsonSurface,
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
												data: selected.args,
												label: "执行输入",
												labels: JSON_LABELS
											})
										}) : (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.detailEmpty,
											children: "这条记录没有工具输入"
										}) : null,
										tab === "raw" ? (0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.rawPanel,
											children: [(0, react_jsx_runtime.jsxs)("div", {
												className: Watcher_module_css_default.rawToolbar,
												children: [(0, react_jsx_runtime.jsx)("span", { children: "完整原始数据 · 不截断" }), (0, react_jsx_runtime.jsx)(CopyRawButton, { text: raw })]
											}), (0, react_jsx_runtime.jsx)("pre", { children: raw || "没有原始数据" })]
										}) : null
									]
								})
							]
						})]
					}),
					(0, react_jsx_runtime.jsx)("footer", {
						className: Watcher_module_css_default.inspectorFooter,
						children: "只读观察 · 不会改变 Agent"
					})
				]
			});
		}
		/** The pupil scans only while live; the complete eye remains a useful static glyph. */
		function IconLivingEye({ size = 17 }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: Watcher_module_css_default.eye,
				"data-ud-motion": "watcher-eye-scan",
				width: size,
				height: size,
				viewBox: "0 0 18 18",
				fill: "none",
				"aria-hidden": "true",
				children: (0, react_jsx_runtime.jsxs)("g", {
					className: Watcher_module_css_default.eyeBlink,
					children: [(0, react_jsx_runtime.jsx)("path", {
						className: Watcher_module_css_default.eyeOutline,
						fill: "currentColor",
						fillRule: "evenodd",
						d: "M9 3.25c-3.93 0-7.03 2.88-7.9 5.75.87 2.87 3.97 5.75 7.9 5.75s7.03-2.88 7.9-5.75C16.03 6.13 12.93 3.25 9 3.25Zm0 9.95A4.2 4.2 0 1 1 9 4.8a4.2 4.2 0 0 1 0 8.4Z"
					}), (0, react_jsx_runtime.jsxs)("g", {
						className: Watcher_module_css_default.eyePupil,
						children: [(0, react_jsx_runtime.jsx)("circle", {
							cx: "9",
							cy: "9",
							r: "2.05",
							fill: "currentColor"
						}), (0, react_jsx_runtime.jsx)("circle", {
							cx: "9.65",
							cy: "8.35",
							r: "0.45",
							fill: "var(--dsw-specific-menu)",
							opacity: "0.9"
						})]
					})]
				})
			});
		}
		function groupBadges(group) {
			return (0, react_jsx_runtime.jsxs)("span", {
				className: Watcher_module_css_default.groupBadges,
				"aria-hidden": "true",
				children: [
					group.parallelStepCount > 0 ? (0, react_jsx_runtime.jsx)("span", {
						"data-kind": "parallel",
						children: group.parallelStepCount === 1 ? "并行" : `并行 ${group.parallelStepCount} 组`
					}) : null,
					group.retryCount > 0 ? (0, react_jsx_runtime.jsxs)("span", {
						"data-kind": "retry",
						children: ["重试 ", group.retryCount]
					}) : null,
					group.iterationCount > 0 ? (0, react_jsx_runtime.jsxs)("span", {
						"data-kind": "iteration",
						children: ["迭代 ", group.iterationCount]
					}) : null
				]
			});
		}
		function showOverviewTag(state) {
			return state === "waiting" || state === "failure" || state === "interrupted" || state === "partial";
		}
		function itemMeta(item, { branch, step }) {
			return [
				step === null ? null : `步骤 ${step || "—"}`,
				item.toolName ?? item.source,
				branch === null ? null : `分支 ${branch}`,
				itemPattern(item)
			].filter((part) => part !== null && part !== "").join(" · ");
		}
		function branchNumberOf(step, item) {
			if (!step.parallel) return null;
			const index = step.items.findIndex((candidate) => candidate.id === item.id);
			return index < 0 ? null : index + 1;
		}
		function clusterBasisLabel(cluster) {
			if (cluster.executionCount < 2) return null;
			if (cluster.basis === "mutable-target" || cluster.basis === "shared-target") return "同一目标";
			if (cluster.basis === "exact-call") return "同一指令";
			return null;
		}
		function reasoningAttemptDuration(attempt, now) {
			if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) return null;
			const end = attempt.kind === "running" && attempt.firstOutputTime === null ? now : attempt.lastReasoningTime;
			return Math.max(0, end - attempt.firstReasoningTime);
		}
		function reasoningAttemptState(attempt) {
			if (attempt.kind === "running") return "生成中";
			if (attempt.kind === "retried") return "已重试";
			if (attempt.kind === "interrupted") return "已中断";
			return "已完成";
		}
		function ModelStage({ trace, stepId, now, open, disclosure, onToggle, onToggleReasoning }) {
			const metrics = modelStageMetrics(trace, now);
			const hasReasoning = hasReasoningEvidence(trace);
			const total = formatDuration(metrics.totalMs);
			const visibleReasoning = formatDuration(metrics.visibleReasoningMs);
			const reasoningAttempts = trace.attempts.filter((attempt) => attempt.reasoningText.trim() !== "");
			const summary = [
				total === null ? "时间不完整" : `模型 ${total}`,
				hasReasoning ? visibleReasoning === null ? "可见推理已记录" : `可见推理 ${visibleReasoning}` : null,
				trace.reasoningTokens === null ? null : `${trace.reasoningTokens.toLocaleString("zh-CN")} 推理 token`,
				metrics.live ? "进行中" : null
			].filter((value) => value !== null).join(" · ");
			const segments = [
				{
					key: "wait",
					label: "首响应等待",
					durationMs: metrics.firstResponseMs,
					unavailableLabel: "时间戳不可用"
				},
				{
					key: "reasoning",
					label: "可见推理",
					durationMs: metrics.visibleReasoningMs,
					unavailableLabel: hasReasoning ? "分段耗时不可用" : "未记录"
				},
				{
					key: "output",
					label: "输出 / 工具意图",
					durationMs: metrics.outputMs,
					unavailableLabel: "时间戳不可用"
				},
				...metrics.unattributedMs !== null && metrics.unattributedMs > 0 ? [{
					key: "unattributed",
					label: "重试 / 未归因",
					durationMs: metrics.unattributedMs,
					unavailableLabel: "不可用"
				}] : []
			];
			const measuredSegments = segments.filter((segment) => segment.durationMs !== null && segment.durationMs > 0);
			const bodyId = `watcher-model-stage-${stepId}`;
			return (0, react_jsx_runtime.jsxs)("section", {
				className: Watcher_module_css_default.modelStage,
				"data-live": metrics.live ? "" : void 0,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: Watcher_module_css_default.modelStageToggle,
					"aria-expanded": open,
					"aria-controls": bodyId,
					title: "模型阶段只使用 DSH 会话中供应商公开写入的事件",
					onClick: onToggle,
					children: [
						(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
							size: 11,
							className: Watcher_module_css_default.modelStageChevron
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.modelStageGlyph,
							"aria-hidden": "true"
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: Watcher_module_css_default.modelStageCopy,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.modelStageTitle,
								children: "模型阶段"
							}), (0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.modelStageSummary,
								children: summary
							})]
						})
					]
				}), (0, react_jsx_runtime.jsxs)("div", {
					id: bodyId,
					className: Watcher_module_css_default.modelStageBody,
					hidden: !open,
					children: [
						measuredSegments.length === 0 ? null : (0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.modelStageBar,
							"aria-label": "模型阶段耗时比例",
							children: measuredSegments.map((segment) => (0, react_jsx_runtime.jsx)("span", {
								"data-segment": segment.key,
								style: { flexGrow: Math.max(segment.durationMs, 1) },
								title: `${segment.label} ${formatDuration(segment.durationMs) ?? ""}`
							}, segment.key))
						}),
						(0, react_jsx_runtime.jsx)("dl", {
							className: Watcher_module_css_default.modelStageLedger,
							children: segments.map((segment) => (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.modelStageMetric,
								children: [(0, react_jsx_runtime.jsxs)("dt", { children: [(0, react_jsx_runtime.jsx)("span", {
									className: Watcher_module_css_default.modelStageSwatch,
									"data-segment": segment.key,
									"aria-hidden": "true"
								}), segment.label] }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(segment.durationMs) ?? segment.unavailableLabel })]
							}, segment.key))
						}),
						reasoningAttempts.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
							className: Watcher_module_css_default.modelStageNote,
							children: "本 Step 没有供应商可见推理记录"
						}) : (0, react_jsx_runtime.jsxs)("div", {
							className: Watcher_module_css_default.reasoningAttempts,
							children: [(0, react_jsx_runtime.jsx)("p", {
								className: Watcher_module_css_default.modelStageNote,
								children: "仅展示供应商写入 DSH 会话的可见 reasoning；不补写未记录内容。"
							}), reasoningAttempts.map((attempt) => {
								const key = `${stepId}:attempt:${attempt.attempt}`;
								const reasoningOpen = layerDisclosureOpen(disclosure, "reasoning", key);
								const duration = formatDuration(reasoningAttemptDuration(attempt, now));
								const meta = [
									reasoningAttemptState(attempt),
									duration ?? "分段耗时不可用",
									`${attempt.fragments.length} 个流片段`,
									attempt.kind === "retried" ? `等待重试 ${formatDuration(attempt.retryDelayMs) ?? "—"}` : null
								].filter((value) => value !== null).join(" · ");
								return (0, react_jsx_runtime.jsxs)("section", {
									className: Watcher_module_css_default.reasoningDisclosure,
									"data-open": reasoningOpen ? "" : void 0,
									children: [(0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Watcher_module_css_default.reasoningToggle,
										"aria-expanded": reasoningOpen,
										"aria-controls": `watcher-reasoning-${key}`,
										onClick: () => onToggleReasoning(key),
										children: [
											(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
												size: 11,
												className: Watcher_module_css_default.reasoningChevron
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.reasoningLabel,
												children: reasoningAttempts.length === 1 ? "推理记录" : `尝试 ${attempt.attempt}`
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.reasoningMeta,
												children: meta
											})
										]
									}), (0, react_jsx_runtime.jsx)("article", {
										id: `watcher-reasoning-${key}`,
										className: Watcher_module_css_default.reasoningBody,
										hidden: !reasoningOpen,
										children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
											text: attempt.reasoningText,
											labels: MARKDOWN_LABELS
										})
									})]
								}, key);
							})]
						})
					]
				})]
			});
		}
		function OverviewOccurrenceButton({ item, occurrenceNumber, branch, step, live, selected, now, onSelect }) {
			const duration = formatDuration(itemElapsedMs(item, live, now));
			const meta = itemMeta(item, {
				branch,
				step
			});
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: Watcher_module_css_default.overviewOccurrence,
				"data-selected": selected ? "" : void 0,
				"data-current": live ? "" : void 0,
				"data-status": item.status,
				"data-ud-motion": "watcher-live-append",
				"aria-current": live ? "step" : void 0,
				"aria-pressed": selected,
				"aria-label": `记录 ${occurrenceNumber}，${item.title}，${meta}${duration === null ? "" : `，耗时 ${duration}`}，${STATUS_LABEL[item.status]}`,
				onClick: onSelect,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceIndex,
						children: String(occurrenceNumber).padStart(2, "0")
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceDotSlot,
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)(StatusMark, {
							status: item.status,
							className: Watcher_module_css_default.overviewOccurrenceDot
						})
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						className: Watcher_module_css_default.overviewOccurrenceCopy,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.overviewOccurrenceTitle,
							children: item.title
						}), (0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.overviewOccurrenceMeta,
							children: meta
						})]
					}),
					duration === null ? null : (0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceDuration,
						children: duration
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
						size: 12,
						className: Watcher_module_css_default.overviewOccurrenceChevron
					})
				]
			});
		}
		function PhaseOverview({ group, isNow, running, now, selectedGroup, selectedItemId, observationMode, open, disclosure, onToggle, onToggleLayer, onToggleReasoning, onSelectItem }) {
			const phaseState = overviewStateOf(group.status, isNow);
			const phaseDuration = formatDuration(groupElapsedMs(group, isNow && running, now));
			const phaseSummary = [
				`${group.steps.length} 个步骤`,
				`${group.executionCount} 次执行`,
				phaseDuration
			].filter((part) => part !== null).join(" · ");
			const latestItemId = group.items.at(-1)?.id ?? null;
			const clusters = clusterWorkItems(group.items.filter((item) => item.source !== "model"));
			const modelSteps = group.steps.filter((step) => step.model !== null);
			const groupedModelsKey = `${group.id}:model-list`;
			const groupedModelsOpen = layerDisclosureOpen(disclosure, "model", groupedModelsKey);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: Watcher_module_css_default.phase,
				"data-selected": selectedGroup ? "" : void 0,
				"data-now": isNow ? "" : void 0,
				"data-overview-state": phaseState,
				"aria-label": `${group.title}，${phaseSummary}，${OVERVIEW_STATE_LABEL[phaseState]}`,
				children: [(0, react_jsx_runtime.jsx)("header", {
					className: Watcher_module_css_default.phaseHeader,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: Watcher_module_css_default.phaseToggle,
						"aria-expanded": open,
						"aria-controls": `watcher-phase-body-${group.id}`,
						"aria-label": `${group.title}，${phaseSummary}，${open ? "收起阶段" : "展开阶段"}`,
						onClick: onToggle,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.phaseMarker,
								"data-state": phaseState,
								"aria-hidden": "true"
							}),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
								size: 12,
								className: Watcher_module_css_default.phaseChevron
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: Watcher_module_css_default.phaseCopy,
								children: [(0, react_jsx_runtime.jsxs)("span", {
									className: Watcher_module_css_default.phaseTitleLine,
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.phaseTitle,
											"data-watcher-group-title": "",
											children: group.title
										}),
										groupBadges(group),
										showOverviewTag(phaseState) ? (0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.overviewTag,
											"data-state": phaseState,
											children: OVERVIEW_STATE_LABEL[phaseState]
										}) : null
									]
								}), (0, react_jsx_runtime.jsx)("span", {
									className: Watcher_module_css_default.phaseMeta,
									children: phaseSummary
								})]
							})
						]
					})
				}), (0, react_jsx_runtime.jsx)("div", {
					id: `watcher-phase-body-${group.id}`,
					hidden: !open,
					children: observationMode === "itemized" ? (0, react_jsx_runtime.jsx)("div", {
						className: Watcher_module_css_default.stepTimeline,
						"data-observation-mode": "itemized",
						children: group.steps.map((step) => {
							const stepLive = isNow && running && step.items.some((item) => item.id === latestItemId && item.status === "running");
							const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now));
							const stepOpen = layerDisclosureOpen(disclosure, "step", step.id);
							const modelDuration = formatDuration((step.model === null ? null : modelStageMetrics(step.model, now))?.totalMs ?? null);
							const showStepTotal = stepDuration !== null && stepDuration !== modelDuration;
							const modelOpen = layerDisclosureOpen(disclosure, "model", step.id);
							const timelineEntries = stepTimelineEntries(step);
							return (0, react_jsx_runtime.jsxs)("section", {
								className: Watcher_module_css_default.overviewStep,
								"data-current": stepLive ? "" : void 0,
								"data-parallel": step.parallel ? "" : void 0,
								children: [(0, react_jsx_runtime.jsx)("header", {
									className: Watcher_module_css_default.overviewStepHeader,
									children: (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Watcher_module_css_default.stepToggle,
										"aria-expanded": stepOpen,
										"aria-controls": `watcher-step-body-${step.id}`,
										"aria-label": `步骤 ${step.step || "—"}，${step.executionCount} 次执行${stepDuration === null ? "" : `，耗时 ${stepDuration}`}，${stepOpen ? "收起步骤" : "展开步骤"}`,
										onClick: () => onToggleLayer("step", step.id),
										children: [
											(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
												size: 11,
												className: Watcher_module_css_default.stepChevron
											}),
											(0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.overviewStepLabel,
												children: ["步骤 ", step.step || "—"]
											}),
											(0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.overviewStepSignals,
												children: [
													step.executionCount > 0 ? (0, react_jsx_runtime.jsxs)("span", { children: [step.executionCount, " 次"] }) : null,
													step.parallel ? (0, react_jsx_runtime.jsxs)("span", {
														className: Watcher_module_css_default.parallelLabel,
														children: [step.executionCount, " 项并行"]
													}) : null,
													modelDuration === null ? null : (0, react_jsx_runtime.jsxs)("span", { children: ["模型 ", modelDuration] }),
													showStepTotal ? (0, react_jsx_runtime.jsxs)("span", { children: ["总 ", stepDuration] }) : null
												]
											})
										]
									})
								}), (0, react_jsx_runtime.jsx)("div", {
									id: `watcher-step-body-${step.id}`,
									className: Watcher_module_css_default.overviewOccurrences,
									hidden: !stepOpen,
									children: timelineEntries.map((entry) => {
										if (entry.kind === "model") return (0, react_jsx_runtime.jsx)(ModelStage, {
											trace: entry.trace,
											stepId: step.id,
											now,
											open: modelOpen,
											disclosure,
											onToggle: () => onToggleLayer("model", step.id),
											onToggleReasoning: (key) => onToggleReasoning(key, step.id)
										}, `model:${step.id}`);
										const item = entry.item;
										return (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
											item,
											occurrenceNumber: group.items.findIndex((candidate) => candidate.id === item.id) + 1,
											branch: step.parallel ? entry.occurrenceIndex + 1 : null,
											step: null,
											live: stepLive && item.id === latestItemId && item.status === "running",
											selected: selectedGroup && selectedItemId === item.id,
											now,
											onSelect: () => onSelectItem(item)
										}, item.id);
									})
								})]
							}, step.id);
						})
					}) : (0, react_jsx_runtime.jsxs)("div", {
						className: Watcher_module_css_default.analysisClusters,
						"data-observation-mode": "grouped",
						children: [modelSteps.length === 0 ? null : (0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.groupedModelStages,
							"data-open": groupedModelsOpen ? "" : void 0,
							children: [(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.groupedModelToggle,
								"aria-expanded": groupedModelsOpen,
								"aria-controls": `watcher-grouped-models-${group.id}`,
								onClick: () => onToggleLayer("model", groupedModelsKey),
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
									size: 11,
									className: Watcher_module_css_default.groupedModelChevron
								}), (0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: "模型阶段汇总" }), (0, react_jsx_runtime.jsxs)("small", { children: [modelSteps.length, " 个 Step · 按 Step 保留，不合并推理"] })] })]
							}), (0, react_jsx_runtime.jsx)("div", {
								id: `watcher-grouped-models-${group.id}`,
								className: Watcher_module_css_default.groupedModelList,
								hidden: !groupedModelsOpen,
								children: modelSteps.map((step) => {
									const modelOpen = layerDisclosureOpen(disclosure, "model", step.id);
									return (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.groupedModelStep,
										children: [(0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.groupedModelStepLabel,
											children: ["步骤 ", step.step || "—"]
										}), (0, react_jsx_runtime.jsx)(ModelStage, {
											trace: step.model,
											stepId: `${step.id}:grouped`,
											now,
											open: modelOpen,
											disclosure,
											onToggle: () => onToggleLayer("model", step.id),
											onToggleReasoning: (key) => onToggleReasoning(key, step.id)
										})]
									}, step.id);
								})
							})]
						}), clusters.map((cluster) => {
							if (cluster.executionCount === 1) {
								const item = cluster.items[0];
								const sourceStep = group.steps.find((step) => step.items.some((candidate) => candidate.id === item.id));
								const branch = sourceStep === void 0 ? null : branchNumberOf(sourceStep, item);
								return (0, react_jsx_runtime.jsx)("div", {
									className: Watcher_module_css_default.analysisSingleton,
									children: (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
										item,
										occurrenceNumber: group.items.findIndex((candidate) => candidate.id === item.id) + 1,
										branch,
										step: item.step,
										live: isNow && running && item.id === latestItemId && item.status === "running",
										selected: selectedGroup && selectedItemId === item.id,
										now,
										onSelect: () => onSelectItem(item)
									})
								}, cluster.id);
							}
							const clusterOpen = layerDisclosureOpen(disclosure, "cluster", cluster.id);
							const basisLabel = clusterBasisLabel(cluster);
							const outcome = clusterOutcomeSummary(cluster);
							const clusterMeta = [
								basisLabel,
								`${cluster.executionCount} 次执行`,
								`${cluster.stepCount} 个步骤`,
								outcome
							].filter((part) => part !== null && part !== "").join(" · ");
							return (0, react_jsx_runtime.jsxs)("section", {
								className: Watcher_module_css_default.analysisCluster,
								"data-open": clusterOpen ? "" : void 0,
								children: [(0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: Watcher_module_css_default.analysisClusterToggle,
									"aria-expanded": clusterOpen,
									"aria-controls": `watcher-cluster-body-${cluster.id}`,
									"aria-label": `${cluster.title}，${clusterMeta}，${clusterOpen ? "收起同类执行" : "展开同类执行"}`,
									onClick: () => onToggleLayer("cluster", cluster.id),
									children: [
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
											size: 11,
											className: Watcher_module_css_default.analysisClusterChevron
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.analysisClusterDotSlot,
											"aria-hidden": "true",
											children: (0, react_jsx_runtime.jsx)(StatusMark, {
												status: cluster.latestStatus,
												className: Watcher_module_css_default.analysisClusterDot
											})
										}),
										(0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.analysisClusterCopy,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.analysisClusterTitle,
												children: cluster.title
											}), (0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.analysisClusterMeta,
												children: clusterMeta
											})]
										}),
										cluster.executionCount > 1 ? (0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.analysisClusterCount,
											children: ["×", cluster.executionCount]
										}) : null
									]
								}), (0, react_jsx_runtime.jsx)("div", {
									id: `watcher-cluster-body-${cluster.id}`,
									className: Watcher_module_css_default.analysisClusterItems,
									hidden: !clusterOpen,
									children: cluster.items.map((item) => {
										const sourceStep = group.steps.find((step) => step.items.some((candidate) => candidate.id === item.id));
										const branch = sourceStep === void 0 ? null : branchNumberOf(sourceStep, item);
										return (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
											item,
											occurrenceNumber: group.items.findIndex((candidate) => candidate.id === item.id) + 1,
											branch,
											step: item.step,
											live: isNow && running && item.id === latestItemId && item.status === "running",
											selected: selectedGroup && selectedItemId === item.id,
											now,
											onSelect: () => onSelectItem(item)
										}, item.id);
									})
								})]
							}, cluster.id);
						})]
					})
				})]
			});
		}
		/** Native session-header utility: exact work picture, typed evidence, no steering. */
		function Watcher(props) {
			const conversation = props.useConversation((state) => state);
			const chat = conversation?.views?.get("chat");
			if (chat === void 0) return (0, react_jsx_runtime.jsx)("span", {
				role: "status",
				children: "Watcher 正在等待会话记录…"
			});
			return (0, react_jsx_runtime.jsx)(ReadyWatcher, {
				...props,
				chat,
				views: conversation.views
			});
		}
		function ReadyWatcher({ useSession, useSessionPendingInteraction, useProjection, sessionId, loadAllHistory, chat, views }) {
			const sessionSnapshot = useSession((state) => state);
			const pending = useSessionPendingInteraction((state) => state.get(sessionId));
			const snapshot = (0, react.useMemo)(() => ({
				views,
				chat,
				nodes: chat.legacy.nodes,
				turnTimings: chat.legacy.turnTimings,
				runningCalls: chat.legacy.runningCalls,
				pending: pending === void 0 ? [] : [pending],
				blank: sessionSnapshot.blank,
				running: sessionSnapshot.running,
				hasMore: sessionSnapshot.hasMore
			}), [
				chat,
				views,
				pending,
				sessionSnapshot.blank,
				sessionSnapshot.hasMore,
				sessionSnapshot.running
			]);
			const running = snapshot.running;
			const wholeSessionStats = useProjection("sessionStats");
			const wholeSessionInsights = useProjection("watcherInsights");
			const snapshotPicture = (0, react.useMemo)(() => foldSnapshot(snapshot, { running }), [snapshot, running]);
			const observedRef = (0, react.useRef)(null);
			const picture = (0, react.useMemo)(() => {
				const previous = observedRef.current?.sessionId === sessionId ? observedRef.current.picture : null;
				const next = previous === null ? snapshotPicture : mergeObservedPictures(previous, snapshotPicture);
				observedRef.current = {
					sessionId,
					picture: next
				};
				return next;
			}, [sessionId, snapshotPicture]);
			const performanceByTurn = (0, react.useMemo)(() => deriveTurnPerformance(snapshot.nodes, picture.turns), [snapshot.nodes, picture.turns]);
			const lastGroup = picture.nodes.at(-1);
			const lastGroupId = lastGroup?.id ?? null;
			const lastItem = lastGroup?.items.at(-1);
			const latestActivityKey = lastItem === void 0 ? lastGroupId : `${lastGroupId}:${lastItem.id}:${lastItem.seq}:${lastItem.status}:${lastItem.resultSeq ?? "open"}:${lastItem.resultTime ?? "open"}`;
			const [open, setOpen] = (0, react.useState)(false);
			const [ui, setUi] = (0, react.useState)(() => ({
				follow: true,
				unread: 0,
				selectedId: null
			}));
			const [selectedItemId, setSelectedItemId] = (0, react.useState)(null);
			const [observationMode, setObservationMode] = (0, react.useState)("itemized");
			const [disclosure, setDisclosure] = (0, react.useState)(createDisclosureState);
			const [historyLoad, setHistoryLoad] = (0, react.useState)({ kind: "idle" });
			const now = useLiveClock(open && picture.running);
			const followRef = (0, react.useRef)(createFollow());
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const railRef = (0, react.useRef)(null);
			const programmaticScrollRef = (0, react.useRef)(false);
			const historyAbortRef = (0, react.useRef)(null);
			const panelPosition = useAnchoredPanel({
				open,
				anchorRef: triggerRef,
				panelRef,
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			(0, react.useEffect)(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (!(event.target instanceof Node)) return;
					if (rootRef.current?.contains(event.target) === true) return;
					if (panelRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				const closeOnEscape = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					setOpen(false);
					triggerRef.current?.focus();
				};
				document.addEventListener("pointerdown", closeOutside);
				document.addEventListener("keydown", closeOnEscape);
				return () => {
					document.removeEventListener("pointerdown", closeOutside);
					document.removeEventListener("keydown", closeOnEscape);
				};
			}, [open]);
			(0, react.useLayoutEffect)(() => {
				historyAbortRef.current?.abort();
				historyAbortRef.current = null;
				setHistoryLoad({ kind: "idle" });
				followRef.current.reset();
				setUi(followRef.current.snapshot());
				setSelectedItemId(null);
				setDisclosure(resetDisclosureOverrides);
			}, [sessionId]);
			(0, react.useEffect)(() => () => {
				historyAbortRef.current?.abort();
			}, []);
			(0, react.useLayoutEffect)(() => {
				setUi(followRef.current.onPicture(picture));
			}, [latestActivityKey]);
			(0, react.useLayoutEffect)(() => {
				const rail = railRef.current;
				if (!rail || !open || !ui.follow) return;
				programmaticScrollRef.current = true;
				rail.scrollTop = rail.scrollHeight;
				const frame = requestAnimationFrame(() => {
					programmaticScrollRef.current = false;
				});
				return () => {
					cancelAnimationFrame(frame);
					programmaticScrollRef.current = false;
				};
			}, [
				ui.follow,
				latestActivityKey,
				observationMode,
				open
			]);
			const selected = ui.selectedId === null ? void 0 : picture.nodes.find((group) => group.id === ui.selectedId);
			const latestTurnNumber = picture.turns.at(-1)?.turn ?? null;
			const totalTurnCount = Math.max(picture.turnCount, wholeSessionStats?.turns ?? 0);
			const totalStepCount = Math.max(picture.stepCount, wholeSessionStats?.steps ?? 0);
			const historyProgress = totalStepCount > picture.stepCount ? `${picture.stepCount}/${totalStepCount} 个步骤` : totalTurnCount > picture.turnCount ? `${picture.turnCount}/${totalTurnCount} 个对话轮次` : `${picture.stepCount} 个步骤已载入`;
			const hasEdgeAlert = picture.pendingCount > 0 || picture.now.status === "failure" || picture.now.status === "interrupted";
			const summaryState = picture.pendingCount > 0 ? "等待确认" : picture.running ? "正在执行" : picture.now.status === "failure" ? "执行失败" : picture.now.status === "interrupted" ? "已中断" : picture.nodes.length > 0 ? "就绪" : "待命";
			const nowLabel = picture.now.label || (picture.nodes.length > 0 ? "执行路径已就绪" : "等待指令");
			const selectItem = (group, item) => {
				setUi(followRef.current.onSelect(group.id));
				setSelectedItemId(item.id);
			};
			const onRailScroll = () => {
				if (programmaticScrollRef.current) return;
				const rail = railRef.current;
				if (rail === null) return;
				const atBottom = rail.scrollHeight - rail.scrollTop - rail.clientHeight < 24;
				setUi(followRef.current.onScroll({ atBottom }));
			};
			const backToLatest = () => {
				programmaticScrollRef.current = true;
				setUi(followRef.current.backToLatest());
			};
			const pinForDisclosure = () => {
				if (ui.follow) setUi(followRef.current.setFollow(false));
			};
			const chooseObservationMode = (mode) => {
				if (mode === observationMode) return;
				if (ui.follow) programmaticScrollRef.current = true;
				setObservationMode(mode);
			};
			const chooseDepth = (depth) => {
				if (depth === disclosure.depth) return;
				pinForDisclosure();
				setDisclosure(chooseDisclosureDepth(depth));
			};
			const startHistoryLoad = () => {
				if (historyLoad.kind === "loading" || historyLoad.kind === "complete") return;
				historyAbortRef.current?.abort();
				const controller = new AbortController();
				historyAbortRef.current = controller;
				setHistoryLoad({ kind: "loading" });
				loadAllHistory(controller.signal).then((result) => {
					if (historyAbortRef.current !== controller) return;
					if (result.kind === "blocked") setHistoryLoad({
						kind: "error",
						message: result.reason === "busy" ? "主会话正在载入历史，请稍后重试" : result.reason === "page-limit" ? "历史页数超出安全上限，请分次重试" : "历史分页没有继续前进，请重试"
					});
					else if (result.kind === "complete") setHistoryLoad({ kind: "complete" });
					else setHistoryLoad({ kind: "idle" });
				}).catch((error) => {
					if (historyAbortRef.current !== controller || controller.signal.aborted) return;
					setHistoryLoad({
						kind: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				}).finally(() => {
					if (historyAbortRef.current === controller) historyAbortRef.current = null;
				});
			};
			(0, react.useEffect)(() => {
				if (!open || !snapshot.hasMore || historyLoad.kind !== "idle") return;
			}, [
				open,
				snapshot.hasMore,
				historyLoad.kind,
				sessionId
			]);
			(0, react.useEffect)(() => {
				if (historyLoad.kind !== "complete" || snapshot.hasMore) return;
				setHistoryLoad({ kind: "idle" });
			}, [historyLoad.kind, snapshot.hasMore]);
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: Watcher_module_css_default.root,
				"data-dsh-watcher": "header",
				children: [(0, react_jsx_runtime.jsx)("button", {
					ref: triggerRef,
					type: "button",
					className: Watcher_module_css_default.trigger,
					"data-open": open ? "" : void 0,
					"data-live": picture.running && picture.nodes.length > 0 ? "" : void 0,
					"data-alert": hasEdgeAlert ? "" : void 0,
					"aria-expanded": open,
					"aria-label": `Watcher，${summaryState}`,
					title: "Watcher",
					onClick: () => setOpen((value) => !value),
					children: (0, react_jsx_runtime.jsx)(IconLivingEye, {})
				}), open ? (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: Watcher_module_css_default.menu,
					style: panelPosition ?? UNPLACED_PANEL_STYLE,
					role: "dialog",
					"aria-modal": "false",
					"aria-label": "Watcher 工作图",
					"data-dsh-watcher-panel": "",
					"data-ud-motion": "watcher-panel-enter",
					children: [selected === void 0 ? null : (0, react_jsx_runtime.jsx)(ExecutionInspector, {
						group: selected,
						selectedItemId,
						live: picture.running && selected.id === lastGroupId,
						now,
						onSelectItem: setSelectedItemId,
						onBack: () => {
							backToLatest();
							setSelectedItemId(null);
						}
					}), (0, react_jsx_runtime.jsxs)("section", {
						className: Watcher_module_css_default.workPicture,
						"aria-label": "Agent 工作路径",
						"data-ud-check": "watcher-work-picture",
						"data-ud-role": "panel",
						children: [
							(0, react_jsx_runtime.jsxs)("header", {
								className: Watcher_module_css_default.pictureHeader,
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.nowBlock,
									"aria-live": "polite",
									children: [
										picture.running || hasEdgeAlert || summaryState !== "就绪" ? (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.eyebrow,
											"data-alert": hasEdgeAlert ? "" : void 0,
											children: (0, react_jsx_runtime.jsx)("span", { children: summaryState })
										}) : null,
										(0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.now,
											title: picture.running ? nowLabel : "DSH-Watcher",
											children: picture.running ? nowLabel : "DSH-Watcher"
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.summary,
											children: [
												(0, react_jsx_runtime.jsx)("span", { children: snapshot.hasMore && totalTurnCount > picture.turnCount ? `已载入 ${picture.turnCount}/${totalTurnCount} 轮` : `${picture.turnCount} 轮` }),
												(0, react_jsx_runtime.jsx)("span", { children: snapshot.hasMore && totalStepCount > picture.stepCount ? `${picture.stepCount}/${totalStepCount} 步` : `${picture.stepCount} 步` }),
												(0, react_jsx_runtime.jsxs)("span", { children: [picture.actionCount, " 次执行"] }),
												snapshot.hasMore || historyLoad.kind === "loading" || historyLoad.kind === "error" ? (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: Watcher_module_css_default.loadAllInlineBtn,
													onClick: startHistoryLoad,
													disabled: historyLoad.kind === "loading",
													children: historyLoad.kind === "loading" ? "正在补齐历史…" : historyLoad.kind === "error" ? "重试载入" : "载入全部历史 →"
												}) : null,
												historyLoad.kind === "loading" || historyLoad.kind === "error" ? (0, react_jsx_runtime.jsx)("span", {
													role: "status",
													children: historyLoad.kind === "error" ? historyLoad.message : `已载入 ${historyProgress}`
												}) : null
											]
										})
									]
								}), (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									className: Watcher_module_css_default.follow,
									active: ui.follow,
									"aria-pressed": ui.follow,
									"aria-label": ui.follow ? "停止跟随最新工作" : "跟随最新工作",
									onClick: () => {
										if (!ui.follow) programmaticScrollRef.current = true;
										setUi(followRef.current.setFollow(!ui.follow));
									},
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 }), ui.follow ? "自动跟随" : "浏览历史"]
								})]
							}),
							(0, react_jsx_runtime.jsx)(SessionInsights, {
								value: wholeSessionInsights,
								now,
								running: picture.running,
								waiting: picture.pendingCount > 0,
								onEvidence: (e) => {
									pinForDisclosure();
									setDisclosure(chooseDisclosureDepth("detail"));
									requestAnimationFrame(() => document.getElementById("watcher-turn-" + e.turn)?.scrollIntoView({ block: "nearest" }));
								}
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.viewToolbar,
								"aria-label": "路径视图设置",
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.viewControl,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.viewToolbarLabel,
										children: "组织"
									}), (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.viewMode,
										role: "group",
										"aria-label": "路径组织方式",
										children: [(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": observationMode === "itemized" ? "" : void 0,
											"aria-pressed": observationMode === "itemized",
											title: "按时间顺序展示每个步骤和每次执行",
											onClick: () => chooseObservationMode("itemized"),
											children: "逐项"
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": observationMode === "grouped" ? "" : void 0,
											"aria-pressed": observationMode === "grouped",
											title: "按同一目标或完全相同的指令归类，展开仍可查看原始执行",
											onClick: () => chooseObservationMode("grouped"),
											children: "归类"
										})]
									})]
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.viewControl,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.viewToolbarLabel,
										children: "层级"
									}), (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.viewMode,
										role: "group",
										"aria-label": "路径展开深度",
										children: [(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": disclosure.depth === "overview" ? "" : void 0,
											"aria-pressed": disclosure.depth === "overview",
											title: "展开当前轮次，展示阶段概览；阶段内部保持收起",
											onClick: () => chooseDepth("overview"),
											children: "概览"
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": disclosure.depth === "detail" ? "" : void 0,
											"aria-pressed": disclosure.depth === "detail",
											title: "展开所有轮次、阶段、步骤、模型与推理记录",
											onClick: () => chooseDepth("detail"),
											children: "详情"
										})]
									})]
								})]
							}),
							!ui.follow && ui.unread > 0 ? (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.unread,
								onClick: backToLatest,
								children: [
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 }),
									ui.unread,
									" 条新进展 · 查看最新"
								]
							}) : null,
							picture.nodes.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.empty,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.emptyEye,
										"aria-hidden": "true",
										children: (0, react_jsx_runtime.jsx)(IconLivingEye, { size: 22 })
									}),
									(0, react_jsx_runtime.jsx)("strong", { children: "还没有工作记录" }),
									(0, react_jsx_runtime.jsx)("span", { children: "第一轮对话开始后，路径会从这里生长" })
								]
							}) : (0, react_jsx_runtime.jsx)("div", {
								ref: railRef,
								className: Watcher_module_css_default.railViewport,
								onScroll: onRailScroll,
								children: (0, react_jsx_runtime.jsx)("div", {
									className: Watcher_module_css_default.turns,
									children: picture.turns.map((turn) => {
										const isLatestTurn = turn.turn === latestTurnNumber;
										const turnState = overviewStateOf(turn.status, isLatestTurn);
										const automaticDefaultOpen = turnNeedsDefaultDisclosure(turnState, isLatestTurn);
										const turnOpen = turnDisclosureOpen(disclosure, turn.turn, automaticDefaultOpen);
										const turnTitle = turn.turn === 0 ? "会话准备" : `对话轮次 ${turn.turn}`;
										const turnSummary = turnOverviewSummary(turn);
										const performance = performanceByTurn.get(turn.turn);
										const duration = turnDuration(turn, isLatestTurn && picture.running, now);
										const tokenSpeed = performance?.throughput.kind === "measured" ? `${formatTokensPerSecond(performance.throughput.tokensPerSecond)} tok/s` : null;
										const durationAria = duration === null ? "" : duration.kind === "exact" ? `，总耗时 ${duration.value}` : `，已记录 ${duration.value}，开头未载入`;
										const secondaryPerformance = [duration?.kind === "partial" ? "开头未载入" : null, tokenSpeed].filter((value) => value !== null).join(" · ");
										return (0, react_jsx_runtime.jsxs)("section", {
											className: Watcher_module_css_default.turn,
											"aria-labelledby": `watcher-turn-${turn.turn}`,
											children: [(0, react_jsx_runtime.jsx)("header", {
												className: Watcher_module_css_default.turnHeader,
												children: (0, react_jsx_runtime.jsx)("h2", {
													id: `watcher-turn-${turn.turn}`,
													children: (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: Watcher_module_css_default.turnToggle,
														"aria-expanded": turnOpen,
														"aria-controls": `watcher-turn-body-${turn.turn}`,
														"aria-label": `${turnTitle}，${OVERVIEW_STATE_LABEL[turnState]}，${turnSummary}${durationAria}${tokenSpeed === null ? "" : `，生成速度 ${tokenSpeed}`}，${turnOpen ? "收起轮次" : "展开轮次"}`,
														title: turnOpen ? "收起此轮次；新进展仍会继续更新" : "展开此轮次",
														onClick: () => {
															pinForDisclosure();
															setDisclosure((current) => toggleTurnDisclosure(current, turn.turn, automaticDefaultOpen));
														},
														children: [
															(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
																size: 13,
																className: Watcher_module_css_default.turnChevron
															}),
															(0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.turnCopy,
																children: [(0, react_jsx_runtime.jsxs)("span", {
																	className: Watcher_module_css_default.turnTitleLine,
																	children: [(0, react_jsx_runtime.jsx)("span", {
																		className: Watcher_module_css_default.turnTitle,
																		children: turnTitle
																	}), showOverviewTag(turnState) ? (0, react_jsx_runtime.jsx)("span", {
																		className: Watcher_module_css_default.overviewTag,
																		"data-state": turnState,
																		children: OVERVIEW_STATE_LABEL[turnState]
																	}) : null]
																}), (0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnSummary,
																	children: turnSummary
																})]
															}),
															(0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.turnPerformance,
																children: [(0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnDuration,
																	children: duration === null ? OVERVIEW_STATE_LABEL[turnState] : duration.kind === "exact" ? `总 ${duration.value}` : `已记录 ${duration.value}`
																}), secondaryPerformance === "" ? null : (0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnSpeed,
																	children: secondaryPerformance
																})]
															})
														]
													})
												})
											}), (0, react_jsx_runtime.jsxs)("div", {
												id: `watcher-turn-body-${turn.turn}`,
												className: Watcher_module_css_default.turnBody,
												hidden: !turnOpen,
												children: [performance === void 0 ? null : (0, react_jsx_runtime.jsx)(TurnMetricStrip, { performance }), (0, react_jsx_runtime.jsxs)("div", {
													className: Watcher_module_css_default.groupRail,
													children: [(0, react_jsx_runtime.jsx)("span", {
														className: Watcher_module_css_default.railLine,
														"aria-hidden": "true"
													}), turn.groups.map((group) => {
														const isNow = group.id === lastGroupId;
														const selectedGroup = ui.selectedId === group.id;
														const phaseOpen = layerDisclosureOpen(disclosure, "phase", group.id);
														return (0, react_jsx_runtime.jsx)(PhaseOverview, {
															group,
															isNow,
															running: picture.running,
															now,
															selectedGroup,
															selectedItemId,
															observationMode,
															open: phaseOpen,
															disclosure,
															onToggle: () => {
																pinForDisclosure();
																setDisclosure((current) => toggleLayerDisclosure(current, "phase", group.id));
															},
															onToggleLayer: (layer, key) => {
																pinForDisclosure();
																setDisclosure((current) => toggleLayerDisclosure(current, layer, key));
															},
															onToggleReasoning: (key, modelKey) => {
																pinForDisclosure();
																setDisclosure((current) => {
																	return toggleLayerDisclosure(layerDisclosureOpen(current, "reasoning", key) ? current : setLayerDisclosure(current, "model", modelKey, true), "reasoning", key);
																});
															},
															onSelectItem: (item) => selectItem(group, item)
														}, group.id);
													})]
												})]
											})]
										}, turn.turn);
									})
								})
							})
						]
					})]
				}), document.body) : null]
			});
		}
		//#endregion
		//#region lib/types/client/model-trace-definition.js
		const modelTraceDefinition = {
			kind: "dsh-watcher-model-stage",
			match: (event) => {
				const normalized = modelTraceEventOf(event);
				if (normalized === null) return null;
				return {
					id: `${normalized.turn}:${normalized.step}`,
					role: normalized.kind === "step-start" ? "start" : "update"
				};
			},
			start: (_context, match) => {
				const event = modelTraceEventOf(match.event);
				if (event === null || event.kind !== "step-start") throw new Error("dsh-watcher-model-stage start requires step/start");
				return startModelStepTrace(event);
			},
			update: (context, match) => {
				const event = modelTraceEventOf(match.event);
				return event === null ? context.state : updateModelStepTrace(context.state, event);
			},
			publication: (match) => {
				if (match.event.type === "step/start") return "none";
				if (match.event.type !== "assistant/live-chunk") return "immediate";
				return match.event.data.chunk.type === "usage" ? "none" : "animation-frame";
			},
			buildLocationData: (context, scope) => {
				if (scope !== "step" || context.state === void 0) return null;
				return {
					kind: "step",
					turn: context.state.turn,
					step: context.state.step,
					key: "dsh-watcher-model-stage",
					value: context.state
				};
			}
		};
		/** Register the Step-scoped, read-only model-stage projection. */
		function registerModelTraceDefinition(ctx) {
			ctx.uiConversation.events.register(modelTraceDefinition);
		}
		//#endregion
		//#region lib/types/client/index.js
		const name = "dsh-watcher-client";
		const inject = [
			"slots",
			"sessions",
			"uiConversation"
		];
		/**
		* Native session-header utility. Order 50 sits after Session log (0)
		* and before the files-panel toggle (110). No overlay glyph.
		*/
		function apply(ctx) {
			registerModelTraceDefinition(ctx);
			ctx.inject(["remote", "remote.session"], (c) => {
				c.slots.inject("settings.section", () => c.slots.register({
					name: "settings.section",
					id: "watcher-insights",
					order: 85,
					label: "Watcher",
					inject: () => ({ remote: c.remote })
				}, InsightsSettings));
			});
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-watcher",
				order: 50,
				label: "Watcher",
				inject: (sessionId) => {
					const session = ctx.sessions.binding?.(sessionId)?.session;
					if (session === void 0) throw new Error(`dsh-watcher: session "${sessionId}" is unavailable`);
					return { loadAllHistory: (signal) => loadCompleteHistory({
						signal,
						loadOlder: () => session.loadOlder(),
						read: () => {
							const sessionSnapshot = session.getSnapshot();
							const chat = ctx.uiConversation.binding(sessionId).snapshot.getSnapshot().views.get("chat");
							if (chat === void 0) throw new Error("dsh-watcher: Chat conversation target is unavailable");
							const firstNode = chat.legacy.nodes[0];
							const firstTurn = chat.timeline.turnOrder[0];
							return {
								hasMore: sessionSnapshot.hasMore,
								loadingOlder: sessionSnapshot.loadingOlder,
								headKey: `${firstTurn ?? "none"}:${firstNode?.seq ?? "none"}:${chat.legacy.nodes.length}`
							};
						}
					}) };
				}
			}, Watcher));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map