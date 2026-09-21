/** Browser-safe static pricing. No network, no live list-price fetch. */
import { costCopy } from './i18n.mjs';

export const PRICING_STORAGE_KEY = 'dsh-watcher:pricing-override:v1';
export const PRICING_UNIT = 'per_1m_tokens';
const PER_MILLION = 1_000_000;
const UNLABELED = new Set(['', 'unknown', '未标注', '其他模型', '全部模型']);

/**
 * Bundled defaults. `pricing/models.yaml` is the documented source; tests
 * require that file to parse to this table.
 */
export const DEFAULT_PRICING_TABLE = Object.freeze({
  currency: 'USD',
  unit: PRICING_UNIT,
  models: Object.freeze({
    'deepseek-flash': Object.freeze({
      aliases: Object.freeze([
        "deepseek-v4-flash",
        "deepseek-v4-flash-vision-exp",
        "deepseek-v4.1-flash",
        "deepseek-v4-1-flash",
        "deepseek-chat",
        "deepseek-reasoner",
        "openrouter/deepseek/deepseek-chat",
        "openrouter/deepseek/deepseek-reasoner",
        "openrouter/deepseek/deepseek-v4-flash",
        "openrouter/deepseek/deepseek-v4.1-flash",
        "deepseek-flash",
        "DeepSeek V4 Flash",
        "DeepSeek-V4-Flash",
        "DeepSeek V4.1 Flash",
        "DeepSeek-V4.1-Flash",
        "deepseek/deepseek-flash",
        "openrouter/deepseek/deepseek-flash",
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-chat",
        "deepseek/deepseek-reasoner",
      ]),
      currency: 'USD',
      input: 0.15,
      output: 0.6,
      cache: 0.003,
    }),
    'deepseek-v4-pro': Object.freeze({
      aliases: Object.freeze([
        "deepseek-pro",
        "openrouter/deepseek/deepseek-v4-pro",
        "deepseek-v4-pro",
        "DeepSeek V4 Pro",
        "DeepSeek-V4-Pro",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-pro",
        "openrouter/deepseek/deepseek-pro",
      ]),
      currency: 'USD',
      input: 0.66,
      output: 1.98,
      cache: 0.022,
    }),
    'minimax-m2.7': Object.freeze({
      aliases: Object.freeze([
        "MiniMax-M2.7",
        "minimax-m2.7",
        "openrouter/minimax/minimax-m2.7",
        "MiniMax M2.7",
        "minimax/minimax-m2.7",
      ]),
      currency: 'USD',
      input: 0.3,
      output: 1.2,
      cache: 0.06,
      cacheWrite: 0.375,
    }),
    'minimax-m2.7-highspeed': Object.freeze({
      aliases: Object.freeze([
        "MiniMax-M2.7-highspeed",
        "minimax-m2.7-highspeed",
        "openrouter/minimax/minimax-m2.7-highspeed",
        "MiniMax M2.7 highspeed",
        "minimax/minimax-m2.7-highspeed",
      ]),
      currency: 'USD',
      input: 0.6,
      output: 2.4,
      cache: 0.06,
      cacheWrite: 0.375,
    }),
    'claude-sonnet-5': Object.freeze({
      aliases: Object.freeze([
        "claude-sonnet-5",
        "anthropic/claude-sonnet-5",
        "Claude Sonnet 5",
        "Claude-Sonnet-5",
        "Anthropic: Claude Sonnet 5",
        "openrouter/anthropic/claude-sonnet-5",
      ]),
      currency: 'USD',
      input: 2.0,
      output: 10.0,
      cache: 0.2,
      cacheWrite: 2.5,
    }),
    'claude-opus-5': Object.freeze({
      aliases: Object.freeze([
        "claude-opus-5",
        "anthropic/claude-opus-5",
        "Claude-Opus-5",
        "Anthropic: Claude Opus 5",
        "Claude Opus 5",
        "openrouter/anthropic/claude-opus-5",
      ]),
      currency: 'USD',
      input: 5.0,
      output: 25.0,
      cache: 0.5,
      cacheWrite: 6.25,
    }),
    'claude-haiku-4.5': Object.freeze({
      aliases: Object.freeze([
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "anthropic/claude-haiku-4.5",
        "Claude-Haiku-4.5",
        "Anthropic: Claude Haiku 4.5",
        "Claude Haiku 4.5",
        "openrouter/anthropic/claude-haiku-4.5",
      ]),
      currency: 'USD',
      input: 1.0,
      output: 5.0,
      cache: 0.1,
      cacheWrite: 1.25,
    }),
    'claude-sonnet-4.5': Object.freeze({
      aliases: Object.freeze([
        "claude-sonnet-4-5",
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-sonnet-4.6",
        "claude-sonnet-4.6",
        "claude-sonnet-4-6",
        "claude-sonnet-4.5",
        "Anthropic: Claude Sonnet 4.5",
        "Claude Sonnet 4.5",
        "Claude-Sonnet-4.5",
        "Claude Sonnet 4.6",
        "Claude-Sonnet-4.6",
        "openrouter/anthropic/claude-sonnet-4.5",
        "openrouter/anthropic/claude-sonnet-4.6",
      ]),
      currency: 'USD',
      input: 3.0,
      output: 15.0,
      cache: 0.3,
      cacheWrite: 3.75,
    }),
    'gpt-5': Object.freeze({
      aliases: Object.freeze([
        "GPT-5",
        "gpt-5",
        "OpenAI: GPT-5",
        "openai/gpt-5",
        "openrouter/openai/gpt-5",
      ]),
      currency: 'USD',
      input: 1.25,
      output: 10.0,
      cache: 0.125,
    }),
    'gpt-5-mini': Object.freeze({
      aliases: Object.freeze([
        "GPT-5 Mini",
        "GPT-5-mini",
        "gpt-5-mini",
        "OpenAI: GPT-5 Mini",
        "GPT-5-Mini",
        "openai/gpt-5-mini",
        "openrouter/openai/gpt-5-mini",
      ]),
      currency: 'USD',
      input: 0.25,
      output: 2.0,
      cache: 0.025,
    }),
    'gpt-5-nano': Object.freeze({
      aliases: Object.freeze([
        "GPT-5 Nano",
        "GPT-5-nano",
        "gpt-5-nano",
        "OpenAI: GPT-5 Nano",
        "GPT-5-Nano",
        "openai/gpt-5-nano",
        "openrouter/openai/gpt-5-nano",
      ]),
      currency: 'USD',
      input: 0.05,
      output: 0.4,
      cache: 0.005,
    }),
    'gpt-5.1': Object.freeze({
      aliases: Object.freeze([
        "GPT-5.1",
        "gpt-5.1",
        "OpenAI: GPT-5.1",
        "openai/gpt-5.1",
        "openrouter/openai/gpt-5.1",
      ]),
      currency: 'USD',
      input: 1.25,
      output: 10.0,
      cache: 0.125,
    }),
    'gpt-4.1': Object.freeze({
      aliases: Object.freeze([
        "GPT-4.1",
        "gpt-4.1",
        "OpenAI: GPT-4.1",
        "openai/gpt-4.1",
        "openrouter/openai/gpt-4.1",
      ]),
      currency: 'USD',
      input: 2.0,
      output: 8.0,
      cache: 0.5,
    }),
    'gpt-4.1-mini': Object.freeze({
      aliases: Object.freeze([
        "gpt-4.1-mini",
        "OpenAI: GPT-4.1 Mini",
        "GPT-4.1 Mini",
        "GPT-4.1-Mini",
        "openai/gpt-4.1-mini",
        "openrouter/openai/gpt-4.1-mini",
      ]),
      currency: 'USD',
      input: 0.4,
      output: 1.6,
      cache: 0.1,
    }),
    'gpt-4.1-nano': Object.freeze({
      aliases: Object.freeze([
        "gpt-4.1-nano",
        "OpenAI: GPT-4.1 Nano",
        "GPT-4.1 Nano",
        "GPT-4.1-Nano",
        "openai/gpt-4.1-nano",
        "openrouter/openai/gpt-4.1-nano",
      ]),
      currency: 'USD',
      input: 0.1,
      output: 0.4,
      cache: 0.025,
    }),
    'gpt-4o': Object.freeze({
      aliases: Object.freeze([
        "GPT-4o",
        "gpt-4o",
        "OpenAI: GPT-4o",
        "openai/gpt-4o",
        "openrouter/openai/gpt-4o",
      ]),
      currency: 'USD',
      input: 2.5,
      output: 10.0,
      cache: 1.25,
    }),
    'gpt-4o-mini': Object.freeze({
      aliases: Object.freeze([
        "GPT-4o-mini",
        "GPT-4o mini",
        "gpt-4o-mini",
        "OpenAI: GPT-4o-mini",
        "openai/gpt-4o-mini",
        "openrouter/openai/gpt-4o-mini",
      ]),
      currency: 'USD',
      input: 0.15,
      output: 0.6,
      cache: 0.075,
    }),
    'o3': Object.freeze({
      aliases: Object.freeze([
        "o3",
        "OpenAI: o3",
        "openai/o3",
        "openrouter/openai/o3",
      ]),
      currency: 'USD',
      input: 2.0,
      output: 8.0,
      cache: 0.5,
    }),
    'o4-mini': Object.freeze({
      aliases: Object.freeze([
        "o4-mini",
        "OpenAI: o4 Mini",
        "o4 Mini",
        "o4-Mini",
        "openai/o4-mini",
        "openrouter/openai/o4-mini",
      ]),
      currency: 'USD',
      input: 1.1,
      output: 4.4,
      cache: 0.275,
    }),
    'o3-mini': Object.freeze({
      aliases: Object.freeze([
        "o3-mini",
        "OpenAI: o3 Mini",
        "o3 Mini",
        "o3-Mini",
        "openai/o3-mini",
        "openrouter/openai/o3-mini",
      ]),
      currency: 'USD',
      input: 1.1,
      output: 4.4,
      cache: 0.55,
    }),
    'claude-opus-4.6': Object.freeze({
      aliases: Object.freeze([
        "claude-opus-4.6",
        "Anthropic: Claude Opus 4.6",
        "Claude Opus 4.6",
        "Claude-Opus-4.6",
        "anthropic/claude-opus-4.6",
        "openrouter/anthropic/claude-opus-4.6",
      ]),
      currency: 'USD',
      input: 5.0,
      output: 25.0,
      cache: 0.5,
      cacheWrite: 6.25,
    }),
    'claude-opus-4.5': Object.freeze({
      aliases: Object.freeze([
        "claude-opus-4.5",
        "Anthropic: Claude Opus 4.5",
        "Claude Opus 4.5",
        "Claude-Opus-4.5",
        "anthropic/claude-opus-4.5",
        "openrouter/anthropic/claude-opus-4.5",
      ]),
      currency: 'USD',
      input: 5.0,
      output: 25.0,
      cache: 0.5,
      cacheWrite: 6.25,
    }),
    'claude-sonnet-4': Object.freeze({
      aliases: Object.freeze([
        "claude-sonnet-4",
        "Anthropic: Claude Sonnet 4",
        "Claude Sonnet 4",
        "Claude-Sonnet-4",
        "anthropic/claude-sonnet-4",
        "openrouter/anthropic/claude-sonnet-4",
      ]),
      currency: 'USD',
      input: 3.0,
      output: 15.0,
      cache: 0.3,
      cacheWrite: 3.75,
    }),
    'gemini-2.5-pro': Object.freeze({
      aliases: Object.freeze([
        "Gemini 2.5 Pro",
        "gemini-2.5-pro",
        "Google: Gemini 2.5 Pro",
        "Gemini-2.5-Pro",
        "google/gemini-2.5-pro",
        "openrouter/google/gemini-2.5-pro",
      ]),
      currency: 'USD',
      input: 1.25,
      output: 10.0,
      cache: 0.125,
      cacheWrite: 0.375,
    }),
    'gemini-2.5-flash': Object.freeze({
      aliases: Object.freeze([
        "gemini-2.5-flash",
        "Gemini 2.5 Flash",
        "Google: Gemini 2.5 Flash",
        "Gemini-2.5-Flash",
        "google/gemini-2.5-flash",
        "openrouter/google/gemini-2.5-flash",
      ]),
      currency: 'USD',
      input: 0.3,
      output: 2.5,
      cache: 0.03,
      cacheWrite: 0.083333,
    }),
    'gemini-2.5-flash-lite': Object.freeze({
      aliases: Object.freeze([
        "gemini-2.5-flash-lite",
        "Google: Gemini 2.5 Flash Lite",
        "Gemini 2.5 Flash Lite",
        "Gemini-2.5-Flash-Lite",
        "google/gemini-2.5-flash-lite",
        "openrouter/google/gemini-2.5-flash-lite",
      ]),
      currency: 'USD',
      input: 0.1,
      output: 0.4,
      cache: 0.01,
      cacheWrite: 0.083333,
    }),
    'gemini-3-flash-preview': Object.freeze({
      aliases: Object.freeze([
        "gemini-3-flash-preview",
        "Google: Gemini 3 Flash Preview",
        "Gemini 3 Flash Preview",
        "Gemini-3-Flash-Preview",
        "google/gemini-3-flash-preview",
        "openrouter/google/gemini-3-flash-preview",
      ]),
      currency: 'USD',
      input: 0.5,
      output: 3.0,
      cache: 0.05,
      cacheWrite: 0.083333,
    }),
    'gemini-3.1-flash-lite': Object.freeze({
      aliases: Object.freeze([
        "gemini-3.1-flash-lite",
        "Google: Gemini 3.1 Flash Lite",
        "Gemini 3.1 Flash Lite",
        "Gemini-3.1-Flash-Lite",
        "google/gemini-3.1-flash-lite",
        "openrouter/google/gemini-3.1-flash-lite",
      ]),
      currency: 'USD',
      input: 0.25,
      output: 1.5,
      cache: 0.025,
      cacheWrite: 0.083333,
    }),
    'grok-4.6': Object.freeze({
      aliases: Object.freeze([
        "grok-4.6",
        "Grok 4.6",
        "Grok-4.6",
        "SpaceXAI: Grok 4.6",
        "x-ai/grok-4.6",
        "openrouter/x-ai/grok-4.6",
        "xai/grok-4.6",
      ]),
      currency: 'USD',
      input: 2.0,
      output: 6.0,
      cache: 0.5,
    }),
    'grok-4.5': Object.freeze({
      aliases: Object.freeze([
        "grok-4.5",
        "SpaceXAI: Grok 4.5",
        "Grok 4.5",
        "Grok-4.5",
        "x-ai/grok-4.5",
        "openrouter/x-ai/grok-4.5",
        "xai/grok-4.5",
      ]),
      currency: 'USD',
      input: 2.0,
      output: 6.0,
      cache: 0.3,
    }),
    'grok-4.3': Object.freeze({
      aliases: Object.freeze([
        "grok-4.3",
        "SpaceXAI: Grok 4.3",
        "Grok 4.3",
        "Grok-4.3",
        "x-ai/grok-4.3",
        "openrouter/x-ai/grok-4.3",
        "xai/grok-4.3",
      ]),
      currency: 'USD',
      input: 1.25,
      output: 2.5,
      cache: 0.2,
    }),
    'grok-4.20': Object.freeze({
      aliases: Object.freeze([
        "grok-4.20",
        "SpaceXAI: Grok 4.20",
        "Grok 4.20",
        "Grok-4.20",
        "x-ai/grok-4.20",
        "openrouter/x-ai/grok-4.20",
        "xai/grok-4.20",
      ]),
      currency: 'USD',
      input: 1.25,
      output: 2.5,
      cache: 0.2,
    }),
    'deepseek-r1': Object.freeze({
      aliases: Object.freeze([
        "deepseek-r1",
        "DeepSeek: R1",
        "R1",
        "deepseek/deepseek-r1",
        "openrouter/deepseek/deepseek-r1",
      ]),
      currency: 'USD',
      input: 0.7,
      output: 2.5,
    }),
    'minimax-m3': Object.freeze({
      aliases: Object.freeze([
        "minimax-m3",
        "MiniMax: MiniMax M3",
        "MiniMax M3",
        "MiniMax-M3",
        "minimax/minimax-m3",
        "openrouter/minimax/minimax-m3",
      ]),
      currency: 'USD',
      input: 0.3,
      output: 1.2,
      cache: 0.06,
    }),
    'minimax-m2.5': Object.freeze({
      aliases: Object.freeze([
        "minimax-m2.5",
        "MiniMax: MiniMax M2.5",
        "MiniMax M2.5",
        "MiniMax-M2.5",
        "minimax/minimax-m2.5",
        "openrouter/minimax/minimax-m2.5",
      ]),
      currency: 'USD',
      input: 0.27,
      output: 1.08,
      cache: 0.027,
    }),
    'minimax-m2.1': Object.freeze({
      aliases: Object.freeze([
        "minimax-m2.1",
        "MiniMax: MiniMax M2.1",
        "MiniMax M2.1",
        "MiniMax-M2.1",
        "minimax/minimax-m2.1",
        "openrouter/minimax/minimax-m2.1",
      ]),
      currency: 'USD',
      input: 0.3,
      output: 1.2,
      cache: 0.03,
    }),
    'glm-5': Object.freeze({
      aliases: Object.freeze([
        "glm-5",
        "GLM-5",
        "GLM 5",
        "Z.ai: GLM 5",
        "z-ai/glm-5",
        "openrouter/z-ai/glm-5",
        "zhipu/glm-5",
        "zai/glm-5",
        "glm/glm-5",
      ]),
      currency: 'USD',
      input: 0.6,
      output: 1.92,
      cache: 0.12,
    }),
    'glm-5.3': Object.freeze({
      aliases: Object.freeze([
        "glm-5.3",
        "Z.ai: GLM 5.3",
        "GLM 5.3",
        "GLM-5.3",
        "z-ai/glm-5.3",
        "openrouter/z-ai/glm-5.3",
        "zhipu/glm-5.3",
        "zai/glm-5.3",
        "glm/glm-5.3",
      ]),
      currency: 'USD',
      input: 0.91,
      output: 2.86,
      cache: 0.169,
    }),
    'glm-5.2': Object.freeze({
      aliases: Object.freeze([
        "glm-5.2",
        "Z.ai: GLM 5.2",
        "GLM 5.2",
        "GLM-5.2",
        "z-ai/glm-5.2",
        "openrouter/z-ai/glm-5.2",
        "zhipu/glm-5.2",
        "zai/glm-5.2",
        "glm/glm-5.2",
      ]),
      currency: 'USD',
      input: 0.5544,
      output: 1.7424,
      cache: 0.10296,
    }),
    'glm-4.7': Object.freeze({
      aliases: Object.freeze([
        "glm-4.7",
        "Z.ai: GLM 4.7",
        "GLM 4.7",
        "GLM-4.7",
        "z-ai/glm-4.7",
        "openrouter/z-ai/glm-4.7",
        "zhipu/glm-4.7",
        "zai/glm-4.7",
        "glm/glm-4.7",
      ]),
      currency: 'USD',
      input: 0.4,
      output: 1.75,
      cache: 0.08,
    }),
    'glm-4.6': Object.freeze({
      aliases: Object.freeze([
        "glm-4.6",
        "Z.ai: GLM 4.6",
        "GLM 4.6",
        "GLM-4.6",
        "z-ai/glm-4.6",
        "openrouter/z-ai/glm-4.6",
        "zhipu/glm-4.6",
        "zai/glm-4.6",
        "glm/glm-4.6",
      ]),
      currency: 'USD',
      input: 0.43,
      output: 1.75,
      cache: 0.08,
    }),
    'glm-4.5': Object.freeze({
      aliases: Object.freeze([
        "glm-4.5",
        "Z.ai: GLM 4.5",
        "GLM 4.5",
        "GLM-4.5",
        "z-ai/glm-4.5",
        "openrouter/z-ai/glm-4.5",
        "zhipu/glm-4.5",
        "zai/glm-4.5",
        "glm/glm-4.5",
      ]),
      currency: 'USD',
      input: 0.6,
      output: 2.2,
      cache: 0.11,
    }),
    'glm-4.7-flash': Object.freeze({
      aliases: Object.freeze([
        "glm-4.7-flash",
        "Z.ai: GLM 4.7 Flash",
        "GLM 4.7 Flash",
        "GLM-4.7-Flash",
        "z-ai/glm-4.7-flash",
        "openrouter/z-ai/glm-4.7-flash",
        "zhipu/glm-4.7-flash",
        "zai/glm-4.7-flash",
        "glm/glm-4.7-flash",
      ]),
      currency: 'USD',
      input: 0.0605,
      output: 0.4,
    }),
    'glm-5.3-flash': Object.freeze({
      aliases: Object.freeze([
        "glm-5.3-flash",
        "Z.ai: GLM 5.3 Flash",
        "GLM 5.3 Flash",
        "GLM-5.3-Flash",
        "z-ai/glm-5.3-flash",
        "openrouter/z-ai/glm-5.3-flash",
        "zhipu/glm-5.3-flash",
        "zai/glm-5.3-flash",
        "glm/glm-5.3-flash",
      ]),
      currency: 'USD',
      input: 0.09,
      output: 0.3,
      cache: 0.018,
    }),
    'qwen3.8-flash': Object.freeze({
      aliases: Object.freeze([
        "qwen3.8-flash",
        "Qwen3.8 Flash",
        "Qwen3.8-Flash",
        "Qwen: Qwen3.8 Flash",
        "qwen/qwen3.8-flash",
        "openrouter/qwen/qwen3.8-flash",
      ]),
      currency: 'USD',
      input: 0.15,
      output: 0.47,
      cache: 0.016,
      cacheWrite: 0.2,
    }),
    'qwen3.7-flash': Object.freeze({
      aliases: Object.freeze([
        "qwen3.7-flash",
        "Qwen: Qwen3.7 Flash",
        "Qwen3.7 Flash",
        "Qwen3.7-Flash",
        "qwen/qwen3.7-flash",
        "openrouter/qwen/qwen3.7-flash",
      ]),
      currency: 'USD',
      input: 0.03,
      output: 0.13,
      cache: 0.006,
      cacheWrite: 0.038,
    }),
    'qwen3-coder-flash': Object.freeze({
      aliases: Object.freeze([
        "qwen3-coder-flash",
        "Qwen: Qwen3 Coder Flash",
        "Qwen3 Coder Flash",
        "Qwen3-Coder-Flash",
        "qwen/qwen3-coder-flash",
        "openrouter/qwen/qwen3-coder-flash",
      ]),
      currency: 'USD',
      input: 0.195,
      output: 0.975,
      cache: 0.039,
      cacheWrite: 0.24375,
    }),
    'qwen3-coder-next': Object.freeze({
      aliases: Object.freeze([
        "qwen3-coder-next",
        "Qwen: Qwen3 Coder Next",
        "Qwen3 Coder Next",
        "Qwen3-Coder-Next",
        "qwen/qwen3-coder-next",
        "openrouter/qwen/qwen3-coder-next",
      ]),
      currency: 'USD',
      input: 0.12,
      output: 0.8,
      cache: 0.07,
    }),
    'qwen3-235b-a22b-2507': Object.freeze({
      aliases: Object.freeze([
        "qwen3-235b-a22b-2507",
        "Qwen: Qwen3 235B A22B Instruct 2507",
        "Qwen3 235B A22B Instruct 2507",
        "Qwen3-235B-A22B-Instruct-2507",
        "qwen/qwen3-235b-a22b-2507",
        "openrouter/qwen/qwen3-235b-a22b-2507",
      ]),
      currency: 'USD',
      input: 0.0875,
      output: 0.35,
      cache: 0.0175,
    }),
    'qwen3-next-80b-a3b-instruct': Object.freeze({
      aliases: Object.freeze([
        "qwen3-next-80b-a3b-instruct",
        "Qwen: Qwen3 Next 80B A3B Instruct",
        "Qwen3 Next 80B A3B Instruct",
        "Qwen3-Next-80B-A3B-Instruct",
        "qwen/qwen3-next-80b-a3b-instruct",
        "openrouter/qwen/qwen3-next-80b-a3b-instruct",
      ]),
      currency: 'USD',
      input: 0.09,
      output: 1.1,
    }),
  }),
});

