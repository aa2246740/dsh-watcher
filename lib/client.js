window.__ModuleLoader__.load({
	id: "dsh-watcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/hub/history.ts
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
		//#region src/hub/follow.ts
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
		//#region src/hub/aggregation.ts
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
		//#region src/observation/model-trace.ts
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
			if (value.type === "assistant/message") return {
				...location,
				kind: "message",
				reasoningText: reasoningTextOf(data.message),
				reasoningTokens: reasoningTokensOf(data.usage)
			};
			if (value.type !== "assistant/chunk" || !isRecord$1(data.chunk) || typeof data.chunk.type !== "string") return null;
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
		/** Fold one normalized event without discarding reasoning from a retried attempt. */
		function updateModelStepTrace(trace, event) {
			if (!sameStep(trace, event) || event.kind === "step-start") return trace;
			const current = {
				...trace,
				lastSeq: Math.max(trace.lastSeq, event.seq)
			};
			const attempt = trace.attempts.at(-1);
			if (attempt === void 0) return trace;
			if (event.kind === "usage") return event.reasoningTokens === null ? current : {
				...current,
				reasoningTokens: event.reasoningTokens
			};
			if (event.kind === "reasoning-delta") {
				if (attempt.kind !== "running") return current;
				const fragment = {
					seq: event.seq,
					time: event.time,
					text: event.text
				};
				return {
					...current,
					attempts: replaceLast(trace.attempts, {
						...attempt,
						firstTokenTime: attempt.firstTokenTime ?? event.time,
						firstReasoningTime: attempt.firstReasoningTime ?? event.time,
						lastReasoningTime: event.time,
						reasoningText: attempt.reasoningText + event.text,
						fragments: [...attempt.fragments, fragment]
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
			if (event.kind === "message") {
				const reasoningTokens = event.reasoningTokens ?? trace.reasoningTokens;
				if (attempt.kind !== "running") return {
					...current,
					reasoningTokens
				};
				return {
					...current,
					reasoningTokens,
					attempts: replaceLast(trace.attempts, {
						...attempt,
						kind: "complete",
						endedAt: event.time,
						reasoningText: event.reasoningText ?? attempt.reasoningText
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
		function visibleReasoningDuration(trace, now) {
			let sampled = false;
			let total = 0;
			for (const attempt of trace.attempts) {
				if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) continue;
				sampled = true;
				const end = attempt.kind === "running" && attempt.firstOutputTime === null ? now : attempt.lastReasoningTime;
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
			const outputStart = finalReasoning ?? last?.firstOutputTime ?? last?.firstTokenTime ?? null;
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
		//#region src/observation/fold.ts
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
			const title = source === "user" ? "用户提出任务" : source === "steering" ? "用户补充要求" : "Agent 给出答复";
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
				callView: node.callView,
				resultView: node.resultView,
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
				callView: call.callView,
				resultView: null,
				orphan: false
			};
		}
		/** ConversationSnapshot → occurrence-preserving tool pairs. */
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
				}, "waiting", name, null, pending.payload));
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
				answer: "给出答复",
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
		//#region \0dshx-css-module:/Users/wu/Documents/Codex/2026-08-15/bang/deepseek-harness-rc8/my-plugins/dsh-watcher/src/client/Watcher.module.css.mjs
		const css = "._8BDMSW_root{--watcher-panel-max-height:min(680px, calc(100vh - 112px));--watcher-motion-fast:.14s;--watcher-motion-panel:.18s;--watcher-ease-out:cubic-bezier(.2, .8, .2, 1);position:relative}._8BDMSW_trigger{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color var(--watcher-motion-fast) ease, border-color var(--watcher-motion-fast) ease, color var(--watcher-motion-fast) ease, transform .1s ease;background:0 0;border-radius:999px;justify-content:center;align-items:center;padding:0;display:inline-flex}._8BDMSW_trigger:hover:not(:disabled),._8BDMSW_trigger:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_trigger:active{transform:scale(.96)}._8BDMSW_trigger:focus-visible{outline:2px solid var(--dsw-static-deepseek-450);outline-offset:2px}._8BDMSW_trigger[data-open]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-static-deepseek-450)}._8BDMSW_trigger[data-live]{color:var(--dsw-static-deepseek-450)}._8BDMSW_trigger[data-alert]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_eye,._8BDMSW_eyeBlink,._8BDMSW_eyePupil{transform-box:fill-box;transform-origin:50%;display:block}._8BDMSW_trigger[data-live] ._8BDMSW_eyePupil{animation:_8BDMSW_watcher-eye-scan 2.8s var(--watcher-ease-out) infinite}._8BDMSW_trigger[data-live] ._8BDMSW_eyeBlink{animation:5.2s ease-in-out infinite _8BDMSW_watcher-eye-blink}@keyframes _8BDMSW_watcher-eye-scan{0%,12%,92%,to{transform:translate(0)}30%{transform:translate(1.35px)}54%{transform:translate(-1.2px)}74%{transform:translate(.8px)}}@keyframes _8BDMSW_watcher-eye-blink{0%,42%,44.5%,to{transform:scaleY(1)}43.2%{transform:scaleY(.12)}}._8BDMSW_menu{z-index:1100;--watcher-panel-max-height:min(680px, calc(100vh - 24px));--watcher-motion-fast:.14s;--watcher-motion-panel:.18s;--watcher-ease-out:cubic-bezier(.2, .8, .2, 1);box-sizing:border-box;max-width:calc(100vw - 24px);max-height:var(--watcher-panel-max-height);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);transform-origin:100% 0;animation:_8BDMSW_watcher-panel-enter var(--watcher-motion-panel) var(--watcher-ease-out);isolation:isolate;border-radius:12px;align-items:stretch;font-size:13px;line-height:20px;display:flex;position:fixed;top:auto;left:auto;right:auto;overflow:hidden}@keyframes _8BDMSW_watcher-panel-enter{0%{opacity:0;transform:translateY(-5px)scale(.992)}to{opacity:1;transform:translateY(0)scale(1)}}._8BDMSW_workPicture{width:374px;min-width:0;min-height:290px;max-height:var(--watcher-panel-max-height);background:var(--dsw-specific-menu);flex-direction:column;flex:none;display:flex}._8BDMSW_pictureHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 14px 14px 16px;display:flex}._8BDMSW_nowBlock{min-width:0}._8BDMSW_eyebrow{color:var(--dsw-static-deepseek-450);text-overflow:ellipsis;white-space:nowrap;align-items:center;gap:5px;font-size:12px;font-weight:500;line-height:18px;display:flex;overflow:hidden}._8BDMSW_eyebrow[data-alert]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_now{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:17px;font-weight:600;line-height:24px;overflow:hidden}._8BDMSW_summary{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12px;line-height:18px;display:flex}._8BDMSW_summary span+span:before{content:\"·\";color:var(--dsw-alias-label-dimmed);margin:0 6px}._8BDMSW_summary [data-partial]{color:var(--dsw-alias-state-warn-primary)}._8BDMSW_sessionTiming{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;padding:9px 10px;display:grid}._8BDMSW_sessionTimingMetric{min-width:0;padding:0 8px}._8BDMSW_sessionTimingMetric+._8BDMSW_sessionTimingMetric{border-left:1px solid var(--dsw-alias-border-l2)}._8BDMSW_sessionTimingMetric dt,._8BDMSW_sessionTimingMetric dd{text-overflow:ellipsis;white-space:nowrap;margin:0;overflow:hidden}._8BDMSW_sessionTimingMetric dt{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._8BDMSW_sessionTimingMetric dd{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;line-height:19px}._8BDMSW_viewToolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);flex-wrap:wrap;flex:none;justify-content:space-between;align-items:center;gap:6px 14px;min-height:42px;padding:6px 14px;display:flex}._8BDMSW_viewControl{align-items:center;gap:6px;min-width:0;display:flex}._8BDMSW_viewToolbarLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;line-height:18px}._8BDMSW_viewMode{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:7px;flex:none;grid-template-columns:repeat(2,minmax(42px,1fr));padding:2px;display:inline-grid}._8BDMSW_viewMode button{min-height:26px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:5px;padding:2px 9px;font-size:12px;line-height:18px}._8BDMSW_viewMode button:hover{color:var(--dsw-alias-label-primary)}._8BDMSW_viewMode button[data-active]{background:var(--dsw-specific-menu);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}._8BDMSW_historyNotice{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;align-items:center;gap:10px;min-height:48px;padding:7px 14px 8px 16px;display:flex}._8BDMSW_historyNoticeCopy{flex-direction:column;flex:1;min-width:0;display:flex}._8BDMSW_historyNoticeCopy strong{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;line-height:18px;overflow:hidden}._8BDMSW_historyNoticeCopy span{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;overflow:hidden}._8BDMSW_historyNotice button{border:1px solid var(--dsw-alias-button-ghost-active-border);background:var(--dsw-specific-menu);min-height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;flex:none;padding:3px 9px;font-size:12px;line-height:18px}._8BDMSW_historyNotice button:hover:not(:disabled){background:var(--dsw-alias-button-ghost-active-hover)}._8BDMSW_historyNotice button:disabled{color:var(--dsw-alias-label-tertiary);cursor:progress}._8BDMSW_follow{white-space:nowrap;flex:none;margin-top:2px}._8BDMSW_unread{border:1px solid var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);width:calc(100% - 28px);min-height:34px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:8px;justify-content:center;align-items:center;gap:6px;margin:10px 14px 0;font-size:12px;display:inline-flex}._8BDMSW_unread:hover{background:var(--dsw-alias-button-ghost-active-hover)}._8BDMSW_unread:focus-visible,._8BDMSW_turnToggle:focus-visible,._8BDMSW_phaseToggle:focus-visible,._8BDMSW_stepToggle:focus-visible,._8BDMSW_analysisClusterToggle:focus-visible,._8BDMSW_modelStageToggle:focus-visible,._8BDMSW_reasoningToggle:focus-visible,._8BDMSW_groupedModelToggle:focus-visible,._8BDMSW_viewMode button:focus-visible,._8BDMSW_historyNotice button:focus-visible,._8BDMSW_overviewOccurrence:focus-visible,._8BDMSW_inspectorBack:focus-visible,._8BDMSW_occurrence:focus-visible,._8BDMSW_tab:focus-visible,._8BDMSW_copyRaw:focus-visible{outline:2px solid var(--dsw-static-deepseek-450);outline-offset:-2px}._8BDMSW_railViewport{overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}._8BDMSW_turns{padding:8px 10px 18px}._8BDMSW_turn+._8BDMSW_turn{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}._8BDMSW_turnHeader{padding:0 2px 2px}._8BDMSW_turnHeader h2{margin:0}._8BDMSW_turnToggle{box-sizing:border-box;width:100%;min-height:50px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px 8px;display:grid}._8BDMSW_turnToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_turnChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out);transform:rotate(0)}._8BDMSW_turnToggle[aria-expanded=true] ._8BDMSW_turnChevron{transform:rotate(90deg)}._8BDMSW_turnCopy{flex-direction:column;min-width:0;display:flex}._8BDMSW_turnTitleLine{align-items:center;gap:6px;min-width:0;display:flex}._8BDMSW_turnTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px}._8BDMSW_turnSummary,._8BDMSW_turnDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;font-weight:400;line-height:18px}._8BDMSW_turnSummary{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._8BDMSW_turnPerformance{white-space:nowrap;flex-direction:column;align-items:flex-end;min-width:62px;display:flex}._8BDMSW_turnDuration{white-space:nowrap}._8BDMSW_turnSpeed{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;font-weight:500;line-height:18px}._8BDMSW_turnMetrics{background:var(--dsw-alias-bg-layer-2);border-radius:7px;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:2px 8px 9px 36px;padding:7px 9px;display:grid}._8BDMSW_turnMetric{min-width:0}._8BDMSW_turnMetric dt,._8BDMSW_turnMetric dd{text-overflow:ellipsis;white-space:nowrap;margin:0;overflow:hidden}._8BDMSW_turnMetric dt{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}._8BDMSW_turnMetric dd{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;line-height:19px}._8BDMSW_turnBody[hidden]{display:none}._8BDMSW_groupRail{padding-left:18px;position:relative}._8BDMSW_railLine{background:var(--dsw-alias-border-l2);pointer-events:none;width:1px;position:absolute;top:18px;bottom:18px;left:23px}._8BDMSW_phase{z-index:1;box-sizing:border-box;width:100%;padding:3px 0 11px;position:relative}._8BDMSW_phase+._8BDMSW_phase{margin-top:4px}._8BDMSW_phaseHeader{position:relative}._8BDMSW_phaseToggle{box-sizing:border-box;width:100%;min-height:42px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:7px;grid-template-columns:10px 12px minmax(0,1fr);align-items:center;gap:6px;padding:3px 8px 3px 0;display:grid;position:relative}._8BDMSW_phaseToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_phase[data-now]>._8BDMSW_phaseHeader ._8BDMSW_phaseToggle{background:var(--dsw-alias-bg-layer-2);border-radius:7px}._8BDMSW_phaseChevron,._8BDMSW_stepChevron,._8BDMSW_analysisClusterChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out);transform:rotate(0)}._8BDMSW_phaseToggle[aria-expanded=true] ._8BDMSW_phaseChevron,._8BDMSW_stepToggle[aria-expanded=true] ._8BDMSW_stepChevron,._8BDMSW_analysisClusterToggle[aria-expanded=true] ._8BDMSW_analysisClusterChevron{transform:rotate(90deg)}._8BDMSW_phaseMarker{box-sizing:border-box;background:var(--dsw-alias-label-tertiary);width:10px;height:10px;box-shadow:0 0 0 4px var(--dsw-specific-menu);border-radius:50%;display:block;position:relative}._8BDMSW_phaseMarker[data-state=active],._8BDMSW_phaseMarker[data-state=current]{background:var(--dsw-static-deepseek-450)}._8BDMSW_phaseMarker[data-state=waiting]{background:var(--dsw-alias-state-warn-primary)}._8BDMSW_phaseMarker[data-state=failure],._8BDMSW_phaseMarker[data-state=interrupted]{background:var(--dsw-alias-state-error-primary)}._8BDMSW_phaseMarker[data-state=partial]{border:1px dashed var(--dsw-alias-label-tertiary);background:var(--dsw-specific-menu)}._8BDMSW_neutralDot{border:1px solid var(--dsw-alias-label-tertiary);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:10px;height:10px;display:inline-block;position:relative}._8BDMSW_neutralDot[data-status=unknown]{background:var(--dsw-specific-menu);border-style:dashed}._8BDMSW_phaseCopy,._8BDMSW_occurrenceCopy{flex-direction:column;min-width:0;display:flex}._8BDMSW_phaseTitleLine{align-items:center;gap:6px;min-width:0;display:flex}._8BDMSW_phaseTitle{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:550;line-height:21px;overflow:hidden}._8BDMSW_phaseMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_groupBadges{flex:none;align-items:center;gap:4px;display:inline-flex}._8BDMSW_groupBadges span,._8BDMSW_overviewTag,._8BDMSW_patternLabel,._8BDMSW_parallelLabel{border:1px solid var(--dsw-alias-border-l2);min-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;border-radius:999px;align-items:center;padding:0 5px;font-size:11px;font-weight:500;line-height:16px;display:inline-flex}._8BDMSW_groupBadges [data-kind=retry]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_groupBadges [data-kind=parallel],._8BDMSW_overviewTag[data-state=active],._8BDMSW_overviewTag[data-state=current]{color:var(--dsw-static-deepseek-450)}._8BDMSW_overviewTag[data-state=waiting]{color:var(--dsw-alias-state-warn-primary)}._8BDMSW_overviewTag[data-state=failure],._8BDMSW_overviewTag[data-state=interrupted]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_overviewTag[data-state=partial]{color:var(--dsw-alias-label-tertiary)}._8BDMSW_occurrenceChevron{color:var(--dsw-alias-label-dimmed);opacity:0;transition:opacity var(--watcher-motion-fast) ease, transform var(--watcher-motion-fast) ease;flex:none;transform:translate(-2px)}._8BDMSW_occurrence:hover ._8BDMSW_occurrenceChevron,._8BDMSW_occurrence[data-selected] ._8BDMSW_occurrenceChevron,._8BDMSW_occurrence:focus-visible ._8BDMSW_occurrenceChevron{opacity:1;transform:translate(0)}._8BDMSW_stepTimeline{border-left:1px solid var(--dsw-alias-border-l2);margin:1px 8px 0 28px;padding-left:11px;position:relative}._8BDMSW_overviewStep{min-width:0;position:relative}._8BDMSW_overviewStep+._8BDMSW_overviewStep{margin-top:10px;padding-top:8px}._8BDMSW_overviewStep:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:13px;left:-12px}._8BDMSW_overviewStepHeader{min-height:29px}._8BDMSW_stepToggle{box-sizing:border-box;width:100%;min-height:29px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:5px;padding:2px 4px 2px 0;display:grid}._8BDMSW_stepToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_overviewStepLabel,._8BDMSW_overviewStepSignals{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}._8BDMSW_overviewStepLabel{min-width:0;font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._8BDMSW_overviewStepSignals{white-space:nowrap;align-items:center;gap:6px;display:inline-flex}._8BDMSW_overviewOccurrences{position:relative}._8BDMSW_overviewStep[data-parallel] ._8BDMSW_overviewOccurrences{border-left:1px solid var(--dsw-static-deepseek-450);padding-left:5px}._8BDMSW_modelStage{border-left:2px solid var(--dsw-static-deepseek-450);background:var(--dsw-alias-bg-layer-2);border-radius:0 7px 7px 0;min-width:0;margin:2px 2px 7px;overflow:hidden}._8BDMSW_modelStage[data-live]{box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}._8BDMSW_modelStageToggle{box-sizing:border-box;width:100%;min-height:42px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px 8px minmax(0,1fr);align-items:center;gap:7px;padding:5px 9px 5px 7px;display:grid}._8BDMSW_modelStageToggle:hover,._8BDMSW_reasoningToggle:hover,._8BDMSW_groupedModelToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_modelStageChevron,._8BDMSW_reasoningChevron,._8BDMSW_groupedModelChevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--watcher-motion-fast) var(--watcher-ease-out)}._8BDMSW_modelStageToggle[aria-expanded=true] ._8BDMSW_modelStageChevron,._8BDMSW_reasoningToggle[aria-expanded=true] ._8BDMSW_reasoningChevron,._8BDMSW_groupedModelToggle[aria-expanded=true] ._8BDMSW_groupedModelChevron{transform:rotate(90deg)}._8BDMSW_modelStageGlyph{background:var(--dsw-static-deepseek-450);width:7px;height:7px;box-shadow:0 0 0 3px var(--dsw-alias-button-ghost-active-fill);border-radius:999px}._8BDMSW_modelStageCopy{grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:8px;min-width:0;display:grid}._8BDMSW_modelStageTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;font-size:13px;font-weight:600;line-height:20px}._8BDMSW_modelStageSummary{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_modelStageBody{padding:2px 10px 10px 20px}._8BDMSW_modelStageBar{background:var(--dsw-alias-border-l2);border-radius:999px;gap:2px;height:5px;margin:2px 0 10px;display:flex;overflow:hidden}._8BDMSW_modelStageBar>span{border-radius:inherit;min-width:3px}._8BDMSW_modelStageBar [data-segment=wait],._8BDMSW_modelStageSwatch[data-segment=wait]{background:var(--dsw-alias-label-dimmed)}._8BDMSW_modelStageBar [data-segment=reasoning],._8BDMSW_modelStageSwatch[data-segment=reasoning]{background:var(--dsw-static-deepseek-450)}._8BDMSW_modelStageBar [data-segment=output],._8BDMSW_modelStageSwatch[data-segment=output]{background:var(--dsw-alias-label-secondary)}._8BDMSW_modelStageBar [data-segment=unattributed],._8BDMSW_modelStageSwatch[data-segment=unattributed]{background:var(--dsw-alias-state-warn-primary)}._8BDMSW_modelStageLedger{grid-template-columns:minmax(0,1fr);gap:5px 12px;margin:0;display:grid}._8BDMSW_modelStageMetric{min-width:0;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;justify-content:space-between;align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}._8BDMSW_modelStageMetric dt,._8BDMSW_modelStageMetric dd{margin:0}._8BDMSW_modelStageMetric dt{align-items:center;gap:6px;min-width:0;display:inline-flex}._8BDMSW_modelStageMetric dd{color:var(--dsw-alias-label-secondary);text-align:right;flex:none}._8BDMSW_modelStageSwatch{border-radius:999px;flex:none;width:6px;height:6px}._8BDMSW_modelStageNote{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:18px}._8BDMSW_reasoningAttempts{border-top:1px solid var(--dsw-alias-border-l2);margin-top:8px;padding-top:1px}._8BDMSW_reasoningDisclosure{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:6px;min-width:0;margin-top:5px;overflow:hidden}._8BDMSW_reasoningToggle{box-sizing:border-box;width:100%;min-height:34px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px minmax(0,1fr);align-items:center;gap:6px;padding:5px 8px;display:grid}._8BDMSW_reasoningLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:550;line-height:20px}._8BDMSW_reasoningMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:left;white-space:normal;grid-column:2;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_reasoningBody{box-sizing:border-box;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);max-height:320px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);margin:0;padding:10px 12px;font-size:13px;line-height:1.6;overflow:auto}._8BDMSW_reasoningBody>*{margin-top:0;margin-bottom:8px}._8BDMSW_reasoningBody>:last-child{margin-bottom:0}._8BDMSW_reasoningBody .md-code-block{max-width:100%}._8BDMSW_groupedModelStages{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:7px;margin-bottom:9px;position:relative;overflow:hidden}._8BDMSW_groupedModelStages:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:20px;left:-12px}._8BDMSW_groupedModelToggle{box-sizing:border-box;width:100%;min-height:44px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;grid-template-columns:12px minmax(0,1fr);align-items:center;gap:7px;padding:5px 9px;display:grid}._8BDMSW_groupedModelToggle>span{justify-content:space-between;align-items:baseline;gap:10px;min-width:0;display:flex}._8BDMSW_groupedModelToggle strong{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}._8BDMSW_groupedModelToggle small{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_groupedModelList{border-top:1px solid var(--dsw-alias-border-l2);padding:0 7px 8px 22px}._8BDMSW_groupedModelStep{min-width:0;padding-top:8px}._8BDMSW_groupedModelStep+._8BDMSW_groupedModelStep{border-top:1px solid var(--dsw-alias-border-l2)}._8BDMSW_groupedModelStepLabel{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);margin:0 2px 4px;font-size:12px;line-height:18px;display:block}._8BDMSW_analysisClusters{border-left:1px solid var(--dsw-alias-border-l2);margin:1px 8px 0 28px;padding-left:11px;position:relative}._8BDMSW_analysisCluster,._8BDMSW_analysisSingleton{min-width:0;position:relative}._8BDMSW_analysisCluster+._8BDMSW_analysisCluster,._8BDMSW_analysisCluster+._8BDMSW_analysisSingleton,._8BDMSW_analysisSingleton+._8BDMSW_analysisCluster,._8BDMSW_analysisSingleton+._8BDMSW_analysisSingleton{margin-top:6px}._8BDMSW_analysisCluster:before,._8BDMSW_analysisSingleton:before{background:var(--dsw-alias-border-l2);content:\"\";width:8px;height:1px;position:absolute;top:20px;left:-12px}._8BDMSW_analysisClusterToggle{box-sizing:border-box;width:100%;min-height:46px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:7px;grid-template-columns:12px 10px minmax(0,1fr) auto;align-items:center;gap:7px;padding:5px 6px 5px 4px;display:grid}._8BDMSW_analysisClusterToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_analysisCluster[data-open]>._8BDMSW_analysisClusterToggle{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}._8BDMSW_analysisClusterDotSlot{width:10px;height:10px;display:block;position:relative}._8BDMSW_analysisClusterDot{inset:0;position:absolute!important}._8BDMSW_analysisClusterCopy{flex-direction:column;min-width:0;display:flex}._8BDMSW_analysisClusterTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550;line-height:20px;overflow:hidden}._8BDMSW_analysisClusterMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_analysisClusterCount{min-width:28px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-size:12px;font-weight:600;line-height:18px}._8BDMSW_analysisClusterItems{border-left:1px solid var(--dsw-alias-border-l2);margin:3px 0 8px 17px;padding-left:5px}._8BDMSW_overviewOccurrence{box-sizing:border-box;width:100%;min-height:45px;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color var(--watcher-motion-fast) var(--watcher-ease-out), border-color var(--watcher-motion-fast) var(--watcher-ease-out), box-shadow var(--watcher-motion-fast) var(--watcher-ease-out);animation:_8BDMSW_watcher-live-append var(--watcher-motion-fast) var(--watcher-ease-out);background:0 0;border:1px solid #0000;border-radius:7px;grid-template-columns:22px 10px minmax(0,1fr) auto 12px;align-items:center;gap:7px;padding:5px 5px 5px 7px;display:grid;position:relative}._8BDMSW_overviewOccurrence+._8BDMSW_overviewOccurrence{margin-top:2px}._8BDMSW_overviewOccurrence:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_overviewOccurrence[data-current]:not([data-selected]){background:var(--dsw-alias-bg-layer-2)}._8BDMSW_overviewOccurrence[data-selected]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 2px 0 0 var(--dsw-static-deepseek-450)}._8BDMSW_overviewOccurrenceIndex{color:var(--dsw-alias-label-dimmed);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums;text-align:right;font-size:11px;line-height:18px}._8BDMSW_overviewOccurrenceDotSlot{width:10px;height:10px;display:block;position:relative}._8BDMSW_overviewOccurrenceDot{inset:0;position:absolute!important}._8BDMSW_overviewOccurrenceCopy{flex-direction:column;min-width:0;display:flex}._8BDMSW_overviewOccurrenceTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550;line-height:20px;overflow:hidden}._8BDMSW_overviewOccurrenceMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_overviewOccurrenceDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;line-height:18px}._8BDMSW_overviewOccurrenceChevron{color:var(--dsw-alias-label-dimmed);opacity:0;transition:opacity var(--watcher-motion-fast) ease, transform var(--watcher-motion-fast) ease;transform:translate(-2px)}._8BDMSW_overviewOccurrence:hover ._8BDMSW_overviewOccurrenceChevron,._8BDMSW_overviewOccurrence[data-selected] ._8BDMSW_overviewOccurrenceChevron,._8BDMSW_overviewOccurrence:focus-visible ._8BDMSW_overviewOccurrenceChevron{opacity:1;transform:translate(0)}@keyframes _8BDMSW_watcher-live-append{0%{opacity:.5;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}._8BDMSW_empty{min-height:250px;color:var(--dsw-alias-label-tertiary);text-align:center;flex-direction:column;flex:1;justify-content:center;align-items:center;padding:28px;display:flex}._8BDMSW_emptyEye{color:var(--dsw-alias-label-secondary);margin-bottom:12px;display:inline-flex}._8BDMSW_empty strong{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;line-height:21px}._8BDMSW_empty>span:last-child{margin-top:4px;font-size:12px;line-height:18px}._8BDMSW_inspector{width:438px;min-width:0;max-height:var(--watcher-panel-max-height);border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-direction:column;flex:none;display:flex}._8BDMSW_inspectorHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;padding:16px 16px 14px}._8BDMSW_inspectorBack{min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;margin:-4px 0 8px -6px;padding:0 7px 0 5px;font-size:12px;display:none}._8BDMSW_inspectorBack:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_inspectorBack svg{transform:rotate(180deg)}._8BDMSW_statusLine,._8BDMSW_detailStatus{color:var(--dsw-alias-label-secondary);align-items:center;gap:7px;font-size:12px;line-height:18px;display:flex}._8BDMSW_statusLine[data-status=failure],._8BDMSW_statusLine[data-status=interrupted],._8BDMSW_detailStatus[data-status=failure],._8BDMSW_detailStatus[data-status=interrupted]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_statusLine[data-status=running],._8BDMSW_detailStatus[data-status=running]{color:var(--dsw-static-deepseek-450)}._8BDMSW_statusLine[data-status=waiting],._8BDMSW_detailStatus[data-status=waiting]{color:var(--dsw-alias-state-warn-primary)}._8BDMSW_location{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:auto}._8BDMSW_inspectorTitle{color:var(--dsw-alias-label-primary);margin:8px 0 0;font-size:18px;font-weight:600;line-height:25px}._8BDMSW_inspectorSummary{color:var(--dsw-alias-label-tertiary);margin:3px 0 0;font-size:12px;line-height:18px}._8BDMSW_groupSignals{flex-wrap:wrap;gap:6px;margin-top:10px;display:flex}._8BDMSW_groupSignals span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}._8BDMSW_groupSignals span+span:before{content:\"·\";color:var(--dsw-alias-label-dimmed);margin-right:6px}._8BDMSW_groupSignals [data-retry]{color:var(--dsw-alias-state-warn-primary)}._8BDMSW_groupSignals [data-error]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_inspectorBody{overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}._8BDMSW_executionSection{border-bottom:1px solid var(--dsw-alias-border-l2);padding:14px 16px 16px}._8BDMSW_sectionHeading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;display:flex}._8BDMSW_sectionHeading h3{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;font-weight:600;line-height:20px}._8BDMSW_sectionHeading>span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}._8BDMSW_executionList{max-height:188px;padding-right:2px;overflow:auto}._8BDMSW_stepBlock+._8BDMSW_stepBlock{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:10px}._8BDMSW_stepHeading{min-height:22px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums;justify-content:space-between;align-items:center;gap:8px;padding:0 3px;font-size:12px;display:flex}._8BDMSW_stepSignals{align-items:center;gap:6px;min-width:0;display:inline-flex}._8BDMSW_stepDuration{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-variant-numeric:tabular-nums;white-space:nowrap}._8BDMSW_parallelLabel{color:var(--dsw-static-deepseek-450);font-family:var(--dsw-font-family)}._8BDMSW_occurrences{margin-top:4px;position:relative}._8BDMSW_stepBlock[data-parallel] ._8BDMSW_occurrences{border-left:1px solid var(--dsw-static-deepseek-450);padding-left:10px}._8BDMSW_occurrence{box-sizing:border-box;width:100%;min-height:46px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:8px;grid-template-columns:10px minmax(0,1fr) auto 13px;align-items:center;gap:8px;padding:6px 7px;transition:background-color .14s,border-color .14s;display:grid}._8BDMSW_occurrenceDuration{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;line-height:18px}._8BDMSW_occurrence+._8BDMSW_occurrence{margin-top:2px}._8BDMSW_occurrence:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_occurrence[data-selected]{border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill)}._8BDMSW_occurrenceTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:550;line-height:19px;overflow:hidden}._8BDMSW_occurrenceMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}._8BDMSW_detailSection{padding:16px}._8BDMSW_detailHeader{grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px;display:grid}._8BDMSW_detailIdentity{min-width:0}._8BDMSW_detailIdentity h3{overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);margin:6px 0 0;font-size:16px;font-weight:600;line-height:23px}._8BDMSW_detailIdentity p{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);margin:3px 0 0;font-size:12px;line-height:18px}._8BDMSW_patternLabel{color:var(--dsw-alias-state-warn-primary)}._8BDMSW_metrics{font-variant-numeric:tabular-nums;grid-template-columns:auto auto;gap:2px 8px;margin:0;font-size:12px;line-height:18px;display:grid}._8BDMSW_metrics dt{color:var(--dsw-alias-label-tertiary)}._8BDMSW_metrics dd{color:var(--dsw-alias-label-secondary);text-align:right;margin:0}._8BDMSW_metrics [data-error]{color:var(--dsw-alias-state-error-primary)}._8BDMSW_tabs{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:end;gap:4px;margin-top:16px;display:flex}._8BDMSW_tab{min-width:56px;min-height:36px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:0 10px;font-size:13px;position:relative}._8BDMSW_tab:hover{color:var(--dsw-alias-label-primary)}._8BDMSW_tab[data-active]{color:var(--dsw-alias-label-primary);font-weight:600}._8BDMSW_tab[data-active]:after{content:\"\";background:var(--dsw-static-deepseek-450);border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:9px;right:9px}._8BDMSW_tabPanel{--dsl-terminal-font:400 13px/22px var(--dsw-font-mono);min-height:116px;padding-top:12px}._8BDMSW_tabPanel>*{margin-top:0;margin-bottom:0}._8BDMSW_jsonSurface{font-size:13px;overflow:auto}._8BDMSW_jsonSurface [role=tree]{font-size:13px;line-height:20px}._8BDMSW_rawPanel pre{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);tab-size:2;margin:0;font-size:13px;line-height:20px;overflow:auto}._8BDMSW_documentResult{min-width:0;color:var(--dsw-alias-label-primary);padding:2px 2px 8px}._8BDMSW_documentResult .md-code-block{max-width:100%}._8BDMSW_documentResult blockquote{color:var(--dsw-alias-label-secondary)}._8BDMSW_documentResult table{font-variant-numeric:tabular-nums}._8BDMSW_rawPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);border-radius:8px;overflow:hidden}._8BDMSW_rawToolbar{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:38px;color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:12px;padding:0 10px 0 12px;font-size:12px;display:flex}._8BDMSW_copyRaw{min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;padding:0 6px;font-size:12px;display:inline-flex}._8BDMSW_copyRaw:hover{background:var(--dsw-alias-interactive-bg-hover)}._8BDMSW_rawPanel pre{white-space:pre;max-height:320px;padding:12px}._8BDMSW_artifactResult,._8BDMSW_detailEmpty{border:1px solid var(--dsw-alias-border-l2);min-height:116px;color:var(--dsw-alias-label-tertiary);text-align:center;border-radius:8px;flex-direction:column;justify-content:center;align-items:center;padding:18px;font-size:13px;display:flex}._8BDMSW_artifactResult strong{color:var(--dsw-alias-label-secondary);margin-top:6px;font-size:14px}._8BDMSW_artifactResult>span{margin-top:2px;font-size:12px}._8BDMSW_artifactResult ._8BDMSW_jsonSurface{text-align:left;width:100%;margin-top:12px}._8BDMSW_artifactGlyph{color:var(--dsw-static-deepseek-450);font-size:24px;line-height:28px}._8BDMSW_inspectorFooter{border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);flex:none;padding:9px 16px;font-size:12px;line-height:18px}@media (prefers-reduced-motion:reduce){._8BDMSW_menu,._8BDMSW_trigger[data-live] ._8BDMSW_eyePupil,._8BDMSW_trigger[data-live] ._8BDMSW_eyeBlink{animation:none}._8BDMSW_trigger,._8BDMSW_overviewOccurrence,._8BDMSW_turnChevron,._8BDMSW_phaseChevron,._8BDMSW_stepChevron,._8BDMSW_analysisClusterChevron,._8BDMSW_modelStageChevron,._8BDMSW_reasoningChevron,._8BDMSW_groupedModelChevron,._8BDMSW_occurrence,._8BDMSW_overviewOccurrenceChevron,._8BDMSW_occurrenceChevron{transition-duration:.01ms}._8BDMSW_overviewOccurrence{animation:none}._8BDMSW_root [data-state=ongoing] rect,._8BDMSW_menu [data-state=ongoing] rect{opacity:.55;animation:none!important}}@media (width<=860px){._8BDMSW_menu{flex-direction:column-reverse;width:min(500px,100vw - 24px);max-height:calc(100vh - 88px)}._8BDMSW_workPicture{width:auto;min-height:250px;max-height:none}._8BDMSW_menu:not(:has(._8BDMSW_inspector)){height:min(680px,100vh - 88px)}._8BDMSW_menu:not(:has(._8BDMSW_inspector)) ._8BDMSW_workPicture{flex:auto}._8BDMSW_inspector{border-right:0;width:auto;max-height:none}._8BDMSW_menu:has(._8BDMSW_inspector){height:min(680px,100vh - 88px)}._8BDMSW_menu:has(._8BDMSW_inspector) ._8BDMSW_workPicture{display:none}._8BDMSW_menu:has(._8BDMSW_inspector) ._8BDMSW_inspector{flex:auto;min-height:0;max-height:none}._8BDMSW_inspectorBack{display:inline-flex}._8BDMSW_inspectorHeader{padding-top:14px}._8BDMSW_executionList{max-height:150px}}@media (width<=520px){._8BDMSW_menu{width:calc(100vw - 24px)}._8BDMSW_pictureHeader{padding:14px 12px}._8BDMSW_now{font-size:16px}._8BDMSW_turns{padding-inline:6px}._8BDMSW_groupBadges span:nth-child(n+2){display:none}._8BDMSW_inspectorHeader,._8BDMSW_executionSection,._8BDMSW_detailSection{padding-inline:12px}._8BDMSW_detailHeader{grid-template-columns:1fr}._8BDMSW_metrics{grid-template-columns:auto 1fr}._8BDMSW_metrics dd{text-align:left}._8BDMSW_modelStageCopy{grid-template-columns:1fr;gap:0}._8BDMSW_modelStageSummary{white-space:normal}._8BDMSW_modelStageLedger{grid-template-columns:1fr}._8BDMSW_reasoningToggle{grid-template-columns:12px minmax(0,1fr)}._8BDMSW_reasoningMeta{text-align:left;white-space:normal;grid-column:2}._8BDMSW_groupedModelToggle>span{gap:0;display:grid}._8BDMSW_groupedModelToggle small{white-space:normal}._8BDMSW_groupedModelList{padding-left:12px}}";
		const tagId = "dsh-watcher/Watcher.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-watcher";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Watcher_module_css_default = {
			"analysisCluster": "_8BDMSW_analysisCluster",
			"analysisClusterChevron": "_8BDMSW_analysisClusterChevron",
			"analysisClusterCopy": "_8BDMSW_analysisClusterCopy",
			"analysisClusterCount": "_8BDMSW_analysisClusterCount",
			"analysisClusterDot": "_8BDMSW_analysisClusterDot",
			"analysisClusterDotSlot": "_8BDMSW_analysisClusterDotSlot",
			"analysisClusterItems": "_8BDMSW_analysisClusterItems",
			"analysisClusterMeta": "_8BDMSW_analysisClusterMeta",
			"analysisClusters": "_8BDMSW_analysisClusters",
			"analysisClusterTitle": "_8BDMSW_analysisClusterTitle",
			"analysisClusterToggle": "_8BDMSW_analysisClusterToggle",
			"analysisSingleton": "_8BDMSW_analysisSingleton",
			"artifactGlyph": "_8BDMSW_artifactGlyph",
			"artifactResult": "_8BDMSW_artifactResult",
			"copyRaw": "_8BDMSW_copyRaw",
			"detailEmpty": "_8BDMSW_detailEmpty",
			"detailHeader": "_8BDMSW_detailHeader",
			"detailIdentity": "_8BDMSW_detailIdentity",
			"detailSection": "_8BDMSW_detailSection",
			"detailStatus": "_8BDMSW_detailStatus",
			"documentResult": "_8BDMSW_documentResult",
			"empty": "_8BDMSW_empty",
			"emptyEye": "_8BDMSW_emptyEye",
			"executionList": "_8BDMSW_executionList",
			"executionSection": "_8BDMSW_executionSection",
			"eye": "_8BDMSW_eye",
			"eyeBlink": "_8BDMSW_eyeBlink",
			"eyebrow": "_8BDMSW_eyebrow",
			"eyePupil": "_8BDMSW_eyePupil",
			"follow": "_8BDMSW_follow",
			"groupBadges": "_8BDMSW_groupBadges",
			"groupedModelChevron": "_8BDMSW_groupedModelChevron",
			"groupedModelList": "_8BDMSW_groupedModelList",
			"groupedModelStages": "_8BDMSW_groupedModelStages",
			"groupedModelStep": "_8BDMSW_groupedModelStep",
			"groupedModelStepLabel": "_8BDMSW_groupedModelStepLabel",
			"groupedModelToggle": "_8BDMSW_groupedModelToggle",
			"groupRail": "_8BDMSW_groupRail",
			"groupSignals": "_8BDMSW_groupSignals",
			"historyNotice": "_8BDMSW_historyNotice",
			"historyNoticeCopy": "_8BDMSW_historyNoticeCopy",
			"inspector": "_8BDMSW_inspector",
			"inspectorBack": "_8BDMSW_inspectorBack",
			"inspectorBody": "_8BDMSW_inspectorBody",
			"inspectorFooter": "_8BDMSW_inspectorFooter",
			"inspectorHeader": "_8BDMSW_inspectorHeader",
			"inspectorSummary": "_8BDMSW_inspectorSummary",
			"inspectorTitle": "_8BDMSW_inspectorTitle",
			"jsonSurface": "_8BDMSW_jsonSurface",
			"location": "_8BDMSW_location",
			"menu": "_8BDMSW_menu",
			"metrics": "_8BDMSW_metrics",
			"modelStage": "_8BDMSW_modelStage",
			"modelStageBar": "_8BDMSW_modelStageBar",
			"modelStageBody": "_8BDMSW_modelStageBody",
			"modelStageChevron": "_8BDMSW_modelStageChevron",
			"modelStageCopy": "_8BDMSW_modelStageCopy",
			"modelStageGlyph": "_8BDMSW_modelStageGlyph",
			"modelStageLedger": "_8BDMSW_modelStageLedger",
			"modelStageMetric": "_8BDMSW_modelStageMetric",
			"modelStageNote": "_8BDMSW_modelStageNote",
			"modelStageSummary": "_8BDMSW_modelStageSummary",
			"modelStageSwatch": "_8BDMSW_modelStageSwatch",
			"modelStageTitle": "_8BDMSW_modelStageTitle",
			"modelStageToggle": "_8BDMSW_modelStageToggle",
			"neutralDot": "_8BDMSW_neutralDot",
			"now": "_8BDMSW_now",
			"nowBlock": "_8BDMSW_nowBlock",
			"occurrence": "_8BDMSW_occurrence",
			"occurrenceChevron": "_8BDMSW_occurrenceChevron",
			"occurrenceCopy": "_8BDMSW_occurrenceCopy",
			"occurrenceDuration": "_8BDMSW_occurrenceDuration",
			"occurrenceMeta": "_8BDMSW_occurrenceMeta",
			"occurrences": "_8BDMSW_occurrences",
			"occurrenceTitle": "_8BDMSW_occurrenceTitle",
			"overviewOccurrence": "_8BDMSW_overviewOccurrence",
			"overviewOccurrenceChevron": "_8BDMSW_overviewOccurrenceChevron",
			"overviewOccurrenceCopy": "_8BDMSW_overviewOccurrenceCopy",
			"overviewOccurrenceDot": "_8BDMSW_overviewOccurrenceDot",
			"overviewOccurrenceDotSlot": "_8BDMSW_overviewOccurrenceDotSlot",
			"overviewOccurrenceDuration": "_8BDMSW_overviewOccurrenceDuration",
			"overviewOccurrenceIndex": "_8BDMSW_overviewOccurrenceIndex",
			"overviewOccurrenceMeta": "_8BDMSW_overviewOccurrenceMeta",
			"overviewOccurrences": "_8BDMSW_overviewOccurrences",
			"overviewOccurrenceTitle": "_8BDMSW_overviewOccurrenceTitle",
			"overviewStep": "_8BDMSW_overviewStep",
			"overviewStepHeader": "_8BDMSW_overviewStepHeader",
			"overviewStepLabel": "_8BDMSW_overviewStepLabel",
			"overviewStepSignals": "_8BDMSW_overviewStepSignals",
			"overviewTag": "_8BDMSW_overviewTag",
			"parallelLabel": "_8BDMSW_parallelLabel",
			"patternLabel": "_8BDMSW_patternLabel",
			"phase": "_8BDMSW_phase",
			"phaseChevron": "_8BDMSW_phaseChevron",
			"phaseCopy": "_8BDMSW_phaseCopy",
			"phaseHeader": "_8BDMSW_phaseHeader",
			"phaseMarker": "_8BDMSW_phaseMarker",
			"phaseMeta": "_8BDMSW_phaseMeta",
			"phaseTitle": "_8BDMSW_phaseTitle",
			"phaseTitleLine": "_8BDMSW_phaseTitleLine",
			"phaseToggle": "_8BDMSW_phaseToggle",
			"pictureHeader": "_8BDMSW_pictureHeader",
			"railLine": "_8BDMSW_railLine",
			"railViewport": "_8BDMSW_railViewport",
			"rawPanel": "_8BDMSW_rawPanel",
			"rawToolbar": "_8BDMSW_rawToolbar",
			"reasoningAttempts": "_8BDMSW_reasoningAttempts",
			"reasoningBody": "_8BDMSW_reasoningBody",
			"reasoningChevron": "_8BDMSW_reasoningChevron",
			"reasoningDisclosure": "_8BDMSW_reasoningDisclosure",
			"reasoningLabel": "_8BDMSW_reasoningLabel",
			"reasoningMeta": "_8BDMSW_reasoningMeta",
			"reasoningToggle": "_8BDMSW_reasoningToggle",
			"root": "_8BDMSW_root",
			"sectionHeading": "_8BDMSW_sectionHeading",
			"sessionTiming": "_8BDMSW_sessionTiming",
			"sessionTimingMetric": "_8BDMSW_sessionTimingMetric",
			"statusLine": "_8BDMSW_statusLine",
			"stepBlock": "_8BDMSW_stepBlock",
			"stepChevron": "_8BDMSW_stepChevron",
			"stepDuration": "_8BDMSW_stepDuration",
			"stepHeading": "_8BDMSW_stepHeading",
			"stepSignals": "_8BDMSW_stepSignals",
			"stepTimeline": "_8BDMSW_stepTimeline",
			"stepToggle": "_8BDMSW_stepToggle",
			"summary": "_8BDMSW_summary",
			"tab": "_8BDMSW_tab",
			"tabPanel": "_8BDMSW_tabPanel",
			"tabs": "_8BDMSW_tabs",
			"trigger": "_8BDMSW_trigger",
			"turn": "_8BDMSW_turn",
			"turnBody": "_8BDMSW_turnBody",
			"turnChevron": "_8BDMSW_turnChevron",
			"turnCopy": "_8BDMSW_turnCopy",
			"turnDuration": "_8BDMSW_turnDuration",
			"turnHeader": "_8BDMSW_turnHeader",
			"turnMetric": "_8BDMSW_turnMetric",
			"turnMetrics": "_8BDMSW_turnMetrics",
			"turnPerformance": "_8BDMSW_turnPerformance",
			"turns": "_8BDMSW_turns",
			"turnSpeed": "_8BDMSW_turnSpeed",
			"turnSummary": "_8BDMSW_turnSummary",
			"turnTitle": "_8BDMSW_turnTitle",
			"turnTitleLine": "_8BDMSW_turnTitleLine",
			"turnToggle": "_8BDMSW_turnToggle",
			"unread": "_8BDMSW_unread",
			"viewControl": "_8BDMSW_viewControl",
			"viewMode": "_8BDMSW_viewMode",
			"viewToolbar": "_8BDMSW_viewToolbar",
			"viewToolbarLabel": "_8BDMSW_viewToolbarLabel",
			"watcher-eye-blink": "_8BDMSW_watcher-eye-blink",
			"watcher-eye-scan": "_8BDMSW_watcher-eye-scan",
			"watcher-live-append": "_8BDMSW_watcher-live-append",
			"watcher-panel-enter": "_8BDMSW_watcher-panel-enter",
			"workPicture": "_8BDMSW_workPicture"
		};
		//#endregion
		//#region src/hub/overview.ts
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
		//#region src/observation/performance.ts
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
		function unionDuration(intervals) {
			const sorted = [...intervals].sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
			const first = sorted[0];
			if (first === void 0) return 0;
			let startTime = first.startTime;
			let endTime = first.endTime;
			let durationMs = 0;
			for (const interval of sorted.slice(1)) {
				if (interval.startTime <= endTime) {
					endTime = Math.max(endTime, interval.endTime);
					continue;
				}
				durationMs += Math.max(0, endTime - startTime);
				startTime = interval.startTime;
				endTime = interval.endTime;
			}
			return durationMs + Math.max(0, endTime - startTime);
		}
		/**
		* Decompose the loaded session span into DSH Turn intervals and time between Turns.
		* Partial history is labelled as a window; missing Turn starts use observed work only.
		*/
		function deriveSessionTiming(picture, now) {
			const latestTurn = picture.turns.at(-1)?.turn ?? null;
			const ranges = picture.turns.flatMap((turn) => {
				const range = observedTurnRange(turn, picture.running && turn.turn === latestTurn, now);
				return range === null ? [] : [range];
			});
			if (ranges.length === 0) return { kind: "unavailable" };
			const startTime = Math.min(...ranges.map((range) => range.startTime));
			const endTime = picture.running ? Math.max(startTime, now) : Math.max(...ranges.map((range) => range.endTime));
			const elapsedMs = Math.max(0, endTime - startTime);
			const activeTurnMs = Math.min(elapsedMs, unionDuration(ranges));
			return {
				kind: "measured",
				coverage: picture.partialHistory || ranges.some((range) => !range.exactBounds) ? "partial" : "complete",
				startTime,
				endTime,
				elapsedMs,
				activeTurnMs,
				betweenTurnMs: Math.max(0, elapsedMs - activeTurnMs)
			};
		}
		/** Whole tokens from ten up, one decimal below, matching DSH's RC8 chat chrome. */
		function formatTokensPerSecond(tokensPerSecond) {
			const clamped = Math.max(0, tokensPerSecond);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		//#endregion
		//#region src/client/step-timeline.ts
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
		//#region src/client/disclosure-depth.ts
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
		//#region src/client/Watcher.tsx
		const PANEL_GAP = 8;
		const PANEL_MARGIN = 12;
		const UNPLACED_PANEL_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		const MARKDOWN_CODE_LABELS = Object.freeze({
			copyLabel: "复制",
			copiedLabel: "已复制"
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
			return state === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${Watcher_module_css_default.neutralDot}${className === void 0 ? "" : ` ${className}`}`,
				"data-status": status,
				"aria-hidden": "true"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: Watcher_module_css_default.turnMetrics,
				"aria-label": "对话轮次性能分解",
				children: metrics.map(([label, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Watcher_module_css_default.turnMetric,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: value })]
				}, label))
			});
		}
		function SessionTimeLedger({ timing }) {
			if (timing.kind === "unavailable") return null;
			const metrics = [
				[timing.coverage === "complete" ? "会话总跨度" : "已加载跨度", formatDuration(timing.elapsedMs)],
				["轮次内耗时", formatDuration(timing.activeTurnMs)],
				["轮次间隔", formatDuration(timing.betweenTurnMs)]
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: Watcher_module_css_default.sessionTiming,
				"aria-label": "会话墙钟时间分解",
				title: "会话跨度等于轮次内耗时与轮次之间间隔；已加载跨度表示更早历史尚未载入",
				children: metrics.map(([label, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Watcher_module_css_default.sessionTimingMetric,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: value })]
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: Watcher_module_css_default.copyRaw,
				onClick: copy,
				"aria-label": copied ? "原始数据已复制" : "复制原始数据",
				children: [copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, { size: 14 }), copied ? "已复制" : "复制"]
			});
		}
		function ResultPresentation({ presentation }) {
			switch (presentation.kind) {
				case "terminal": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
					command: presentation.command,
					cwd: presentation.cwd ?? void 0,
					output: presentation.output,
					exitCode: presentation.exitCode ?? void 0,
					signal: presentation.signal ?? void 0,
					running: presentation.running,
					maxLines: 18
				});
				case "read": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ReadBlock, {
					label: presentation.label,
					lang: presentation.lang ?? void 0,
					lines: presentation.lines,
					totalLines: presentation.totalLines,
					maxLines: 18
				});
				case "diff": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DiffBlock, {
					diffs: presentation.diffs,
					maxLines: 18
				});
				case "json": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Watcher_module_css_default.jsonSurface,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
						data: presentation.data,
						label: "结构化结果"
					})
				});
				case "text": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("article", {
					className: Watcher_module_css_default.documentResult,
					"data-watcher-document": "",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: presentation.text,
						codeLabels: MARKDOWN_CODE_LABELS
					})
				});
				case "image": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Watcher_module_css_default.artifactResult,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.artifactGlyph,
							"aria-hidden": "true",
							children: "▧"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "图片附件" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "附件已保留在本次会话记录中" }),
						isJsonValue(presentation.attachment) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.jsonSurface,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
								data: presentation.attachment,
								label: "图片附件信息"
							})
						}) : null
					]
				});
				case "empty": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: Watcher_module_css_default.inspector,
				"aria-label": `${group.title} 的执行详情`,
				"data-ud-check": "watcher-inspector",
				"data-ud-role": "panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: Watcher_module_css_default.inspectorHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.inspectorBack,
								onClick: onBack,
								"aria-label": "返回工作路径",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
									size: 13,
									"aria-hidden": "true"
								}), "工作路径"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.statusLine,
								"data-status": group.status,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusMark, { status: group.status }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: groupStatusLabel(group) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: Watcher_module_css_default.inspectorTitle,
								children: group.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: Watcher_module_css_default.inspectorSummary,
								children: group.subtitle
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.groupSignals,
								"aria-label": "工作模式",
								children: [
									group.parallelStepCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"并行 ",
										group.parallelStepCount,
										" 次"
									] }) : null,
									group.retryCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										"data-retry": "",
										children: [
											"重试 ",
											group.retryCount,
											" 次"
										]
									}) : null,
									group.iterationCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"有 ",
										group.iterationCount,
										" 次迭代"
									] }) : null,
									group.unconfirmedFailureCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										"data-error": "",
										children: [group.unconfirmedFailureCount, " 条失败后未见成功证据"]
									}) : null
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Watcher_module_css_default.inspectorBody,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.executionSection,
							"aria-labelledby": `execution-title-${group.id}`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: `execution-title-${group.id}`,
									children: "执行路径"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [group.items.length, " 条记录"] })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Watcher_module_css_default.executionList,
								children: group.steps.map((step, stepIndex) => {
									const stepLive = live && stepIndex === group.steps.length - 1;
									const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now));
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.stepBlock,
										"data-parallel": step.parallel ? "" : void 0,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.stepHeading,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["步骤 ", step.step || "—"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.stepSignals,
												children: [stepDuration === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: Watcher_module_css_default.stepDuration,
													children: stepDuration
												}), step.parallel ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: Watcher_module_css_default.parallelLabel,
													children: [step.executionCount, " 项并行"]
												}) : null]
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.occurrences,
											children: step.items.map((item, itemIndex) => {
												const itemDuration = formatDuration(itemElapsedMs(item, stepLive && item.status === "running", now));
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: Watcher_module_css_default.occurrence,
													"data-selected": item.id === selected.id ? "" : void 0,
													"data-status": item.status,
													"aria-pressed": item.id === selected.id,
													onClick: () => onSelectItem(item.id),
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusMark, {
															status: item.status,
															className: Watcher_module_css_default.occurrenceDot
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: Watcher_module_css_default.occurrenceCopy,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: Watcher_module_css_default.occurrenceTitle,
																children: item.title
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.occurrenceMeta,
																children: [
																	item.toolName ?? item.source,
																	step.items.length > 1 ? ` · 分支 ${itemIndex + 1}` : "",
																	itemPattern(item) === null ? "" : ` · ${itemPattern(item)}`
																]
															})]
														}),
														itemDuration === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: Watcher_module_css_default.occurrenceDuration,
															children: itemDuration
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.detailSection,
							"aria-labelledby": `detail-title-${selected.id}`,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.detailHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.detailIdentity,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: Watcher_module_css_default.detailStatus,
												"data-status": selected.status,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusMark, { status: selected.status }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: STATUS_LABEL[selected.status] }),
													pattern === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: Watcher_module_css_default.patternLabel,
														children: pattern
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												id: `detail-title-${selected.id}`,
												children: selected.title
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												title: selected.subtitle,
												children: selected.subtitle || "没有补充说明"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
										className: Watcher_module_css_default.metrics,
										children: [
											duration === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "耗时" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: duration })] }),
											selected.exitCode === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "退出码" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												"data-error": selected.exitCode === 0 ? void 0 : "",
												children: selected.exitCode
											})] }),
											selected.signal === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "信号" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
												"data-error": "",
												children: selected.signal
											})] })
										]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Watcher_module_css_default.tabs,
									role: "tablist",
									"aria-label": "执行数据",
									children: [
										["result", "结果"],
										["input", "输入"],
										["raw", "原始"]
									].map(([id, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === id,
										className: Watcher_module_css_default.tab,
										"data-active": tab === id ? "" : void 0,
										onClick: () => setTab(id),
										children: label
									}, id))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.tabPanel,
									role: "tabpanel",
									children: [
										tab === "result" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultPresentation, { presentation: selected.presentation }) : null,
										tab === "input" ? hasInput ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.jsonSurface,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
												data: selected.args,
												label: "执行输入"
											})
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.detailEmpty,
											children: "这条记录没有工具输入"
										}) : null,
										tab === "raw" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.rawPanel,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: Watcher_module_css_default.rawToolbar,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "完整原始数据 · 不截断" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CopyRawButton, { text: raw })]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: raw || "没有原始数据" })]
										}) : null
									]
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
						className: Watcher_module_css_default.inspectorFooter,
						children: "只读观察 · 不会改变 Agent"
					})
				]
			});
		}
		/** The pupil scans only while live; the complete eye remains a useful static glyph. */
		function IconLivingEye({ size = 17 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: Watcher_module_css_default.eye,
				"data-ud-motion": "watcher-eye-scan",
				width: size,
				height: size,
				viewBox: "0 0 18 18",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
					className: Watcher_module_css_default.eyeBlink,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						className: Watcher_module_css_default.eyeOutline,
						fill: "currentColor",
						fillRule: "evenodd",
						d: "M9 3.25c-3.93 0-7.03 2.88-7.9 5.75.87 2.87 3.97 5.75 7.9 5.75s7.03-2.88 7.9-5.75C16.03 6.13 12.93 3.25 9 3.25Zm0 9.95A4.2 4.2 0 1 1 9 4.8a4.2 4.2 0 0 1 0 8.4Z"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						className: Watcher_module_css_default.eyePupil,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "9",
							cy: "9",
							r: "2.05",
							fill: "currentColor"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: Watcher_module_css_default.groupBadges,
				"aria-hidden": "true",
				children: [
					group.parallelStepCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"data-kind": "parallel",
						children: group.parallelStepCount === 1 ? "并行" : `并行 ${group.parallelStepCount} 组`
					}) : null,
					group.retryCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						"data-kind": "retry",
						children: ["重试 ", group.retryCount]
					}) : null,
					group.iterationCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Watcher_module_css_default.modelStage,
				"data-live": metrics.live ? "" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: Watcher_module_css_default.modelStageToggle,
					"aria-expanded": open,
					"aria-controls": bodyId,
					title: "模型阶段只使用 DSH 会话中供应商公开写入的事件",
					onClick: onToggle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
							size: 11,
							className: Watcher_module_css_default.modelStageChevron
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.modelStageGlyph,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: Watcher_module_css_default.modelStageCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.modelStageTitle,
								children: "模型阶段"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.modelStageSummary,
								children: summary
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					id: bodyId,
					className: Watcher_module_css_default.modelStageBody,
					hidden: !open,
					children: [
						measuredSegments.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Watcher_module_css_default.modelStageBar,
							"aria-label": "模型阶段耗时比例",
							children: measuredSegments.map((segment) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-segment": segment.key,
								style: { flexGrow: Math.max(segment.durationMs, 1) },
								title: `${segment.label} ${formatDuration(segment.durationMs) ?? ""}`
							}, segment.key))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
							className: Watcher_module_css_default.modelStageLedger,
							children: segments.map((segment) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.modelStageMetric,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Watcher_module_css_default.modelStageSwatch,
									"data-segment": segment.key,
									"aria-hidden": "true"
								}), segment.label] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(segment.durationMs) ?? segment.unavailableLabel })]
							}, segment.key))
						}),
						reasoningAttempts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: Watcher_module_css_default.modelStageNote,
							children: "本 Step 没有供应商可见推理记录"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Watcher_module_css_default.reasoningAttempts,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
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
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: Watcher_module_css_default.reasoningDisclosure,
									"data-open": reasoningOpen ? "" : void 0,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Watcher_module_css_default.reasoningToggle,
										"aria-expanded": reasoningOpen,
										"aria-controls": `watcher-reasoning-${key}`,
										onClick: () => onToggleReasoning(key),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
												size: 11,
												className: Watcher_module_css_default.reasoningChevron
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.reasoningLabel,
												children: reasoningAttempts.length === 1 ? "推理记录" : `尝试 ${attempt.attempt}`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.reasoningMeta,
												children: meta
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("article", {
										id: `watcher-reasoning-${key}`,
										className: Watcher_module_css_default.reasoningBody,
										hidden: !reasoningOpen,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
											text: attempt.reasoningText,
											codeLabels: MARKDOWN_CODE_LABELS
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceIndex,
						children: String(occurrenceNumber).padStart(2, "0")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceDotSlot,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusMark, {
							status: item.status,
							className: Watcher_module_css_default.overviewOccurrenceDot
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: Watcher_module_css_default.overviewOccurrenceCopy,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.overviewOccurrenceTitle,
							children: item.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Watcher_module_css_default.overviewOccurrenceMeta,
							children: meta
						})]
					}),
					duration === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Watcher_module_css_default.overviewOccurrenceDuration,
						children: duration
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Watcher_module_css_default.phase,
				"data-selected": selectedGroup ? "" : void 0,
				"data-now": isNow ? "" : void 0,
				"data-overview-state": phaseState,
				"aria-label": `${group.title}，${phaseSummary}，${OVERVIEW_STATE_LABEL[phaseState]}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
					className: Watcher_module_css_default.phaseHeader,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: Watcher_module_css_default.phaseToggle,
						"aria-expanded": open,
						"aria-controls": `watcher-phase-body-${group.id}`,
						"aria-label": `${group.title}，${phaseSummary}，${open ? "收起阶段" : "展开阶段"}`,
						onClick: onToggle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Watcher_module_css_default.phaseMarker,
								"data-state": phaseState,
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
								size: 12,
								className: Watcher_module_css_default.phaseChevron
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: Watcher_module_css_default.phaseCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: Watcher_module_css_default.phaseTitleLine,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.phaseTitle,
											"data-watcher-group-title": "",
											children: group.title
										}),
										groupBadges(group),
										showOverviewTag(phaseState) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.overviewTag,
											"data-state": phaseState,
											children: OVERVIEW_STATE_LABEL[phaseState]
										}) : null
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Watcher_module_css_default.phaseMeta,
									children: phaseSummary
								})]
							})
						]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					id: `watcher-phase-body-${group.id}`,
					hidden: !open,
					children: observationMode === "itemized" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: Watcher_module_css_default.overviewStep,
								"data-current": stepLive ? "" : void 0,
								"data-parallel": step.parallel ? "" : void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
									className: Watcher_module_css_default.overviewStepHeader,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Watcher_module_css_default.stepToggle,
										"aria-expanded": stepOpen,
										"aria-controls": `watcher-step-body-${step.id}`,
										"aria-label": `步骤 ${step.step || "—"}，${step.executionCount} 次执行${stepDuration === null ? "" : `，耗时 ${stepDuration}`}，${stepOpen ? "收起步骤" : "展开步骤"}`,
										onClick: () => onToggleLayer("step", step.id),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
												size: 11,
												className: Watcher_module_css_default.stepChevron
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.overviewStepLabel,
												children: ["步骤 ", step.step || "—"]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Watcher_module_css_default.overviewStepSignals,
												children: [
													step.executionCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [step.executionCount, " 次"] }) : null,
													step.parallel ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: Watcher_module_css_default.parallelLabel,
														children: [step.executionCount, " 项并行"]
													}) : null,
													modelDuration === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["模型 ", modelDuration] }),
													showStepTotal ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["总 ", stepDuration] }) : null
												]
											})
										]
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									id: `watcher-step-body-${step.id}`,
									className: Watcher_module_css_default.overviewOccurrences,
									hidden: !stepOpen,
									children: timelineEntries.map((entry) => {
										if (entry.kind === "model") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelStage, {
											trace: entry.trace,
											stepId: step.id,
											now,
											open: modelOpen,
											disclosure,
											onToggle: () => onToggleLayer("model", step.id),
											onToggleReasoning: (key) => onToggleReasoning(key, step.id)
										}, `model:${step.id}`);
										const item = entry.item;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
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
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Watcher_module_css_default.analysisClusters,
						"data-observation-mode": "grouped",
						children: [modelSteps.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: Watcher_module_css_default.groupedModelStages,
							"data-open": groupedModelsOpen ? "" : void 0,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.groupedModelToggle,
								"aria-expanded": groupedModelsOpen,
								"aria-controls": `watcher-grouped-models-${group.id}`,
								onClick: () => onToggleLayer("model", groupedModelsKey),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
									size: 11,
									className: Watcher_module_css_default.groupedModelChevron
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型阶段汇总" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [modelSteps.length, " 个 Step · 按 Step 保留，不合并推理"] })] })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								id: `watcher-grouped-models-${group.id}`,
								className: Watcher_module_css_default.groupedModelList,
								hidden: !groupedModelsOpen,
								children: modelSteps.map((step) => {
									const modelOpen = layerDisclosureOpen(disclosure, "model", step.id);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.groupedModelStep,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.groupedModelStepLabel,
											children: ["步骤 ", step.step || "—"]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelStage, {
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
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Watcher_module_css_default.analysisSingleton,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
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
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: Watcher_module_css_default.analysisCluster,
								"data-open": clusterOpen ? "" : void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: Watcher_module_css_default.analysisClusterToggle,
									"aria-expanded": clusterOpen,
									"aria-controls": `watcher-cluster-body-${cluster.id}`,
									"aria-label": `${cluster.title}，${clusterMeta}，${clusterOpen ? "收起同类执行" : "展开同类执行"}`,
									onClick: () => onToggleLayer("cluster", cluster.id),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
											size: 11,
											className: Watcher_module_css_default.analysisClusterChevron
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Watcher_module_css_default.analysisClusterDotSlot,
											"aria-hidden": "true",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusMark, {
												status: cluster.latestStatus,
												className: Watcher_module_css_default.analysisClusterDot
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.analysisClusterCopy,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.analysisClusterTitle,
												children: cluster.title
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Watcher_module_css_default.analysisClusterMeta,
												children: clusterMeta
											})]
										}),
										cluster.executionCount > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: Watcher_module_css_default.analysisClusterCount,
											children: ["×", cluster.executionCount]
										}) : null
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									id: `watcher-cluster-body-${cluster.id}`,
									className: Watcher_module_css_default.analysisClusterItems,
									hidden: !clusterOpen,
									children: cluster.items.map((item) => {
										const sourceStep = group.steps.find((step) => step.items.some((candidate) => candidate.id === item.id));
										const branch = sourceStep === void 0 ? null : branchNumberOf(sourceStep, item);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewOccurrenceButton, {
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
		function Watcher({ useSession, useSessions, useProjection, sessionId, loadAllHistory }) {
			const running = useSessions((list) => Boolean(list.byId[sessionId]?.running));
			const snapshot = useSession((state) => state);
			const wholeSessionStats = useProjection("sessionStats");
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
			const sessionTiming = deriveSessionTiming(picture, now);
			const followRef = (0, react.useRef)(createFollow());
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const railRef = (0, react.useRef)(null);
			const programmaticScrollRef = (0, react.useRef)(false);
			const historyAbortRef = (0, react.useRef)(null);
			const panelPosition = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
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
			const nowLabel = picture.now.label || (picture.nodes.length > 0 ? "整理工作路径" : "等待第一步");
			const hasEdgeAlert = picture.pendingCount > 0 || picture.now.status === "failure" || picture.now.status === "interrupted";
			const summaryState = picture.pendingCount > 0 ? "等待你" : picture.running ? "正在执行" : picture.now.status === "failure" ? "最近一步失败" : picture.now.status === "interrupted" ? "已中断" : picture.nodes.length > 0 ? "已停稳" : "等待任务";
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
				startHistoryLoad();
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: Watcher_module_css_default.root,
				"data-dsh-watcher": "header",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconLivingEye, {})
				}), open ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: Watcher_module_css_default.menu,
					style: panelPosition ?? UNPLACED_PANEL_STYLE,
					role: "dialog",
					"aria-modal": "false",
					"aria-label": "Watcher 工作图",
					"data-dsh-watcher-panel": "",
					"data-ud-motion": "watcher-panel-enter",
					children: [selected === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionInspector, {
						group: selected,
						selectedItemId,
						live: picture.running && selected.id === lastGroupId,
						now,
						onSelectItem: setSelectedItemId,
						onBack: () => {
							backToLatest();
							setSelectedItemId(null);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Watcher_module_css_default.workPicture,
						"aria-label": "Agent 工作路径",
						"data-ud-check": "watcher-work-picture",
						"data-ud-role": "panel",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: Watcher_module_css_default.pictureHeader,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.nowBlock,
									"aria-live": "polite",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.eyebrow,
											"data-alert": hasEdgeAlert ? "" : void 0,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: summaryState })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: Watcher_module_css_default.now,
											title: nowLabel,
											children: nowLabel
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: Watcher_module_css_default.summary,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: snapshot.hasMore && totalTurnCount > picture.turnCount ? `已载入 ${picture.turnCount}/${totalTurnCount} 个对话轮次` : `${picture.turnCount} 个对话轮次` }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: snapshot.hasMore && totalStepCount > picture.stepCount ? `${picture.stepCount}/${totalStepCount} 个步骤` : `${picture.stepCount} 个步骤` }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [picture.actionCount, " 次执行"] }),
												snapshot.hasMore ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"data-partial": "",
													children: "仅最近历史"
												}) : null
											]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									className: Watcher_module_css_default.follow,
									active: ui.follow,
									"aria-pressed": ui.follow,
									"aria-label": ui.follow ? "停止跟随最新工作" : "跟随最新工作",
									onClick: () => {
										if (!ui.follow) programmaticScrollRef.current = true;
										setUi(followRef.current.setFollow(!ui.follow));
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 }), ui.follow ? "自动跟随" : "浏览历史"]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionTimeLedger, { timing: sessionTiming }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.viewToolbar,
								"aria-label": "路径视图设置",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.viewControl,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.viewToolbarLabel,
										children: "组织"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.viewMode,
										role: "group",
										"aria-label": "路径组织方式",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": observationMode === "itemized" ? "" : void 0,
											"aria-pressed": observationMode === "itemized",
											title: "按时间顺序展示每个步骤和每次执行",
											onClick: () => chooseObservationMode("itemized"),
											children: "逐项"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": observationMode === "grouped" ? "" : void 0,
											"aria-pressed": observationMode === "grouped",
											title: "按同一目标或完全相同的指令归类，展开仍可查看原始执行",
											onClick: () => chooseObservationMode("grouped"),
											children: "归类"
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Watcher_module_css_default.viewControl,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.viewToolbarLabel,
										children: "层级"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Watcher_module_css_default.viewMode,
										role: "group",
										"aria-label": "路径展开深度",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-active": disclosure.depth === "overview" ? "" : void 0,
											"aria-pressed": disclosure.depth === "overview",
											title: "展开当前轮次，展示阶段概览；阶段内部保持收起",
											onClick: () => chooseDepth("overview"),
											children: "概览"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
							snapshot.hasMore || historyLoad.kind === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.historyNotice,
								"data-state": historyLoad.kind,
								role: "status",
								"aria-live": "polite",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: Watcher_module_css_default.historyNoticeCopy,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: historyLoad.kind === "loading" ? "正在补齐历史" : historyLoad.kind === "error" ? "历史载入受阻" : historyLoad.kind === "complete" ? "历史已补齐" : "准备补齐历史" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: historyLoad.kind === "loading" ? `已载入 ${historyProgress}` : historyLoad.kind === "error" ? historyLoad.message : historyLoad.kind === "complete" ? `已载入 ${historyProgress}` : `当前 ${historyProgress}，即将自动载入更早记录` })]
								}), historyLoad.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: startHistoryLoad,
									title: "通过 RC8 官方会话分页重试补齐更早历史",
									children: "重试载入"
								}) : null]
							}) : null,
							!ui.follow && ui.unread > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: Watcher_module_css_default.unread,
								onClick: backToLatest,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { size: 12 }),
									ui.unread,
									" 条新进展 · 查看最新"
								]
							}) : null,
							picture.nodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Watcher_module_css_default.empty,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Watcher_module_css_default.emptyEye,
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconLivingEye, { size: 22 })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "还没有工作记录" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "第一轮对话开始后，路径会从这里生长" })
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								ref: railRef,
								className: Watcher_module_css_default.railViewport,
								onScroll: onRailScroll,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
											className: Watcher_module_css_default.turn,
											"aria-labelledby": `watcher-turn-${turn.turn}`,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
												className: Watcher_module_css_default.turnHeader,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
													id: `watcher-turn-${turn.turn}`,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
																size: 13,
																className: Watcher_module_css_default.turnChevron
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.turnCopy,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																	className: Watcher_module_css_default.turnTitleLine,
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: Watcher_module_css_default.turnTitle,
																		children: turnTitle
																	}), showOverviewTag(turnState) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: Watcher_module_css_default.overviewTag,
																		"data-state": turnState,
																		children: OVERVIEW_STATE_LABEL[turnState]
																	}) : null]
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnSummary,
																	children: turnSummary
																})]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: Watcher_module_css_default.turnPerformance,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnDuration,
																	children: duration === null ? OVERVIEW_STATE_LABEL[turnState] : duration.kind === "exact" ? `总 ${duration.value}` : `已记录 ${duration.value}`
																}), secondaryPerformance === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: Watcher_module_css_default.turnSpeed,
																	children: secondaryPerformance
																})]
															})
														]
													})
												})
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												id: `watcher-turn-body-${turn.turn}`,
												className: Watcher_module_css_default.turnBody,
												hidden: !turnOpen,
												children: [performance === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnMetricStrip, { performance }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: Watcher_module_css_default.groupRail,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: Watcher_module_css_default.railLine,
														"aria-hidden": "true"
													}), turn.groups.map((group) => {
														const isNow = group.id === lastGroupId;
														const selectedGroup = ui.selectedId === group.id;
														const phaseOpen = layerDisclosureOpen(disclosure, "phase", group.id);
														return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PhaseOverview, {
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
		//#region src/client/model-trace-definition.ts
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
				if (match.event.type !== "assistant/chunk") return "immediate";
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
			ctx.conversationEvents.register(modelTraceDefinition);
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-watcher-client";
		const inject = [
			"slots",
			"sessions",
			"conversationEvents"
		];
		/**
		* Native session-header utility. Order 50 sits after Session log (0)
		* and before the files-panel toggle (110). No overlay glyph.
		*/
		function apply(ctx) {
			registerModelTraceDefinition(ctx);
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-watcher",
				order: 50,
				label: "Watcher",
				inject: (sessionId) => {
					const session = ctx.sessions.binding(sessionId)?.session;
					if (session === void 0) throw new Error(`dsh-watcher: session "${sessionId}" is unavailable`);
					return { loadAllHistory: (signal) => loadCompleteHistory({
						signal,
						loadOlder: () => session.loadOlder(),
						read: () => {
							const snapshot = session.getSnapshot();
							const firstNode = snapshot.nodes[0];
							const firstTurn = snapshot.chat.timeline.turnOrder[0];
							return {
								hasMore: snapshot.hasMore,
								loadingOlder: snapshot.loadingOlder,
								headKey: `${firstTurn ?? "none"}:${firstNode?.seq ?? "none"}:${snapshot.nodes.length}`
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