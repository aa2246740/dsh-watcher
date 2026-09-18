import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PRICING_TABLE, defaultPricing, parsePricingYaml, mergePricing,
  estimateModelUsage, estimateUsageRows, formatEstimate, formatEstimateNote, formatUsd, lookupRates,
  pricingTableFrom, rateOf,
} from '../src/insights/pricing.mjs';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../pricing/models.yaml');
const MILLION = 1_000_000;
const defaults = () => mergePricing(defaultPricing(), null);

test('pricing/models.yaml parses to the bundled default table', () => {
  const parsed = parsePricingYaml(readFileSync(yamlPath, 'utf8'));
  assert.equal(parsed.currency, DEFAULT_PRICING_TABLE.currency);
  assert.equal(parsed.unit, DEFAULT_PRICING_TABLE.unit);
  assert.deepEqual(parsed.models['deepseek-flash'].aliases, [...DEFAULT_PRICING_TABLE.models['deepseek-flash'].aliases]);
  assert.equal(parsed.models['deepseek-flash'].input, 0.15);
  assert.equal(parsed.models['deepseek-flash'].output, 0.6);
  assert.equal(parsed.models['deepseek-flash'].cache, 0.003);
  assert.equal(parsed.models['deepseek-v4-pro'].input, 0.66);
  assert.equal(parsed.models['deepseek-v4-pro'].output, 1.98);
  assert.equal(parsed.models['deepseek-v4-pro'].cache, 0.022);
  assert.deepEqual(parsed.models['minimax-m2.7'].aliases, [...DEFAULT_PRICING_TABLE.models['minimax-m2.7'].aliases]);
  assert.equal(parsed.models['minimax-m2.7'].input, DEFAULT_PRICING_TABLE.models['minimax-m2.7'].input);
  assert.equal(parsed.models['minimax-m2.7'].output, DEFAULT_PRICING_TABLE.models['minimax-m2.7'].output);
  assert.equal(parsed.models['minimax-m2.7'].cache, DEFAULT_PRICING_TABLE.models['minimax-m2.7'].cache);
  assert.equal(parsed.models['minimax-m2.7'].cacheWrite, DEFAULT_PRICING_TABLE.models['minimax-m2.7'].cacheWrite);
  assert.deepEqual(parsed.models['minimax-m2.7-highspeed'].aliases, [...DEFAULT_PRICING_TABLE.models['minimax-m2.7-highspeed'].aliases]);
  assert.equal(parsed.models['minimax-m2.7-highspeed'].input, DEFAULT_PRICING_TABLE.models['minimax-m2.7-highspeed'].input);
  assert.equal(parsed.models['minimax-m2.7-highspeed'].output, DEFAULT_PRICING_TABLE.models['minimax-m2.7-highspeed'].output);
  assert.equal(parsed.models['minimax-m2.7-highspeed'].cache, 0.06);
  assert.equal(parsed.models['minimax-m2.7-highspeed'].cacheWrite, 0.375);
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