export function defaultPricing() {
  return cloneTable(DEFAULT_PRICING_TABLE);
}

function cloneTable(table) {
  const models = {};
  for (const [id, row] of Object.entries(table?.models ?? {})) {
    models[id] = {
      aliases: [...(row.aliases ?? [])],
      currency: row.currency ?? table.currency ?? 'USD',
      input: row.input,
      output: row.output,
      cache: row.cache,
      cacheWrite: row.cacheWrite,
    };
  }
  return { currency: table?.currency ?? 'USD', unit: table?.unit ?? PRICING_UNIT, models };
}

function tokensOf(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Finite rate ≥ 0, including an explicit $0/1M. Missing / NaN / negative → undefined (unknown, not $0). */
export function rateOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function normalizeModelId(id) {
  return String(id ?? '').trim().toLowerCase();
}

export function parseScalar(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * Minimal YAML subset: comments, maps, string/number scalars, and `- item` lists.
 * Enough for `pricing/models.yaml` and simple overlays.
 */
export function parsePricingYaml(text) {
  const lines = String(text ?? '').replace(/\t/g, '  ').split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, parent: null, key: null, value: root }];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const body = raw.slice(indent);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (body.startsWith('- ')) {
      const item = parseScalar(body.slice(2).replace(/\s+#.*$/, '').trim());
      if (frame.parent == null || frame.key == null) continue;
      if (!Array.isArray(frame.parent[frame.key])) {
        frame.parent[frame.key] = [];
        frame.value = frame.parent[frame.key];
      }
      frame.parent[frame.key].push(item);
      continue;
    }

    const colon = body.indexOf(':');
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).replace(/\s+#.*$/, '').trim();
    const parent = frame.value && typeof frame.value === 'object' && !Array.isArray(frame.value) ? frame.value : root;
    if (rest === '') {
      const next = {};
      parent[key] = next;
      stack.push({ indent, parent, key, value: next });
      continue;
    }
    parent[key] = parseScalar(rest);
  }
  return root;
}

export function buildRateIndex(table) {
  const map = new Map();
  for (const [id, row] of Object.entries(table?.models ?? {})) {
    const rates = {
      id,
      currency: row.currency ?? table.currency ?? 'USD',
      input: rateOf(row.input),
      output: rateOf(row.output),
      cache: rateOf(row.cache),
      cacheWrite: rateOf(row.cacheWrite),
    };
    for (const key of [id, ...(row.aliases ?? [])]) {
      const normalized = normalizeModelId(key);
      if (normalized && !UNLABELED.has(normalized)) map.set(normalized, rates);
    }
  }
  return map;
}

export function lookupRates(model, table) {
  const index = table?._index instanceof Map ? table._index : buildRateIndex(table);
  const raw = normalizeModelId(model);
  if (!raw || UNLABELED.has(raw)) return null;
  if (index.has(raw)) return index.get(raw);
  const slash = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : '';
  if (slash && !UNLABELED.has(slash) && index.has(slash)) return index.get(slash);
  return null;
}

export function mergePricing(base, overlay) {
  const next = cloneTable(base ?? defaultPricing());
  if (overlay == null) return indexTable(next);
  if (typeof overlay !== 'object' || Array.isArray(overlay)) return indexTable(next);
  const incoming = overlay.models && typeof overlay.models === 'object' && !Array.isArray(overlay.models)
    ? overlay.models
    : overlay;
  if (typeof overlay.currency === 'string' && overlay.currency.trim()) next.currency = overlay.currency.trim();
  if (typeof overlay.unit === 'string' && overlay.unit.trim()) next.unit = overlay.unit.trim();
  for (const [id, row] of Object.entries(incoming ?? {})) {
    if (!id || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    const prev = next.models[id] ?? { aliases: [], currency: next.currency };
    const aliases = [...new Set([...(prev.aliases ?? []), ...((row.aliases ?? []).filter(a => typeof a === 'string'))])];
    next.models[id] = {
      aliases,
      currency: typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim() : prev.currency,
      input: row.input !== undefined ? rateOf(row.input) : prev.input,
      output: row.output !== undefined ? rateOf(row.output) : prev.output,
      cache: row.cache !== undefined ? rateOf(row.cache) : prev.cache,
      cacheWrite: row.cacheWrite !== undefined ? rateOf(row.cacheWrite) : prev.cacheWrite,
    };
  }
  return indexTable(next);
}

function indexTable(table) {
  table._index = buildRateIndex(table);
  return table;
}

function bucketCost(tokens, rate) {
  if (tokens <= 0) return { tokens: 0, usd: 0, unknown: false };
  if (rate === undefined) return { tokens, usd: null, unknown: true };
  return { tokens, usd: (tokens / PER_MILLION) * rate, unknown: false };
}

/**
 * Price one model usage row.
 * $0 only when every token count is actually 0. Missing model or missing
 * bucket rate is Unknown — never coerced to $0.
 */
export function estimateModelUsage(usage, table) {
  const input = tokensOf(usage?.input);
  const output = tokensOf(usage?.output);
  const cacheRead = tokensOf(usage?.cacheRead ?? usage?.cache);
  const cacheWrite = tokensOf(usage?.cacheWrite);
  const reported = tokensOf(usage?.tokens);
  const bucketSum = input + output + cacheRead + cacheWrite;
  const totalTokens = Math.max(reported, bucketSum);

  if (totalTokens === 0) {
    return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, parts: [] };
  }

  const rates = lookupRates(usage?.model ?? usage?.modelId, table);
  if (!rates) {
    return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'missing-model', parts: [] };
  }

  if (bucketSum === 0 && reported > 0) {
    return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'unsplit-tokens', parts: [] };
  }

  const parts = {
    input: bucketCost(input, rates.input),
    output: bucketCost(output, rates.output),
    cache: bucketCost(cacheRead, rates.cache),
    cacheWrite: bucketCost(cacheWrite, rates.cacheWrite),
  };
  let usd = 0;
  let unknown = false;
  for (const part of Object.values(parts)) {
    if (part.tokens <= 0) continue;
    if (part.unknown) unknown = true;
    else usd += part.usd;
  }
  if (reported > bucketSum) {
    unknown = true;
    parts.unallocated = { tokens: reported - bucketSum, usd: null, unknown: true };
  }
  if (unknown && usd === 0) return { status: 'unknown', usd: null, unknown: true, totalTokens, reason: 'missing-rate', parts };
  if (unknown) return { status: 'partial', usd, unknown: true, totalTokens, parts };
  return { status: 'priced', usd, unknown: false, totalTokens, parts };
}

