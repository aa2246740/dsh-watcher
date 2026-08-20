---
version: alpha
name: Watcher Work Picture
description: A quiet, truthful observability instrument for understanding a DSH agent's turns, steps, parallel actions, retries, and evidence without reading the full transcript.
colors:
  primary: "#4D6BFE"
  text-primary: "#17181C"
  text-secondary: "#5F636D"
  text-tertiary: "#858A94"
  surface-menu: "#FFFFFF"
  surface-subtle: "#F5F6F8"
  border-subtle: "#E2E4E9"
  accent: "#4D6BFE"
  success: "#1E9E62"
  warning: "#B26A00"
  error: "#D83B3B"
typography:
  ui-body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.55"
    letterSpacing: "0"
  ui-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "1.4"
    letterSpacing: "0"
  ui-label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "1.5"
    letterSpacing: "0"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.55"
    letterSpacing: "0"
rounded:
  control: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  watcher-trigger:
    backgroundColor: "{colors.surface-menu}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    size: "32px"
  watcher-panel:
    backgroundColor: "{colors.surface-menu}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: "{spacing.md}"
  work-action:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.control}"
    padding: "{spacing.sm}"
---

## Overview

Watcher is a read-only session-header utility for people supervising long-running DSH agents. Its primary job is to answer three questions quickly: what is happening now, how the work reached this point, and what exactly happened in a selected execution. It complements the official Trajectory view; it does not replace or duplicate the full transcript.

The visual direction is a quiet editorial instrument: a session summary, collapsible Turn chapters, a chronological phase rail, and a structured inspector that grows beside it. Step and execution detail stay behind selection instead of leaking into the overview. The living eye is the only brand-like memory feature. Repeated cards, decorative gradients, glass, large shadows, and unearned badges are intentionally excluded.

## Colors

The implementation consumes DSH `--dsw-*` semantic tokens so light and dark themes remain native. Front-matter colors document role and contrast intent; they are fallback references, not permission to hard-code a parallel theme. Error, running, success, and unknown states always include text or icons and never rely on color alone.

## Typography

Interface copy uses the host system family. Body and metadata are 13px and 12px respectively; code and raw results are 13px. Node titles use 15–16px. Tabular figures are required for Turn, Step, duration, exit code, and counts. Critical paths and commands wrap or scroll into a full-view surface; they are never silently truncated.

## Layout

The desktop panel is a two-column instrument: a 340–390px work picture on the right and a 380–460px inspector on the left after selection. The work picture is primary on first open. At narrow widths the inspector stacks beneath the work picture without page-level horizontal scrolling. The phase rail follows the latest work until the user selects or scrolls away; new work then increments an explicit unread count without moving the viewport. Historical Turns start collapsed; the latest and attention-bearing Turns start expanded and remain user-toggleable.

Information hierarchy:

1. Current status and current action.
2. Turn chapters and user-facing work phases.
3. Step and individual execution identity after selection.
4. Structured result, arguments, timing, and full raw evidence.

## Elevation & Depth

Use the host menu surface, one border, and the host level-3 menu shadow. Depth communicates that the utility is anchored above the session header; nested content uses dividers and surface contrast, not more shadows.

## Shapes

The panel uses the host 12px menu radius. Rows use 8px only when they are interactive. Pills are reserved for semantic state or user controls. The rail is a one-pixel rule with compact junctions for parallel actions; it is not a decorative flow line.

## Components

### Work picture

- One collapsible chapter per Turn; it must never merge across Turn boundaries. Turn headers carry duration and useful totals, not a duplicated status dot.
- One overview row per consecutive user-facing phase. Step boundaries remain preserved in the data and Inspector but are not another visible overview level.
- Every tool occurrence keeps a stable id and remains selectable even when the summary groups it visually.
- Step counts are suppressed entirely in the overview; `1 次执行` is also hidden. Only plural execution counts, parallelism, retry, or iteration remain visible.
- `N 次执行` means distinct recorded occurrences. `重试 N 次` requires the same normalized tool and arguments after a failed or unknown attempt. `迭代 N 版` requires the same target with changed input. `循环 N 次` is forbidden unless the same multi-action path is proven to repeat.
- User steering, interruptions, turn failures, images/artifacts, and waiting states are first-class when the official snapshot exposes them.

