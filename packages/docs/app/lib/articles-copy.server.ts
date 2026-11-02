import type { DocsLocale } from "../components/docs-locale";
import arSA from "../i18n/ar-SA";
import deDE from "../i18n/de-DE";
import enUS from "../i18n/en-US";
import esES from "../i18n/es-ES";
import frFR from "../i18n/fr-FR";
import hiIN from "../i18n/hi-IN";
import jaJP from "../i18n/ja-JP";
import koKR from "../i18n/ko-KR";
import ptBR from "../i18n/pt-BR";
import zhCN from "../i18n/zh-CN";
import zhTW from "../i18n/zh-TW";

const CATALOGS = {
  "en-US": enUS,
  "ar-SA": arSA,
  "de-DE": deDE,
  "es-ES": esES,
  "fr-FR": frFR,
  "hi-IN": hiIN,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "pt-BR": ptBR,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
} satisfies Record<
  DocsLocale,
  { campaign: { articles: string; articlesIntro: string } }
>;

/** The articles grid's <title> and description in the page's language, read on the server. */
export function articlesListCopy(locale: DocsLocale) {
  const { articles, articlesIntro } = CATALOGS[locale].campaign;
  return { title: articles, description: articlesIntro };
}
