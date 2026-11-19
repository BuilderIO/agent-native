import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface WriteFailureMessages {
  title: string;
  offline: string;
  timeout: string;
  forbidden: string;
}

export const WRITE_FAILURE_MESSAGES: Record<
  BuiltinLocaleCode,
  WriteFailureMessages
> = {
  "en-US": {
    title: "Couldn't save that change.",
    offline: "You appear to be offline. Try again when you're back online.",
    timeout: "That took too long. Try again.",
    forbidden: "You don't have permission to do that.",
  },
  "es-ES": {
    title: "No se pudo guardar este cambio.",
    offline:
      "Parece que estás sin conexión. Inténtalo de nuevo cuando recuperes la conexión.",
    timeout: "Tardó demasiado. Inténtalo de nuevo.",
    forbidden: "No tienes permiso para hacer eso.",
  },
  "fr-FR": {
    title: "Impossible d'enregistrer cette modification.",
    offline:
      "Vous semblez être hors connexion. Réessayez une fois la connexion rétablie.",
    timeout: "Cela a pris trop de temps. Réessayez.",
    forbidden: "Vous n'avez pas l'autorisation d'effectuer cette action.",
  },
  "de-DE": {
    title: "Diese Änderung konnte nicht gespeichert werden.",
    offline:
      "Du scheinst offline zu sein. Versuche es erneut, wenn du wieder online bist.",
    timeout: "Das hat zu lange gedauert. Versuche es erneut.",
    forbidden: "Du hast keine Berechtigung, das zu tun.",
  },
  "pt-BR": {
    title: "Não foi possível salvar essa alteração.",
    offline:
      "Parece que você está offline. Tente novamente quando voltar a ficar online.",
    timeout: "Demorou demais. Tente novamente.",
    forbidden: "Você não tem permissão para fazer isso.",
  },
  "zh-CN": {
    title: "无法保存此更改。",
    offline: "你似乎已离线。请在恢复网络连接后重试。",
    timeout: "耗时过长。请重试。",
    forbidden: "你没有执行该操作的权限。",
  },
  "zh-TW": {
    title: "無法儲存這項變更。",
    offline: "你似乎已離線。請在恢復網路連線後重試。",
    timeout: "耗時過長。請再試一次。",
    forbidden: "你沒有執行此操作的權限。",
  },
  "ja-JP": {
    title: "変更を保存できませんでした。",
    offline: "オフラインのようです。オンラインに戻ってから再度お試しください。",
    timeout: "時間がかかりすぎました。もう一度お試しください。",
    forbidden: "この操作を行う権限がありません。",
  },
  "ko-KR": {
    title: "변경 내용을 저장하지 못했습니다.",
    offline:
      "오프라인 상태인 것 같습니다. 다시 온라인이 되면 다시 시도해 주세요.",
    timeout: "시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.",
    forbidden: "그 작업을 수행할 권한이 없습니다.",
  },
  "hi-IN": {
    title: "वह बदलाव सहेजा नहीं जा सका।",
    offline: "लगता है आप ऑफ़लाइन हैं। दोबारा ऑनलाइन होने पर फिर से कोशिश करें।",
    timeout: "इसमें बहुत समय लग गया। फिर से कोशिश करें।",
    forbidden: "आपको ऐसा करने की अनुमति नहीं है।",
  },
  "ar-SA": {
    title: "تعذّر حفظ هذا التغيير.",
    offline: "يبدو أنك غير متصل بالإنترنت. أعد المحاولة عند عودة الاتصال.",
    timeout: "استغرق ذلك وقتًا طويلًا. حاول مرة أخرى.",
    forbidden: "ليست لديك صلاحية للقيام بذلك.",
  },
};

export function writeFailureMessagesForLocale(
  locale: LocaleCode,
): WriteFailureMessages {
  return WRITE_FAILURE_MESSAGES[isLocaleCode(locale) ? locale : DEFAULT_LOCALE];
}
