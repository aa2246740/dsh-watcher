# Cloud agent constraints

Only use grok 4.6.

Prefer Grok or Composer only.

Never Claude / Sonnet / Opus / GPT / Gemini.

Do not spawn Task / computerUse / browser / explore / video unless explicitly required.

Child agents omit `model` and inherit the parent. Never pass a model slug.

Never launch subagents (Task / explore / browser / computerUse / video) with other models. Only use grok 4.6. Never select Claude / GPT / Gemini; stay on the parent Grok model only.
