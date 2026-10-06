import { getUserSetting } from "../settings/user-settings.js";
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
} from "./shared.js";

export const AUTOMATION_OUTCOME_MESSAGES: Record<
  BuiltinLocaleCode,
  { noWork: string; emptyDelivery: string; emailNotSent: string }
> = {
  "en-US": {
    emailNotSent: "The email was not sent by a delivery provider.",
    noWork:
      "The automation ended without a confirmed action. Configure a delivery destination for read-only reports.",
    emptyDelivery:
      "The automation produced no message for its configured delivery destination.",
  },
  "es-ES": {
    emailNotSent: "El correo no fue enviado por un proveedor de entrega.",
    noWork:
      "La automatización terminó sin una acción confirmada. Configura un destino de entrega para los informes de solo lectura.",
    emptyDelivery:
      "La automatización no produjo ningún mensaje para su destino de entrega configurado.",
  },
  "fr-FR": {
    emailNotSent:
      "L’e-mail n’a pas été envoyé par un fournisseur de messagerie.",
    noWork:
      "L’automatisation s’est terminée sans action confirmée. Configurez une destination de livraison pour les rapports en lecture seule.",
    emptyDelivery:
      "L’automatisation n’a produit aucun message pour sa destination de livraison configurée.",
  },
  "de-DE": {
    emailNotSent: "Die E-Mail wurde von keinem Zustellanbieter versendet.",
    noWork:
      "Die Automatisierung endete ohne bestätigte Aktion. Konfigurieren Sie ein Zustellungsziel für schreibgeschützte Berichte.",
    emptyDelivery:
      "Die Automatisierung hat keine Nachricht für ihr konfiguriertes Zustellungsziel erzeugt.",
  },
  "pt-BR": {
    emailNotSent: "O e-mail não foi enviado por um provedor de entrega.",
    noWork:
      "A automação terminou sem uma ação confirmada. Configure um destino de entrega para relatórios somente de leitura.",
    emptyDelivery:
      "A automação não produziu nenhuma mensagem para seu destino de entrega configurado.",
  },
  "zh-CN": {
    emailNotSent: "电子邮件未通过邮件服务提供商发送。",
    noWork: "自动化结束时没有已确认的操作。请为只读报告配置发送目标。",
    emptyDelivery: "自动化未生成要发送到已配置目标的消息。",
  },
  "zh-TW": {
    emailNotSent: "電子郵件未透過郵件服務供應商傳送。",
    noWork: "自動化結束時沒有已確認的操作。請為唯讀報告設定傳送目標。",
    emptyDelivery: "自動化未產生要傳送到已設定目標的訊息。",
  },
  "ja-JP": {
    emailNotSent: "メールは配信プロバイダーから送信されませんでした。",
    noWork:
      "自動化は操作が確認されないまま終了しました。読み取り専用のレポートには配信先を設定してください。",
    emptyDelivery:
      "自動化は設定された配信先へのメッセージを生成しませんでした。",
  },
  "ko-KR": {
    emailNotSent: "이메일이 전송 제공업체를 통해 전송되지 않았습니다.",
    noWork:
      "확인된 작업 없이 자동화가 종료되었습니다. 읽기 전용 보고서에는 전송 대상을 설정하세요.",
    emptyDelivery:
      "자동화가 설정된 전송 대상에 보낼 메시지를 생성하지 않았습니다.",
  },
  "hi-IN": {
    emailNotSent: "ईमेल किसी डिलीवरी प्रदाता द्वारा नहीं भेजा गया।",
    noWork:
      "ऑटोमेशन किसी पुष्ट कार्रवाई के बिना समाप्त हो गया। केवल पढ़ने वाली रिपोर्ट के लिए डिलीवरी गंतव्य कॉन्फ़िगर करें।",
    emptyDelivery:
      "ऑटोमेशन ने अपने कॉन्फ़िगर किए गए डिलीवरी गंतव्य के लिए कोई संदेश नहीं बनाया।",
  },
  "ar-SA": {
    emailNotSent: "لم تُرسل رسالة البريد الإلكتروني عبر مزوّد تسليم.",
    noWork:
      "انتهت الأتمتة دون إجراء مؤكد. اضبط وجهة تسليم للتقارير المخصصة للقراءة فقط.",
    emptyDelivery: "لم تنتج الأتمتة أي رسالة لوجهة التسليم المحددة.",
  },
};

export function automationOutcomeMessagesForLocale(locale: string) {
  return AUTOMATION_OUTCOME_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}

export async function automationOutcomeMessagesForUser(
  userEmail: string | null | undefined,
) {
  const preference = normalizeLocalizationPreference(
    userEmail
      ? await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY)
      : undefined,
  );
  return automationOutcomeMessagesForLocale(preference.locale);
}
