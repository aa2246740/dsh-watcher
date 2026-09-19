import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PRICING_TABLE, PRICING_STORAGE_KEY, defaultPricing, parsePricingYaml, mergePricing,
  estimateModelUsage, estimateUsageRows, formatEstimate, formatEstimateNote, formatUsd, lookupRates,
  pricingTableFrom, rateOf, serializeEffectivePricing, effectivePricingText, diffPricing,
  persistPricingEditor, clearPricingEditor, readStoredOverride,
} from '../src/insights/pricing.mjs';
import { costCopy } from '../src/insights/i18n.mjs';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../pricing/models.yaml');
const MILLION = 1_000_000;
const defaults = () => mergePricing(defaultPricing(), null);

test('pricing/models.yaml parses to the bundled default table', () => {
  const parsed = parsePricingYaml(readFileSync(yamlPath, 'utf8'));
  assert.equal(parsed.currency, DEFAULT_PRICING_TABLE.currency);
  assert.equal(parsed.unit, DEFAULT_PRICING_TABLE.unit);
  const ids = Object.keys(DEFAULT_PRICING_TABLE.models);
  assert.deepEqual(Object.keys(parsed.models).sort(), [...ids].sort());
  for (const id of ids) {
    const yamlRow = parsed.models[id];
    const bundled = DEFAULT_PRICING_TABLE.models[id];
    assert.deepEqual(yamlRow.aliases, [...bundled.aliases], id);
    assert.equal(yamlRow.input, bundled.input, id);
    assert.equal(yamlRow.output, bundled.output, id);
    assert.equal(yamlRow.cache, bundled.cache, id);
    assert.equal(yamlRow.cacheWrite, bundled.cacheWrite, id);
  }
  assert.equal(parsed.models['deepseek-flash'].input, 0.15);
  assert.equal(parsed.models['deepseek-v4-pro'].input, 0.66);
  assert.equal(parsed.models['minimax-m2.7'].cacheWrite, 0.375);
  assert.equal(parsed.models['minimax-m2.7-highspeed'].input, 0.6);
  assert.ok(ids.length >= 40);
});

test('priced model math uses matching input / output / cache rates per 1M tokens', () => {
  const table = defaults();
  const result = estimateModelUsage({
    model: 'deepseek-flash',
    input: MILLION,
    output: MILLION / 2,
    cacheRead: 2 * MILLION,
    tokens: MILLION + MILLION / 2 + 2 * MILLION,
  }, table);
  assert.equal(result.status, 'priced');
  assert.equal(result.unknown, false);
  assert.equal(result.usd, 0.15 + 0.30 + 0.006);
  assert.equal(result.parts.input.usd, 0.15);
  assert.equal(result.parts.output.usd, 0.30);
  assert.equal(result.parts.cache.usd, 0.006);
});

test('OpenRouter-style aliases resolve to the official DeepSeek row', () => {
  const table = defaults();
  assert.equal(lookupRates('openrouter/deepseek/deepseek-chat', table).id, 'deepseek-flash');
  assert.equal(lookupRates('deepseek-reasoner', table).id, 'deepseek-flash');
  assert.equal(lookupRates('deepseek-v4-pro', table).id, 'deepseek-v4-pro');
});

test('unknown model is Unknown and never $0 when tokens exist', () => {
  const table = defaults();
  const result = estimateModelUsage({
    model: 'some-local-gguf',
    input: 100,
    output: 20,
    cacheRead: 0,
    tokens: 120,
  }, table);
  assert.equal(result.status, 'unknown');
  assert.equal(result.usd, null);
  assert.equal(result.unknown, true);
  assert.notEqual(result.usd, 0);
  assert.equal(formatEstimate(result, 'zh'), '未知');
  assert.equal(formatEstimate(result, 'en'), 'Unknown');
});

test('unlabeled or missing model id is Unknown, not a default row', () => {
  const table = defaults();
  assert.equal(lookupRates('unknown', table), null);
  assert.equal(lookupRates('未标注', table), null);
  assert.equal(estimateModelUsage({ model: 'unknown', tokens: 10, input: 10, output: 0 }, table).status, 'unknown');
});

test('override beats default for the same model id', () => {
  const table = mergePricing(defaultPricing(), {
    models: { 'deepseek-flash': { input: 9.99, output: 1.2, cache: 0.5 } },
  });
  const result = estimateModelUsage({
    model: 'deepseek-chat',
    input: MILLION,
    output: MILLION,
    cacheRead: MILLION,
    tokens: 3 * MILLION,
  }, table);
  assert.equal(result.status, 'priced');
  assert.equal(result.usd, 9.99 + 1.2 + 0.5);
  const stock = estimateModelUsage({
    model: 'deepseek-flash',
    input: MILLION,
    output: MILLION,
    cacheRead: MILLION,
    tokens: 3 * MILLION,
  }, defaults());
  assert.equal(stock.usd, 0.15 + 0.6 + 0.003);
  assert.notEqual(result.usd, stock.usd);
});