export function estimateUsageRows(rows, table) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, rows: [] };
  let usd = 0;
  let unknown = false;
  let totalTokens = 0;
  let anyPositive = false;
  const estimated = list.map(row => {
    const result = estimateModelUsage(row, table);
    totalTokens += result.totalTokens ?? 0;
    if (result.status !== 'zero') anyPositive = true;
    if (result.unknown) unknown = true;
    if (result.usd != null) usd += result.usd;
    return result;
  });
  if (!anyPositive) return { status: 'zero', usd: 0, unknown: false, totalTokens: 0, rows: estimated };
  if (unknown && usd === 0) return { status: 'unknown', usd: null, unknown: true, totalTokens, rows: estimated };
  if (unknown) return { status: 'partial', usd, unknown: true, totalTokens, rows: estimated };
  return { status: 'priced', usd, unknown: false, totalTokens, rows: estimated };
}

export function estimateFromInsights(view, stats, scope, selectedModel, currentRoute, table) {
  if (selectedModel) return estimateModelUsage(selectedModel, table);
  if (scope === 'turn') {
    return estimateModelUsage({ ...stats, model: view?.turn?.route?.model ?? currentRoute?.model }, table);
  }
  if (Array.isArray(view?.models) && view.models.length > 0) return estimateUsageRows(view.models, table);
  return estimateModelUsage({ ...stats, model: currentRoute?.model }, table);
}

