/** Browser-safe zh + en copy for Watcher cost UI. No network. */

export const messages = Object.freeze({
  zh: Object.freeze({
    estimatedCost: '估算费用',
    estimateNotBill: '估算，非账单',
    unknown: '未知',
    priceOverrideTitle: '估算费用价格表（本地覆盖，不联网）',
    priceOverrideHelp: '覆盖默认表 pricing/models.yaml。JSON 存本机 localStorage（dsh-watcher:pricing-override:v1）。可选备份路径：$DSH_HOME/profiles/web/dsh-watcher-pricing.override.json（需自行粘贴；v1 不读文件、不拉官网价）。缺行显示「未知」，不会当成 $0。',
    priceOverridePlaceholder: '{\n  "models": {\n    "deepseek-flash": { "input": 0.3, "output": 1.2, "cache": 0.006 }\n  }\n}',
    priceOverrideSave: '保存覆盖',
    priceOverrideSaved: '已保存 ✓',
    priceOverrideReset: '清除覆盖',
    priceOverrideInvalid: '覆盖不是合法 JSON 对象。',
    priceOverridePath: '默认表：仓库 pricing/models.yaml（欢迎 PR）。',
  }),
  en: Object.freeze({
    estimatedCost: 'Estimated cost',
    estimateNotBill: 'Estimate, not a bill',
    unknown: 'Unknown',
    priceOverrideTitle: 'Estimated-cost price table (local overlay, no network)',
    priceOverrideHelp: 'Overrides the default table in pricing/models.yaml. JSON is stored in this Host origin as localStorage dsh-watcher:pricing-override:v1. Optional backup path: $DSH_HOME/profiles/web/dsh-watcher-pricing.override.json (paste it here; v1 does not read files or fetch list prices). A missing row shows Unknown and is never treated as $0.',
    priceOverridePlaceholder: '{\n  "models": {\n    "deepseek-flash": { "input": 0.3, "output": 1.2, "cache": 0.006 }\n  }\n}',
    priceOverrideSave: 'Save overlay',
    priceOverrideSaved: 'Saved ✓',
    priceOverrideReset: 'Clear overlay',
    priceOverrideInvalid: 'Overlay must be a JSON object.',
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
