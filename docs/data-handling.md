# Data handling

Watcher reads the session the host already has: prompts, tool calls, tool results, and the token counts the provider wrote into the session. That text can contain personal data. The plugin does not add an account, a cookie banner, or an upload path.

- Rendering stays in the host page. There is no fetch of session text.
- The default price table is the file `pricing/models.yaml`. The settings editor writes only changed rows to `localStorage` key `dsh-watcher:pricing-override:v1`.
- Logs go through `src/log.ts`. `redact` masks `token`, `key`, `secret`, `password`, `authorization`, and `bearer` assignments, including query strings, before `console.debug` / `console.log` / `console.error`.
- The acceptance script may receive a host startup token in `DSH_TEST_URL`. It must not print that URL or save browser storage.

Tests that need a fixture should use `WATCHER_GOLDEN_DIR` or the builders in `tests/`. Do not commit a real session transcript.