export function formatUsd(amount) {
  if (!Number.isFinite(amount)) return null;
  if (amount === 0) return '$0.00';
  const abs = Math.abs(amount);
  if (abs < 0.0001) return `$${amount.toFixed(6)}`.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (abs < 0.01) return `$${amount.toFixed(4)}`;
  if (abs < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatEstimate(result, locale = 'zh') {
  const copy = costCopy(locale);
  if (!result || result.status === 'unknown') return copy.unknown;
  if (result.status === 'zero') return formatUsd(0);
  const money = formatUsd(result.usd);
  if (money == null) return copy.unknown;
  return money;
}

/** Quiet footnote for partial rows. Never embed this in the bold main number. */
export function formatEstimateNote(result, locale = 'zh') {
  const copy = costCopy(locale);
  return result?.status === 'partial' ? copy.someUnpriced : '';
}

export function estimateDisclaimer(locale = 'zh') {
  const copy = costCopy(locale);
  return locale === 'en'
    ? `${copy.estimateNotBill} / 估算，非账单`
    : `${copy.estimateNotBill} / Estimate, not a bill`;
}

export function parseOverride(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('override must be a JSON object');
    }
    return parsed;
  }
  return parsePricingYaml(text);
}

export function readStoredOverride(storage) {
  try {
    const raw = storage?.getItem?.(PRICING_STORAGE_KEY);
    return raw ? parseOverride(raw) : null;
  } catch {
    return null;
  }
}