test('zero-token is $0 only when tokens are actually 0', () => {
  const table = defaults();
  const zero = estimateModelUsage({
    model: 'deepseek-flash', tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  }, table);
  assert.equal(zero.status, 'zero');
  assert.equal(zero.usd, 0);
  assert.equal(formatEstimate(zero, 'en'), '$0.00');

  const unknownZero = estimateModelUsage({
    model: 'mystery-model', tokens: 0, input: 0, output: 0, cacheRead: 0,
  }, table);
  assert.equal(unknownZero.status, 'zero');
  assert.equal(unknownZero.usd, 0);

  const claimedZeroButBuckets = estimateModelUsage({
    model: 'deepseek-flash', tokens: 0, input: 1000, output: 0, cacheRead: 0,
  }, table);
  assert.equal(claimedZeroButBuckets.status, 'priced');
  assert.ok(claimedZeroButBuckets.usd > 0);
  assert.notEqual(formatEstimate(claimedZeroButBuckets, 'zh'), '$0.00');

  const unknownWithTokens = estimateModelUsage({
    model: 'mystery-model', tokens: 0, input: 1000, output: 0, cacheRead: 0,
  }, table);
  assert.equal(unknownWithTokens.status, 'unknown');
  assert.equal(unknownWithTokens.usd, null);
});

test('unsplit token total cannot be priced and is Unknown', () => {
  const result = estimateModelUsage({ model: 'deepseek-flash', tokens: 9000 }, defaults());
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unsplit-tokens');
  assert.equal(result.usd, null);
});

test('missing cache rate with cache tokens is Unknown for that portion, not $0', () => {
  const table = mergePricing(defaultPricing(), {
    models: { 'only-io': { input: 1, output: 2 } },
  });
  const result = estimateModelUsage({
    model: 'only-io', input: MILLION, output: MILLION, cacheRead: MILLION, tokens: 3 * MILLION,
  }, table);
  assert.equal(result.status, 'partial');
  assert.equal(result.usd, 3);
  assert.equal(result.unknown, true);
  assert.equal(formatEstimate(result, 'zh'), '$3.00');
  assert.equal(formatEstimateNote(result, 'zh'), '含未标价模型');
  assert.ok(!formatEstimate(result, 'zh').includes('未知'));
  assert.ok(!formatEstimate(result, 'zh').includes('+'));
});

test('explicit $0/1M rate is a real price; omitted rate is not', () => {
  assert.equal(rateOf(0), 0);
  assert.equal(rateOf(undefined), undefined);
  const table = pricingTableFrom({ models: { free: { input: 0, output: 0, cache: 0 } } });
  const result = estimateModelUsage({
    model: 'free', input: MILLION, output: 10, cacheRead: 10, tokens: MILLION + 20,
  }, table);
  assert.equal(result.status, 'priced');
  assert.equal(result.usd, 0);
});

test('mixed rows keep priced spend and mark Unknown models', () => {
  const result = estimateUsageRows([
    { model: 'deepseek-flash', input: MILLION, output: 0, cacheRead: 0, tokens: MILLION },
    { model: 'mystery-model', input: MILLION, output: 0, cacheRead: 0, tokens: MILLION },
  ], defaults());
  assert.equal(result.status, 'partial');
  assert.equal(result.usd, 0.15);
  assert.equal(formatEstimate(result, 'en'), '$0.150');
  assert.equal(formatEstimateNote(result, 'en'), 'Some models unpriced');
  assert.ok(!formatEstimate(result, 'en').includes('Unknown'));
  assert.ok(!formatEstimate(result, 'en').includes('+'));
});

test('MiniMax-M2.7 Host names are priced from official pay-as-you-go rates', () => {
  const table = defaults();
  assert.equal(lookupRates('MiniMax-M2.7', table).id, 'minimax-m2.7');
  assert.equal(lookupRates('minimax-m2.7', table).id, 'minimax-m2.7');
  assert.equal(lookupRates('minimax/minimax-m2.7', table).id, 'minimax-m2.7');
  assert.equal(lookupRates('openrouter/minimax/minimax-m2.7', table).id, 'minimax-m2.7');
  assert.equal(lookupRates('MiniMax-M2.7-highspeed', table).id, 'minimax-m2.7-highspeed');
  const result = estimateModelUsage({
    model: 'MiniMax-M2.7',
    input: MILLION,
    output: MILLION,
    cacheRead: MILLION,
    cacheWrite: MILLION,
    tokens: 4 * MILLION,
  }, table);
  assert.equal(result.status, 'priced');
  assert.equal(result.unknown, false);
  assert.equal(result.usd, 0.3 + 1.2 + 0.06 + 0.375);
  assert.equal(formatEstimate(result, 'zh'), formatUsd(result.usd));
  assert.equal(formatEstimateNote(result, 'zh'), '');
});

