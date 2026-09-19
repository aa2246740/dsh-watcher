#!/usr/bin/env bash
# Deny Claude / Sonnet / Opus / GPT / Gemini model slugs and computerUse / browser subagents.
set -euo pipefail

payload="$(cat || true)"
payload_lc="$(printf '%s' "$payload" | tr '[:upper:]' '[:lower:]')"

deny() {
  local reason="$1"
  printf '{"permission":"deny","decision":"deny","continue":false,"user_message":"%s"}\n' "$reason"
  exit 0
}

if printf '%s' "$payload_lc" | grep -Eq '"subagent_type"[[:space:]]*:[[:space:]]*"(computeruse|browser|videoreview)"'; then
  deny "Blocked computerUse/browser/video subagent. Inherit the parent Grok 4.6 run."
fi

if printf '%s' "$payload_lc" | grep -Eq '"model"[[:space:]]*:[[:space:]]*"[^"]*(claude|sonnet|opus|gpt|gemini)[^"]*"'; then
  deny "Blocked Claude/Sonnet/Opus/GPT/Gemini. Only Grok 4.6; subagents must inherit the parent model."
fi

if printf '%s' "$payload_lc" | grep -Eq '"agent"[[:space:]]*:[[:space:]]*"(computeruse|browser|videoreview)"'; then
  deny "Blocked computerUse/browser/video subagent. Inherit the parent Grok 4.6 run."
fi

printf '{"permission":"allow","decision":"allow","continue":true}\n'
exit 0
