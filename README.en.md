[中文](./README.md) · English

# Watcher

Prefer npm (version-pinable):

```sh
dsh plugin --profile web add dsh-watcher@0.6.0
```

Or latest:

```sh
dsh plugin --profile web add dsh-watcher
```

Fallback: install from GitHub (tracks the default branch tip):

```sh
dsh plugin --profile web add github:aa2246740/dsh-watcher
```

You need official `dsh` (or `npx @deepseek-ai/dsh`) and **pnpm** on `PATH`. `dsh plugin add` runs pnpm in `$DSH_HOME/profiles/web` and, because this package declares `dsh.bundle.patch`, appends the bundle to that profile. Then **restart that Host and reload the page**. The command writes the profile. It does not hot-load a running process.

`lib/` is committed, so npm / git installs do not need a local build, `prepare`, or `allowBuilds`. DeepSeek Harness **0.1.7-rc.1** (`@deepseek-ai/dsh@0.1.7-rc.1`). Node `^22.19.0` or `>=24`.

A read-only plugin for DeepSeek Harness Web. Open the eye in the session header. A Session becomes a foldable work path: how many steps ran, how many tools fired, how long it took. Open a step for parallel branches, a tool result, or a reasoning row that stays folded until you ask.

It does not inject messages, invent hidden chain-of-thought, or replace the official Trajectory.

![Switching from itemized to grouped: two package.json edits collapse to ×2](docs/screenshots/switch-mode.gif)

![Three collapsed turns with phase counts, executions, and tok/s](docs/screenshots/collapsed-turns.png)

![Turn 3 expanded: the parallel step stays on its original Step](docs/screenshots/overview.png)

![Step 2: glob and grep running as two parallel branches](docs/screenshots/parallel.png)

![Grouped: edit package.json ×2, still steps 5 and 6 when opened](docs/screenshots/grouped.png)

Grouped view only stacks what it can prove. Two different bash calls stay apart. The model stage shows only provider-visible reasoning already written into the Session. If nothing was recorded, it says so.

From a clone:

```sh
git clone https://github.com/aa2246740/dsh-watcher.git
dsh plugin --profile web add ./dsh-watcher
```

That path also needs pnpm, then a Host restart and page reload.

```sh
dsh plugin --profile web remove dsh-watcher
```

DSH.app's `desktop` profile rejects `github:`. Use `dsh web` and install into the `web` profile.

The settings summary and session HUD show **Estimated cost** (not “total value”) next to total tokens. Input / output / cache buckets are priced from `pricing/models.yaml`. A missing row is **Unknown**, never $0. A partial estimate keeps the known dollar in the main number and footnotes **Some models unpriced**. It is an estimate, not a bill. The default table covers mainstream DeepSeek, MiniMax, OpenAI, Anthropic, Gemini, Grok, GLM, and Qwen rows and is static (no live fetch). Override it in Watcher settings (`localStorage` key `dsh-watcher:pricing-override:v1`). PRs to the default table are welcome.

The interaction contract lives in [DESIGN.md](./DESIGN.md). MIT.

## What's new in 0.6.0

- Targets official DeepSeek Harness **0.1.7-rc.1**. `@deepseek-ai/dsh-*` peers are `>=0.1.7-rc.1 <0.1.8`, so install accepts `0.1.7-rc.1` and rejects `0.1.7-alpha.*`.
- Icons are `IconChevronRightOutlineRegular`, `IconRefreshOutlineRegular`, `IconCheckOutlineRegular`, and `IconCopyOutlineRegular`. rc.1 removed the size-suffixed exports and ships no aliases.

## 0.5.0

- **The panel resizes.** Drag the right edge, the bottom edge, or the corner grip; the frame stays put while it grows, and it can never shrink below the size it opened at.
- **The HUD folds to one line.** A `▾` next to the scope switch collapses the timing panel to just the top bar, and the choice is remembered.
- **"定位现场" lands on the actual failure.** It now selects the exact failing step and opens the inspector on it instead of scrolling to a bare turn header.
- **Repeated failures no longer stack.** One failure chain updates one card, and the title names its turn (`第 N 轮`).

Plus the 0.4.5 fixes: the inspector back control no longer re-arms follow, the first range pick no longer rescans sessions, the projection state no longer stores a copy of its own view, and the timing panel's non-terminal slice is labelled correctly.

Older releases: [CHANGELOG.md](./CHANGELOG.md).

## Build from source

Skip this for a normal install. Rebuild the committed `lib/` with **pnpm** after TypeScript changes:

```sh
pnpm install
pnpm test
node scripts/link-harness-dependencies.mjs /path/to/harness
pnpm build
```

`pnpm build` needs a local Harness checkout that can resolve the `@deepseek-ai/dsh-*` peers. Do not use this path to install the plugin.

Watcher waits for the Chat projection on cold sessions before mounting its panel.