export function pricingTableFrom(override) {
  return mergePricing(defaultPricing(), override);
}

function sameAliasSet(a, b) {
  const left = [...new Set((a ?? []).map(x => String(x)))].sort();
  const right = [...new Set((b ?? []).map(x => String(x)))].sort();
  if (left.length !== right.length) return false;
  return left.every((value, i) => value === right[i]);
}

function serializeModelRow(row) {
  const out = {};
  if (Array.isArray(row?.aliases) && row.aliases.length) out.aliases = [...row.aliases];
  if (typeof row?.currency === 'string' && row.currency.trim()) out.currency = row.currency.trim();
  if (row?.input !== undefined) out.input = row.input;
  if (row?.output !== undefined) out.output = row.output;
  if (row?.cache !== undefined) out.cache = row.cache;
  if (row?.cacheWrite !== undefined) out.cacheWrite = row.cacheWrite;
  return out;
}

/** Stable pretty JSON of the effective table (no `_index`). Model keys sorted. */
export function serializeEffectivePricing(table) {
  const models = {};
  for (const id of Object.keys(table?.models ?? {}).sort()) {
    models[id] = serializeModelRow(table.models[id]);
  }
  return JSON.stringify({
    currency: table?.currency ?? 'USD',
    unit: table?.unit ?? PRICING_UNIT,
    models,
  }, null, 2);
}

