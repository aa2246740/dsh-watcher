/** Browser-safe zh + en copy for Watcher cost UI. No network. */

export const messages = Object.freeze({
  zh: Object.freeze({
    estimatedCost: '估算费用',
    estimateNotBill: '估算，非账单',
    unknown: '未知',
    someUnpriced: '含未标价模型',
    priceOverrideTitle: '估算费用价格表（本地、不联网）',
    priceOverrideHelp: '当前生效的价格表。改任意行后保存；只有改动过的行会存本机。缺行显示「未知」，不会当成 $0。',
    priceOverridePlaceholder: '{\n  "currency": "USD",\n  "unit": "per_1m_tokens",\n  "models": {}\n}',
    priceOverrideSave: '保存',
    priceOverrideSaved: '已保存 ✓',
    priceOverrideReset: '恢复默认',
    priceOverrideInvalid: '不是合法 JSON 对象。',
    priceOverridePath: '默认表：仓库 pricing/models.yaml（欢迎 PR）。',
  }),
  en: Object.freeze({
    estimatedCost: 'Estimated cost',
    estimateNotBill: 'Estimate, not a bill',
    unknown: 'Unknown',
    someUnpriced: 'Some models unpriced',
    priceOverrideTitle: 'Estimated-cost price table (local, no network)',
    priceOverrideHelp: 'Currently effective table. Edit any row and save; only changed rows are stored on this Host. Missing rates stay Unknown, never $0.',
    priceOverridePlaceholder: '{\n  "currency": "USD",\n  "unit": "per_1m_tokens",\n  "models": {}\n}',
    priceOverrideSave: 'Save',
    priceOverrideSaved: 'Saved ✓',
    priceOverrideReset: 'Reset to defaults',
    priceOverrideInvalid: 'Must be a JSON object.',
    priceOverridePath: 'Defaults: repo pricing/models.yaml (PRs welcome).',
  }),
});

export function localeOf(lang) {
  const value = String(lang ?? '').trim().toLowerCase();
  return value.startsWith('en') ? 'en' : 'zh';
}

export function detectLocale() {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang || document.documentElement?.getAttribute?.('lang');
    if (lang) return localeOf(lang);
  }
  if (typeof navigator !== 'undefined' && navigator.language) return localeOf(navigator.language);
  return 'zh';
}

export function costCopy(locale) {
  return messages[locale === 'en' ? 'en' : 'zh'];
}