test('DeepSeek-V4-Flash plus MiniMax-M2.7 with split buckets is a single dollar amount', () => {
  const result = estimateUsageRows([
    { model: 'DeepSeek-V4-Flash', input: MILLION, output: 0, cacheRead: 0, tokens: MILLION },
    { model: 'MiniMax-M2.7', input: MILLION, output: 0, cacheRead: 0, tokens: MILLION },
  ], defaults());
  assert.equal(result.status, 'priced');
  assert.equal(result.unknown, false);
  assert.equal(result.usd, 0.15 + 0.3);
  const text = formatEstimate(result, 'zh');
  assert.equal(text, formatUsd(0.15 + 0.3));
  assert.ok(!text.includes('+'));
  assert.ok(!text.includes('未知'));
  assert.equal(formatEstimateNote(result, 'zh'), '');
});

test('official preferred DeepSeek and MiniMax rates win over OpenRouter list prices', () => {
  const table = defaults();
  assert.equal(lookupRates('deepseek-chat', table).id, 'deepseek-flash');
  assert.equal(lookupRates('deepseek-chat', table).input, 0.15);
  assert.equal(lookupRates('deepseek/deepseek-v4-pro', table).input, 0.66);
  assert.equal(lookupRates('MiniMax-M2.7', table).cacheWrite, 0.375);
  assert.equal(lookupRates('anthropic/claude-sonnet-5', table).input, 2);
  assert.equal(lookupRates('anthropic/claude-sonnet-5', table).cacheWrite, 2.5);
});