### Inspector

- Layer 1 is a plain-language summary and status.
- Layer 2 is structured evidence: command, arguments, path, duration, exit code, and render-intent result.
- Layer 3 is complete raw evidence with an explicit disclosure and copy path. Preview caps may collapse the middle, but the complete value remains reachable.
- On narrow screens, selection uses a single-pane drill-down: the Inspector replaces the Work Picture and exposes an explicit `返回工作路径` control. Desktop keeps both panes visible for comparison.
- Shell results use `TerminalBlock`; reads use `ReadBlock`; file changes use `DiffBlock`; structured objects use `JsonTree`.
- Text results use the official `MarkdownText` reading pipeline: proportional prose, semantic headings/lists/tables/quotes, inline code, and highlighted fenced code. The Raw tab remains the exact, copyable source and is the fallback whenever users need byte-level evidence.
- Untrusted Markdown never enters an HTML parser in Watcher. Unsafe protocols, relative links, and raw HTML follow the official primitive's fail-closed policy.

### State language

Overview progress and execution evidence are separate axes. Overview markers answer only “where should I look?”; execution statuses answer “what evidence was returned?”.

- Overview `当前`: latest active or latest settled phase; blue marker plus visible text.
- Overview `等待用户`: authoritative pending interaction; amber marker plus visible text.
- Overview `需要处理`: failure or interruption that still deserves attention; red marker plus visible text.
- Overview `已结束`: historical settled phase, regardless of whether its evidence is authoritative success or neutral return; filled neutral marker, never an empty ring.
- Overview `数据不完整`: required history is unavailable; dashed marker plus visible text.

- `进行中`: the call has no result yet.
- `成功`: authoritative success evidence exists, such as exit code 0 or a non-error typed result.
- `失败`: `isError`, a terminating signal, a nonzero authoritative exit code, or a Turn error exists.
- `已返回`: a result exists but the domain did not declare success; this is neutral, never green by inference.
- `等待用户`: a pending approval or question is authoritative in the observed data.
- `已中断`: the agent or Turn explicitly stopped.
- `未知`: required evidence is outside the loaded window or unavailable.
- `成功` remains an execution-level evidence claim. A Turn or phase never becomes green merely because one child succeeded.
- Header attention describes the current edge only: a pending interaction, latest failure, or interruption. Historical failures stay visible in their chapters but never keep the eye red after later work has moved on.

## Do's and Don'ts

Do preserve Turn, Step, parallel, and per-execution identity. Do show neutral `已返回` when success is not known. Do keep commands, paths, and output readable at normal zoom. Do use DSH primitives and tokens before inventing local components.

Do not merge actions merely because their tool or Chinese label matches. Do not call an adjacency a loop. Do not display `×N` when the N occurrences have different arguments. Do not infer success from the mere presence of a result. Do not silently cut raw output. Do not add steering, diagnosis, or model-visible reasoning to this observation-only surface.

## Design Mandate

- Product intent: turn raw session execution into a calm, truthful work picture rather than another transcript viewer.
- Deliverable: Watcher as an external DSH Web client plugin.
- Primary audience: DSH users supervising active or completed agent sessions.
- Core job to be done: understand the agent's current action and causal workflow, then inspect any exact execution without reading raw session JSONL.
- Success criteria: a three-level visible hierarchy (`会话 → 回合 → 阶段`); Step/execution detail on demand; progress markers that never impersonate radio buttons; no aggregate green success; precise execution drill-down; semantic Results and exact raw evidence; official WebUI compatibility; no DSH core edit; no Host restart for client-only updates, with one page refresh after first installation.
- Must preserve: observation-only scope, header utility seat, DSH token language, Follow behavior, HMR lifecycle, keyboard access, and `prefers-reduced-motion`.
- Non-goals: agent steering, hidden reasoning exposure, a second model, process control, DSH core modification, or cloning the full official Trajectory ledger.
- Validation must check against: both supplied full-session logs; exact per-execution identity; WebUI keyboard, overflow, type-size, and reduced-motion behavior; TypeScript, bundle, and dshx contracts.

