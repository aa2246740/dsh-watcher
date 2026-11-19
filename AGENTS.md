# Watcher agent notes

Read-only DeepSeek Harness plugin. It folds a session into a work picture and prices token use from `pricing/models.yaml`. It does not send session text anywhere.

## Commands

```commands
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:list
pnpm test:coverage
pnpm boundaries
pnpm deadcode
pnpm duplicates
pnpm size
pnpm check:todos
pnpm check:agents
pnpm build
```

`pnpm test` compiles with `tsc`, then runs Vitest in isolated processes and prints `test-suite-duration-ms`. A failed test is retried once (`retry: 1`). `pnpm test:list` lists test names and does not run them. `pnpm test:coverage` enforces the line, function, and branch floors in `vitest.config.mjs`. `pnpm boundaries` checks that `observation`, `insights`, and `hub` do not import the client panel.

`pnpm build` refreshes the committed `lib/` bundle. `tools/client-build.js` is vendored, so a normal build does not need a Harness checkout. Set `DSHX_HARNESS` only when that adapter file is missing.

Do not reformat `src/` or `tests/` with Prettier. `tests/presentation-contract.test.mjs` locks JSX and CSS source text. Prettier covers Markdown, YAML, and JSON. ESLint covers `src/` and `tests/`.

## Environment

Copy `.env.example`. None of these are required for `pnpm test`.

- `DSHX_HARNESS`: absolute Harness checkout, only if `tools/client-build.js` is absent.
- `DSH_TEST_URL`: local Host only (`127.0.0.1`, `localhost`, or `[::1]`). The startup token, if the host printed one, belongs in this URL. Watcher has no account of its own.
- `DSH_TEST_WORKSPACE`: exact workspace name already visible in that host.
- `DSH_TEST_SESSION`: exact session title already visible in that workspace.
- `WATCHER_GOLDEN_DIR`: optional fixture directory for `tests/golden-replay.test.mjs`. Without it, that test skips.

## Interactive check

1. Install dependencies with `pnpm install`. The pnpm version is `packageManager` in `package.json` (pnpm 12.20.0); CI, publish, and Dependabot use the same one, and a global pnpm 10 or later switches to it.
2. Install the plugin into the local web profile: `dsh plugin --profile web add ./dsh-watcher`. Official `dsh` is `@deepseek-ai/dsh`; this package targets Harness `0.2.2-rc.5` and accepts `0.2.0-rc.2` through stable `0.2.2` (see `engines.dsh`), and Node `^22.19.0` or `>=24`.
3. Start the host with `dsh web`. If it prints a local URL with a startup token, that URL is the auth gate. There is no second login inside Watcher.
4. In the host, select a workspace and a session. Remember the exact workspace name and session title.
5. Either click the session-header button named Watcher and wait for the dialog `Watcher 工作图`, or run the scripted path:

```sh
DSH_TEST_URL='http://127.0.0.1:<port>' \
DSH_TEST_WORKSPACE='<workspace>' \
DSH_TEST_SESSION='<session title>' \
node tests/acceptance/restore-session.mjs
```

The script opens the workspace, opens the session, reloads, clicks Watcher, and requires the work-picture dialog. It does not create a host or a session.

## Naming

Functions and variables are camelCase. React components and their files are PascalCase (`Watcher.tsx`, `Insights.tsx`). Other modules stay kebab-case or a single lowercase word. CSS module classes are camelCase. Do not rename a file just to match a new rule; the contract tests match source text.

## Data and logs

Session text, tool output, and token counts stay in the host process. Pricing does not use the network. `src/log.ts` redacts token, key, secret, password, and bearer values before `logInfo` / `logError`. Use those helpers instead of `console.error` on paths that can see a host error. Details are in `docs/data-handling.md`. When the button is missing, the price says 未知, or the plugin should be removed, follow `docs/runbook.md`. The host load line must remain the text `[my-plugins/dsh-watcher] loaded` (`dshx.yml` marker).

## While editing

- Projection math lives in `src/insights/engine.mjs` and `src/observation/`. The panel lives in `src/client/`.
- Keep `lib/` built before publishing. `lib/types/` is a `tsc` output and is gitignored.
- A `TODO`, `FIXME`, `HACK`, or `XXX` must name an issue: `TODO(#12)`. `pnpm check:todos` enforces that.
- File length and function complexity are capped in `eslint.config.js`.
- `src/observation` does not import `client`, `hub`, or `insights`. `src/insights` and `src/hub` do not import `client`. `pnpm boundaries` enforces that.