export function effectivePricingText(storage) {
  return serializeEffectivePricing(mergePricing(defaultPricing(), readStoredOverride(storage)));
}

/**
 * Overlay of only models/fields that differ from `base`.
 * Missing edited models are ignored (defaults stay). Empty → null.
 */
export function diffPricing(base, edited) {
  if (edited == null || typeof edited !== 'object' || Array.isArray(edited)) return null;
  const baseTable = base?.models && typeof base.models === 'object' ? base : { models: {}, currency: 'USD', unit: PRICING_UNIT };
  const incoming = edited.models && typeof edited.models === 'object' && !Array.isArray(edited.models)
    ? edited.models
    : edited;
  const overlay = {};
  if (typeof edited.currency === 'string' && edited.currency.trim() && edited.currency.trim() !== (baseTable.currency ?? 'USD')) {
    overlay.currency = edited.currency.trim();
  }
  if (typeof edited.unit === 'string' && edited.unit.trim() && edited.unit.trim() !== (baseTable.unit ?? PRICING_UNIT)) {
    overlay.unit = edited.unit.trim();
  }
  const models = {};
  for (const [id, row] of Object.entries(incoming ?? {})) {
    if (!id || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    const prev = baseTable.models?.[id];
    const next = {};
    if (Array.isArray(row.aliases) && !sameAliasSet(row.aliases, prev?.aliases)) next.aliases = [...row.aliases];
    if (typeof row.currency === 'string' && row.currency.trim() && row.currency.trim() !== (prev?.currency ?? baseTable.currency ?? 'USD')) {
      next.currency = row.currency.trim();
    }
    for (const field of ['input', 'output', 'cache', 'cacheWrite']) {
      if (row[field] === undefined) continue;
      const value = rateOf(row[field]);
      if (value !== rateOf(prev?.[field])) next[field] = value;
    }
    if (Object.keys(next).length) models[id] = next;
  }
  if (Object.keys(models).length) overlay.models = models;
  return Object.keys(overlay).length ? overlay : null;
}

export function persistPricingEditor(raw, storage) {
  const parsed = raw == null || String(raw).trim() === '' ? null : parseOverride(raw);
  if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new TypeError('override must be a JSON object');
  }
  const overlay = parsed == null ? null : diffPricing(defaultPricing(), parsed);
  if (!overlay) storage?.removeItem?.(PRICING_STORAGE_KEY);
  else storage?.setItem?.(PRICING_STORAGE_KEY, JSON.stringify(overlay));
  return serializeEffectivePricing(mergePricing(defaultPricing(), overlay));
}

export function clearPricingEditor(storage) {
  storage?.removeItem?.(PRICING_STORAGE_KEY);
  return serializeEffectivePricing(defaultPricing());
}
