import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface BillingNoticeMessages {
  builderCreditLimitTitle: string;
  builderCreditLimitEmailBody: string;
  builderCreditUpgrade: string;
}

export const BILLING_NOTICE_MESSAGES: Record<
  BuiltinLocaleCode,
  BillingNoticeMessages
> = {
  "en-US": {
    builderCreditLimitTitle: "Your Builder credits are used up",
    builderCreditLimitEmailBody:
      "An AI request stopped because your connected Builder account has run out of credits. Upgrade your Builder plan to continue.",
    builderCreditUpgrade: "Upgrade plan",
  },
  "zh-CN": {
    builderCreditLimitTitle: "Builder 积分已用完",
    builderCreditLimitEmailBody:
      "由于您连接的 Builder 账户积分已用完，一项 AI 请求已停止。升级 Builder 套餐即可继续使用。",
    builderCreditUpgrade: "升级套餐",
  },
  "zh-TW": {
    builderCreditLimitTitle: "Builder 點數已用完",
    builderCreditLimitEmailBody:
      "由於您連結的 Builder 帳戶點數已用完，一項 AI 請求已停止。升級 Builder 方案即可繼續使用。",
    builderCreditUpgrade: "升級方案",
  },
  "es-ES": {
    builderCreditLimitTitle: "Se agotaron tus créditos de Builder",
    builderCreditLimitEmailBody:
      "Una solicitud de IA se detuvo porque tu cuenta de Builder conectada se quedó sin créditos. Mejora tu plan de Builder para continuar.",
    builderCreditUpgrade: "Mejorar el plan",
  },
  "fr-FR": {
    builderCreditLimitTitle: "Vos crédits Builder sont épuisés",
    builderCreditLimitEmailBody:
      "Une requête d’IA s’est arrêtée, car votre compte Builder connecté n’a plus de crédits. Passez à une offre Builder supérieure pour continuer.",
    builderCreditUpgrade: "Changer d’offre",
  },
  "de-DE": {
    builderCreditLimitTitle: "Deine Builder-Credits sind aufgebraucht",
    builderCreditLimitEmailBody:
      "Eine KI-Anfrage wurde gestoppt, weil dein verbundenes Builder-Konto keine Credits mehr hat. Führe ein Upgrade deines Builder-Tarifs durch, um fortzufahren.",
    builderCreditUpgrade: "Tarif upgraden",
  },
  "ja-JP": {
    builderCreditLimitTitle: "Builder クレジットを使い切りました",
    builderCreditLimitEmailBody:
      "接続中の Builder アカウントのクレジットがなくなったため、AI リクエストが停止しました。Builder プランをアップグレードすると続けて利用できます。",
    builderCreditUpgrade: "プランをアップグレード",
  },
  "ko-KR": {
    builderCreditLimitTitle: "Builder 크레딧을 모두 사용했습니다",
    builderCreditLimitEmailBody:
      "연결된 Builder 계정의 크레딧이 소진되어 AI 요청이 중단되었습니다. Builder 플랜을 업그레이드하면 계속 이용할 수 있습니다.",
    builderCreditUpgrade: "플랜 업그레이드",
  },
  "pt-BR": {
    builderCreditLimitTitle: "Seus créditos do Builder acabaram",
    builderCreditLimitEmailBody:
      "Uma solicitação de IA foi interrompida porque a conta conectada do Builder ficou sem créditos. Faça upgrade do seu plano do Builder para continuar.",
    builderCreditUpgrade: "Fazer upgrade do plano",
  },
  "hi-IN": {
    builderCreditLimitTitle: "आपके Builder क्रेडिट खत्म हो गए हैं",
    builderCreditLimitEmailBody:
      "आपके कनेक्ट किए गए Builder खाते में क्रेडिट खत्म होने के कारण AI अनुरोध रुक गया। जारी रखने के लिए अपना Builder प्लान अपग्रेड करें।",
    builderCreditUpgrade: "प्लान अपग्रेड करें",
  },
  "ar-SA": {
    builderCreditLimitTitle: "نفدت أرصدة Builder لديك",
    builderCreditLimitEmailBody:
      "توقف طلب الذكاء الاصطناعي لأن أرصدة حساب Builder المتصل بك قد نفدت. قم بترقية خطة Builder للمتابعة.",
    builderCreditUpgrade: "ترقية الخطة",
  },
};

export async function loadBillingNoticeMessagesForLocale(
  locale: LocaleCode,
): Promise<BillingNoticeMessages> {
  return BILLING_NOTICE_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