test('mainstream Host names resolve and price split buckets', () => {
  const table = defaults();
  const cases = [
    ['GPT-5', 'gpt-5', 1.25],
    ['openai/gpt-5', 'gpt-5', 1.25],
    ['claude-sonnet-5', 'claude-sonnet-5', 2],
    ['Claude Sonnet 5', 'claude-sonnet-5', 2],
    ['gemini-2.5-flash', 'gemini-2.5-flash', 0.3],
    ['google/gemini-2.5-flash', 'gemini-2.5-flash', 0.3],
    ['grok-4.6', 'grok-4.6', 2],
    ['x-ai/grok-4.6', 'grok-4.6', 2],
    ['glm-5', 'glm-5', 0.6],
    ['z-ai/glm-5', 'glm-5', 0.6],
    ['qwen3.8-flash', 'qwen3.8-flash', 0.15],
    ['qwen/qwen3.8-flash', 'qwen3.8-flash', 0.15],
  ];
  for (const [name, id, inputRate] of cases) {
    const rates = lookupRates(name, table);
    assert.equal(rates?.id, id, name);
    const result = estimateModelUsage({
      model: name, input: MILLION, output: 0, cacheRead: 0, tokens: MILLION,
    }, table);
    assert.equal(result.status, 'priced', name);
    assert.ok(result.usd > 0, name);
    assert.equal(result.usd, inputRate, name);
  }
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test('priced and partial never put + 未知 in the main number', () => {
  const priced = estimateModelUsage({
    model: 'deepseek-flash', input: MILLION, output: 0, cacheRead: 0, tokens: MILLION,
  }, defaults());
  assert.equal(formatEstimate(priced, 'zh'), formatUsd(0.15));
  assert.equal(formatEstimateNote(priced, 'zh'), '');

  const unknown = estimateModelUsage({
    model: 'mystery-model', input: 100, output: 20, tokens: 120,
  }, defaults());
  assert.equal(formatEstimate(unknown, 'zh'), '未知');
  assert.equal(formatEstimate(unknown, 'en'), 'Unknown');
  assert.equal(formatEstimateNote(unknown, 'zh'), '');
});

test('price editor copy describes the effective table, not a blank overlay paste', () => {
  const zh = costCopy('zh');
  const en = costCopy('en');
  assert.match(zh.priceOverrideTitle, /估算费用价格表/);
  assert.match(zh.priceOverrideTitle, /本地、不联网/);
  assert.match(zh.priceOverrideHelp, /当前生效/);
  assert.match(zh.priceOverrideHelp, /未知/);
  assert.equal(zh.priceOverrideSave, '保存');
  assert.equal(zh.priceOverrideReset, '恢复默认');
  assert.match(en.priceOverrideTitle, /Estimated-cost price table/);
  assert.match(en.priceOverrideTitle, /local, no network/);
  assert.match(en.priceOverrideHelp, /Currently effective/);
  assert.equal(en.priceOverrideSave, 'Save');
  assert.equal(en.priceOverrideReset, 'Reset to defaults');
});

test('editor with no overlay shows pretty-printed defaults, never empty', () => {
  const storage = memoryStorage();
  const text = effectivePricingText(storage);
  assert.ok(text.trim().length > 0);
  assert.ok(text.includes('\n'));
  const parsed = JSON.parse(text);
  assert.equal(parsed.currency, 'USD');
  assert.equal(parsed.unit, 'per_1m_tokens');
  const ids = Object.keys(parsed.models);
  assert.ok(ids.length >= 40);
  assert.ok(ids.includes('gpt-5'));
  assert.ok(ids.includes('deepseek-flash'));
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(text, serializeEffectivePricing(defaultPricing()));
  assert.equal(storage.getItem(PRICING_STORAGE_KEY), null);
  assert.equal(diffPricing(defaultPricing(), parsed), null);
});

test('saving an unchanged default table does not store a duplicate overlay', () => {
  const storage = memoryStorage();
  const next = persistPricingEditor(effectivePricingText(storage), storage);
  assert.equal(storage.getItem(PRICING_STORAGE_KEY), null);
  assert.equal(next, serializeEffectivePricing(defaultPricing()));
});

test('editing one model rate stores only that model overlay', () => {
  const storage = memoryStorage();
  const edited = JSON.parse(effectivePricingText(storage));
  edited.models['gpt-5'].input = 9;
  const next = persistPricingEditor(JSON.stringify(edited, null, 2), storage);
  const stored = JSON.parse(storage.getItem(PRICING_STORAGE_KEY));
  assert.deepEqual(Object.keys(stored), ['models']);
  assert.deepEqual(Object.keys(stored.models), ['gpt-5']);
  assert.deepEqual(stored.models['gpt-5'], { input: 9 });
  const shown = JSON.parse(next);
  assert.equal(shown.models['gpt-5'].input, 9);
  assert.equal(shown.models['deepseek-flash'].input, 0.15);
  assert.ok(Object.keys(shown.models).length >= 40);
});

test('clear overlay empties storage and refills the editor with defaults', () => {
  const storage = memoryStorage();
  persistPricingEditor(JSON.stringify({ models: { 'gpt-5': { input: 9 } } }), storage);
  assert.ok(storage.getItem(PRICING_STORAGE_KEY));
  const text = clearPricingEditor(storage);
  assert.equal(storage.getItem(PRICING_STORAGE_KEY), null);
  assert.equal(text, serializeEffectivePricing(defaultPricing()));
  assert.equal(JSON.parse(text).models['gpt-5'].input, defaultPricing().models['gpt-5'].input);
});

test('reverting an edit back to defaults removes the storage key', () => {
  const storage = memoryStorage();
  const edited = JSON.parse(effectivePricingText(storage));
  const stockInput = edited.models['gpt-5'].input;
  edited.models['gpt-5'].input = 9;
  persistPricingEditor(JSON.stringify(edited), storage);
  assert.ok(storage.getItem(PRICING_STORAGE_KEY));
  edited.models['gpt-5'].input = stockInput;
  persistPricingEditor(JSON.stringify(edited), storage);
  assert.equal(storage.getItem(PRICING_STORAGE_KEY), null);
});

test('persisted overlay still wins over defaults for estimates', () => {
  const storage = memoryStorage();
  persistPricingEditor(JSON.stringify({
    models: { 'deepseek-flash': { input: 9.99, output: 1.2, cache: 0.5 } },
  }), storage);
  const table = mergePricing(defaultPricing(), readStoredOverride(storage));
  const result = estimateModelUsage({
    model: 'deepseek-chat',
    input: MILLION,
    output: MILLION,
    cacheRead: MILLION,
    tokens: 3 * MILLION,
  }, table);
  assert.equal(result.status, 'priced');
  assert.equal(result.usd, 9.99 + 1.2 + 0.5);
  const stock = estimateModelUsage({
    model: 'deepseek-flash',
    input: MILLION,
    output: MILLION,
    cacheRead: MILLION,
    tokens: 3 * MILLION,
  }, defaults());
  assert.equal(stock.usd, 0.15 + 0.6 + 0.003);
  assert.notEqual(result.usd, stock.usd);
  const shown = JSON.parse(effectivePricingText(storage));
  assert.equal(shown.models['deepseek-flash'].input, 9.99);
});
