import type { BuiltinLocaleCode } from "./shared.js";

export const ACTION_ERROR_MESSAGES: Record<
  BuiltinLocaleCode,
  { failed: string; loadFailed: string; retry: string }
> = {
  "en-US": {
    failed: "Something went wrong. Try again.",
    loadFailed: "Couldn't load this content.",
    retry: "Retry",
  },
  "es-ES": {
    failed: "Algo salió mal. Inténtalo de nuevo.",
    loadFailed: "No se pudo cargar este contenido.",
    retry: "Reintentar",
  },
  "fr-FR": {
    failed: "Une erreur s’est produite. Réessayez.",
    loadFailed: "Impossible de charger ce contenu.",
    retry: "Réessayer",
  },
  "de-DE": {
    failed: "Etwas ist schiefgelaufen. Versuche es erneut.",
    loadFailed: "Dieser Inhalt konnte nicht geladen werden.",
    retry: "Erneut versuchen",
  },
  "pt-BR": {
    failed: "Algo deu errado. Tente novamente.",
    loadFailed: "Não foi possível carregar este conteúdo.",
    retry: "Tentar novamente",
  },
  "zh-CN": {
    failed: "出了点问题。请重试。",
    loadFailed: "无法加载此内容。",
    retry: "重试",
  },
  "zh-TW": {
    failed: "發生問題。請再試一次。",
    loadFailed: "無法載入此內容。",
    retry: "重試",
  },
  "ja-JP": {
    failed: "問題が発生しました。もう一度お試しください。",
    loadFailed: "コンテンツを読み込めませんでした。",
    retry: "再試行",
  },
  "ko-KR": {
    failed: "문제가 발생했습니다. 다시 시도해 주세요.",
    loadFailed: "콘텐츠를 불러올 수 없습니다.",
    retry: "다시 시도",
  },
  "hi-IN": {
    failed: "कुछ गलत हो गया। फिर से कोशिश करें।",
    loadFailed: "यह सामग्री लोड नहीं हो सकी।",
    retry: "फिर से कोशिश करें",
  },
  "ar-SA": {
    failed: "حدث خطأ ما. حاول مرة أخرى.",
    loadFailed: "تعذّر تحميل هذا المحتوى.",
    retry: "إعادة المحاولة",
  },
};