## Content Model

Canonical overview nouns are `回合` (Turn) and user-facing work phases such as `理解任务`, `检查与理解`, `修改实现`, `验证结果`, and `给出答复`. `步骤` (Step) and `执行` (one tool occurrence) are evidence-detail nouns and stay inside the Inspector. Avoid the ambiguous `节点`, generic `动作 ×N`, and `循环` without proof. The first view answers “现在 / 路径”; selection opens “证据”. `结果` is the interpreted reading view; `原始` is the exact recorded source.

Empty copy explains that the first Turn will grow here. Partial-data copy names what is unavailable. Errors state both what failed and the available recovery path. Long localized copy wraps; Chinese and English tool names may coexist without sentence concatenation.

## Information Architecture

- Primary task: scan the causal work rail.
- Secondary task: select one Step or execution to inspect.
- Tertiary task: copy or expand complete raw evidence.
- Navigation model: header trigger → work picture → Step → execution → structured/raw evidence.
- Required states: empty, opening, following, pinned/unread, running, parallel, returned-neutral, success, failure, waiting-user, interrupted, partial-history, and reduced-motion.

## Taste Signature

- Design read: a high-frequency desktop observability tool; clarity and trust outrank expression.
- Necessary judgment: demote totals and decoration; preserve causal boundaries, exact identity, and evidence.
- Taste dials: variance 3/10, density 7/10, motion 3/10, distinction 5/10, type expression 2/10, experiment risk 2/10.
- Category defaults avoided: dashboard card grids, AI gradients, glass, decorative badges, animated flow backgrounds, and fake “premium” minimalism.
- Layout families: continuous work rail plus evidence inspector.
- Visual memory feature: the eye quietly scans while the agent is live, then centers at rest.
- Type personality: native utility type recedes; code remains legible and exact.
- Asset policy: only official snapshot evidence and supplied DSH primitives; no fake screenshots or inferred proof.

## Necessary Judgment

- Removed or demoted: fake loops, `×N` aggregation, generic green completion, tiny code, and nested card chrome.
- Must remain: Turn/Step causality, per-execution identity, Follow, structured/full evidence, and observation-only copy.
- Inevitable relationships: status belongs to execution evidence; parallelism belongs to one Step; inspector selection belongs to one stable occurrence.
- Craft tolerances: 12px minimum metadata, 13px code/body, 44px comfortable row targets where space permits, aligned rail junctions, 120–220ms transitions.
- Care states: empty, partial history, long output, keyboard focus, reduced motion, failure, and pending interaction.
- Material honesty: result presence is not proof of success; pattern labels require evidence.
- Scene fit: dense enough for supervision, quiet enough to leave the conversation primary.

## Motion Strategy

- Motion purpose: feedback and continuity, with one small liveness memory cue.
- Motion budget: Micro / Component.
- Primary focus: panel origin, selection continuity, and the live eye pupil.
- Do-not-move zones: commands, output, code, Turn labels, error copy, counters, and the work rail geometry.
- Trigger model: panel on open; row state on hover/focus/selection; eye only while the session is running.
- Duration/easing: press 100ms, hover/focus 140ms, panel 180ms `cubic-bezier(.2,.8,.2,1)`, selection 160ms. No delayed stagger.
- Reduced motion: no pupil scan or blink; panel and selection appear immediately; all information remains visible.
- Performance: transform and opacity only for motion; at most the eye and one panel transition run concurrently.

## Motion Contract

