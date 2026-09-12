[中文](./README.md) · English

# Watcher

```sh
dsh plugin --profile web add github:aa2246740/dsh-watcher
```

You need official `dsh` (or `npx @deepseek-ai/dsh`) and **pnpm** on `PATH`. `dsh plugin add` runs pnpm in `$DSH_HOME/profiles/web` and, because this package declares `dsh.bundle.patch`, appends the bundle to that profile. Then **restart that Host and reload the page**. The command writes the profile. It does not hot-load a running process.

`lib/` is committed, so a git install does not need a local build, `prepare`, or `allowBuilds`. DeepSeek Harness **0.1.5-rc.2**. Node `^22.19.0` or `>=24`.

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

The interaction contract lives in [DESIGN.md](./DESIGN.md). MIT.

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
