[中文](./README.md) · English

# Watcher

A noisy Session becomes a foldable Agent work path.

Watcher is a read-only plugin for DeepSeek Harness WebUI. Open the eye in the session header. First you see how many steps ran, how many tools fired, and how long it took. Then you open a step: parallel branches, a tool result, or a reasoning row that stays folded until you ask.

It does not inject messages, invent hidden chain-of-thought, or replace the official Trajectory.

![Inside official Web, switching from itemized to grouped: two package.json edits collapse to ×2](docs/screenshots/switch-mode.gif)

These shots are official DeepSeek Harness Web. Watcher hangs off the eye in the session header. The conversation is a local Session replay. The panel reads the official ConversationSnapshot, not a standalone foldEvents page.

## The panel

A collapsed turn still keeps its phase count, execution count, duration, and tok/s. Open it and the strip splits model time, tool time, and time-to-first-token.

![Official session, eye open: three collapsed turns with phase counts, executions, and tok/s](docs/screenshots/collapsed-turns.png)

![Turn 3 expanded: the parallel step stays on its original Step](docs/screenshots/overview.png)

Parallel work stays on the same Step. Each branch is still its own row.

![Step 2: glob and grep running as two parallel branches](docs/screenshots/parallel.png)

Grouped view only stacks what it can prove. Two edits of the same `package.json` become ×2 and still open into the original rows. Two different bash calls stay apart.

![Grouped: edit package.json ×2, still steps 5 and 6 when opened](docs/screenshots/grouped.png)

The model stage shows only provider-visible reasoning already written into the Session. If nothing was recorded, it says so. The body stays folded.

## Install

You do **not** need dshx. The default path is official `dsh`.

```sh
dsh plugin --profile web add github:aa2246740/dsh-watcher
```

Or from a clone:

```sh
git clone https://github.com/aa2246740/dsh-watcher.git
dsh plugin --profile web add ./dsh-watcher
```

Then **restart that DSH Host** and **reload the page**. `dsh plugin add` writes the profile; it does not hot-load a running Host.

Remove:

```sh
dsh plugin --profile web remove dsh-watcher
```

DeepSeek Harness `0.1.0-rc.8` · Node `^22.19.0` or `>=24`.

The interaction contract lives in [DESIGN.md](./DESIGN.md). MIT. Watcher is not an official DeepSeek project.

## Optional: dshx

Already using an Agent against a Harness checkout? Install [dshx](https://github.com/aa2246740/dsh-external-plugin-devkit), then give the Agent both that repo and this one (`https://github.com/aa2246740/dsh-watcher`). It can take it from there.