| Motion id | Promise | Route | Trigger | Acceptance |
|---|---|---|---|---|
| `watcher-eye-scan` | While live, the pupil makes a subtle horizontal scan and occasional blink; at rest it centers. | CSS keyframes | `[data-live]` state | pupil stays within 1.5px, does not encode status alone, stops under reduced motion |
| `watcher-panel-enter` | The panel appears from its trigger origin without delaying interaction. | CSS animation | open | 180ms or less, transform/opacity only, no first-paint flash |
| `watcher-selection` | Selected execution gains immediate stable emphasis. | CSS transition | focus/press/selection | 160ms or less, interruptible, no layout movement |

Implementation markers: `data-ud-motion="watcher-eye-scan"`, `data-ud-motion="watcher-panel-enter"`, and `data-ud-motion="watcher-selection"`. Browser validation samples running, settled, and `prefers-reduced-motion: reduce` states.

## OKF Preflight

- Execution mode: single-agent implementation.
- Active references loaded: information architecture, state language, semantic binding, taste engine, necessary design judgment, typography system, motion language, motion contract, accessibility/usability, responsive interaction, tokens/components, and design-to-code governance.
- Support references: request integrity, web-product branch, content model, audit/polish, visual verification, and quality gates.
- Constraints extracted: observation-only DSH Web client; native semantic tokens and result primitives; no cross-Turn grouping; no unproven retry, iteration, loop, or success claims; body/code at least 13px; metadata at least 12px; bounded motion with a static reduced-motion fallback.
- Deliberate exceptions: live approval duration is shown only when an authoritative registered view exposes it; offline golden replay may inspect the complete historical event stream.
- Verification hooks: `data-ud-check` on both panels; `data-ud-motion` on the eye, panel, and selection; golden replay assertions; computed-style and overflow browser checks.

## OKF Decision Bindings

| Reference | Decision | Artifact target | Verification |
|---|---|---|---|
| `foundations/information-architecture` | Overview exposes only session, Turn, and phase; Step and execution move behind selection. | panel structure | screenshot hierarchy review and DOM level count |
| `content/state-language` | Separate overview progress/attention from execution outcome; never render neutral return as an empty ring or aggregate one child success into green. | overview projection and copy | projection unit tests and settled/current/error screenshots |
| `content/semantic-binding` | Native buttons/details, visible labels, full-view path for critical truncation. | React markup | keyboard, accessible-name, and long-output tests |
| `content/message-model` | Put interpreted result before exact raw source; preserve both without duplicating the transcript. | Inspector tabs and text renderer | mixed Markdown visual fixture and raw parity check |
| `systems/taste-engine` | Quiet rail + inspector; reject card-grid and decorative dashboard defaults. | CSS composition | before/after visual critique |
| `foundations/necessary-design-judgment` | Remove duplicated Turn dots, singleton technical counts, and any marker that fails the Delete/Material Honesty tests. | Turn disclosure, phase rows, summary | before/after visual critique |
| `systems/typography-system` | 13px body/code, 12px metadata, tabular execution data. | CSS tokens | computed-style and narrow-width audit |
| `systems/motion-language` | Micro/component budget; only feedback, continuity, and liveness move. | eye/panel/selection CSS | normal-motion browser sampling |
| `systems/motion-contract` | Stable ids, bounded pupil movement, reduced-motion static fallback. | DOM markers and CSS | normal/reduced computed-style checks |
| `digital/accessibility-usability` | WCAG 2.2 AA posture, keyboard access, focus, non-color state language. | controls and states | keyboard walkthrough and contrast review |
| `digital/responsive-interaction` | Desktop keeps overview and evidence side by side; narrow screens use a full-height, reversible Inspector drill-down without page overflow. | responsive CSS and Inspector back action | desktop and narrow screenshots plus return interaction |
| `systems/tokens-components` | Consume DSH semantic tokens and official result primitives. | CSS and inspector | source audit and component tests |
| `governance/design-to-code-governance` | Design contract precedes implementation and golden regressions protect semantics. | `DESIGN.md`, tests | contract validation plus test run |

## Quality Gates

