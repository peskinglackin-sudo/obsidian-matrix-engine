import { getLanguage } from "obsidian";

import en from "./en.json";
import zhCn from "./zh-CN.json";

export type TranslationKey = keyof typeof en;

export function translate(key: TranslationKey, values: Readonly<Record<string, string>> = {}): string {
  const locale = getLanguage().toLowerCase();
  const resource: Readonly<Record<string, string>> = locale === "zh-cn" || locale.startsWith("zh-hans") ? zhCn : en;
  const template = resource[key] ?? en[key];
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), template);
}