- No visual grouping crosses a Turn boundary.
- The overview has exactly three visible conceptual levels: session summary, Turn chapter, and phase row. Step and execution appear only after selection.
- Turn chapters do not repeat phase status markers. Historical Turns default collapsed; latest and attention-bearing Turns default expanded and every Turn is keyboard-toggleable.
- A filled neutral marker means historical settled work; blue means current, amber means waiting, red means attention, and dashed means partial data. Every non-settled state also has visible text.
- No overview marker is an empty ring, and overview never turns green from an aggregate `some(success)` rule.
- `步骤` counts and `1 次执行` are absent from the overview; plural execution counts, parallelism, retries, and iterations remain visible when informative.
- Parallel calls in one Step stay visibly parallel and individually selectable.
- No `循环` label without a proven repeated path.
- No `重试` label unless normalized tool and arguments match and a preceding attempt failed or remained unknown.
- A historical failure must not masquerade as the current state after later work has moved on.
- Full output remains reachable beyond any preview cap.
- Text Results use proportional document typography; they must not fall back to one monochrome `<pre>` surface.
- Markdown headings, lists, quotes, tables, links, inline code, and fenced code render semantically; fenced code retains its language banner, highlighting, horizontal containment, and copy action.
- Raw HTML and unsafe or relative link destinations remain inert under the official renderer's untrusted-output policy.
- The Raw tab preserves the exact source and stays copyable even when the Result tab interprets Markdown.
- Inner structured exit codes and official terminal result views drive failure status.
- Body/code/metadata meet 13/13/12px minimums.
- A status primitive never participates in the work-row grid: its plugin-owned absolute wrapper leaves the copy track at normal reading width in every state.
- The Watcher surface is portaled to the viewport layer; no sidebar, banner, transcript, or sticky Composer may paint above any sampled point inside the panel.
- On narrow screens, the overview uses the full available shell height. Selecting a phase swaps to a full-height Inspector with a visible `返回工作路径` action; closing that drill-down restores the overview without closing Watcher.
- Escape closes and returns focus; every selectable row has visible focus.
- Desktop and narrow layouts have no page-level horizontal overflow.
- Normal and reduced-motion states pass browser inspection.
- `pnpm typecheck`, focused tests, build, and `dshx check` pass before activation claims.

## Assumptions

- The official RC8 `ConversationSnapshot` and tool presentation views are authoritative when present.
- Older or partial histories may lack call heads, timing, or presentation metadata; the UI names that absence instead of guessing.
- First installation is a `new-client` change: activate the Host row, then refresh the page once so the boot graph includes Watcher. Later client-only rebuilds use the existing-client HMR branch without a Host restart.

## Open Questions

- Approval wait duration is not part of the generic live `ConversationSnapshot`; Watcher shows it only when an authoritative registered view exposes it. The external golden-log parser can still prove historical wait handling without inventing live data.

## Review Log

- 2026-08-20: V2 contract created from the existing plugin, official RC8 Conversation/Trajectory/tool-presentation contracts, and two supplied session logs. Structural repair precedes visual polish.
- 2026-08-20: Supplied screenshots exposed two P0 integration defects: neutral/state dots could become grid children and squeeze copy to 14px, while the header-owned stacking context let shell chrome and the sticky Composer cover the panel. Repaired with a plugin-owned dot wrapper, the official anchored-position hook, and a body portal; pinned-Chromium red-to-green checks passed at 460x724 and 920x900, including an open Inspector over the Composer, without restarting the Host.
- 2026-08-20: File Panel study showed that readable preview should reuse RC8 `MarkdownText` while source remains a separate exact view. Watcher adopted the same semantic pipeline for text Results instead of maintaining a plugin-local parser or monochrome `<pre>` fallback.
- 2026-08-20: First-principles flow audit found that the hollow neutral-return ring looked unfinished, Turn and phase duplicated the same marker, and Step/execution taxonomy leaked into overview copy. Contract revised to three visible levels, separate overview progress from evidence outcome, collapse historical Turns, and suppress singleton technical counts.
- 2026-08-20: Pinned-Chromium narrow review found that a 48vh overview cap and split overview/Inspector made both panes needlessly cramped. Narrow layout now grants the overview the full shell and uses a reversible single-pane Inspector drill-down; desktop remains side by side.
