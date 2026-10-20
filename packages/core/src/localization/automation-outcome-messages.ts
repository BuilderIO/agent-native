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
  {
    noWork: string;
    emptyDelivery: string;
    emailNotSent: string;
    noOpInstruction: string;
    noOpReason: string;
  }
> = {
  "en-US": {
    noOpInstruction:
      "If nothing needs doing, call automation-no-op with a short reason. Failed tools, sends, or missing credentials are errors, not no-ops.",
    noOpReason:
      "A short reason why no action or report was needed (1–500 characters).",
    emailNotSent: "The email was not sent by a delivery provider.",
    noWork:
      "The automation ended without a confirmed action. Configure a delivery destination for read-only reports.",
    emptyDelivery:
      "The automation produced no message for its configured delivery destination.",
  },
  "es-ES": {
    noOpInstruction:
      "Si no hay nada que hacer, llama a automation-no-op con un motivo breve. Las herramientas o los envíos fallidos y las credenciales ausentes son errores, no casos sin trabajo.",
    noOpReason:
      "Motivo breve por el que no se necesitaba ninguna acción ni informe (1–500 caracteres).",
    emailNotSent: "El correo no fue enviado por un proveedor de entrega.",
    noWork:
      "La automatización terminó sin una acción confirmada. Configura un destino de entrega para los informes de solo lectura.",
    emptyDelivery:
      "La automatización no produjo ningún mensaje para su destino de entrega configurado.",
  },
  "fr-FR": {
    noOpInstruction:
      "Si rien n’est à faire, appelez automation-no-op avec une courte raison. Les échecs d’outils ou d’envoi et les identifiants manquants sont des erreurs, pas une absence de travail.",
    noOpReason:
      "Courte raison pour laquelle aucune action ni aucun rapport n’était nécessaire (1–500 caractères).",
    emailNotSent:
      "L’e-mail n’a pas été envoyé par un fournisseur de messagerie.",
    noWork:
      "L’automatisation s’est terminée sans action confirmée. Configurez une destination de livraison pour les rapports en lecture seule.",
    emptyDelivery:
      "L’automatisation n’a produit aucun message pour sa destination de livraison configurée.",
  },
  "de-DE": {
    noOpInstruction:
      "Wenn nichts zu tun ist, rufen Sie automation-no-op mit einer kurzen Begründung auf. Fehlgeschlagene Tools oder Zustellungen und fehlende Zugangsdaten sind Fehler, keine Fälle ohne Handlungsbedarf.",
    noOpReason:
      "Kurze Begründung, warum keine Aktion oder kein Bericht nötig war (1–500 Zeichen).",
    emailNotSent: "Die E-Mail wurde von keinem Zustellanbieter versendet.",
    noWork:
      "Die Automatisierung endete ohne bestätigte Aktion. Konfigurieren Sie ein Zustellungsziel für schreibgeschützte Berichte.",
    emptyDelivery:
      "Die Automatisierung hat keine Nachricht für ihr konfiguriertes Zustellungsziel erzeugt.",
  },
  "pt-BR": {
    noOpInstruction:
      "Se não houver nada a fazer, chame automation-no-op com um motivo breve. Falhas de ferramentas ou envios e credenciais ausentes são erros, não ausência de trabalho.",
    noOpReason:
      "Motivo breve pelo qual nenhuma ação ou relatório era necessário (1–500 caracteres).",
    emailNotSent: "O e-mail não foi enviado por um provedor de entrega.",
    noWork:
      "A automação terminou sem uma ação confirmada. Configure um destino de entrega para relatórios somente de leitura.",
    emptyDelivery:
      "A automação não produziu nenhuma mensagem para seu destino de entrega configurado.",
  },
  "zh-CN": {
    noOpInstruction:
      "如果没有需要执行的工作，请调用 automation-no-op 并提供简短原因。工具失败、发送失败或缺少凭据属于错误，不是无需操作。",
    noOpReason: "简要说明为何无需执行操作或发送报告（1–500 个字符）。",
    emailNotSent: "电子邮件未通过邮件服务提供商发送。",
    noWork: "自动化结束时没有已确认的操作。请为只读报告配置发送目标。",
    emptyDelivery: "自动化未生成要发送到已配置目标的消息。",
  },
  "zh-TW": {
    noOpInstruction:
      "如果沒有需要執行的工作，請呼叫 automation-no-op 並提供簡短原因。工具失敗、傳送失敗或缺少憑證屬於錯誤，不是無需操作。",
    noOpReason: "簡要說明為何無需執行操作或傳送報告（1–500 個字元）。",
    emailNotSent: "電子郵件未透過郵件服務供應商傳送。",
    noWork: "自動化結束時沒有已確認的操作。請為唯讀報告設定傳送目標。",
    emptyDelivery: "自動化未產生要傳送到已設定目標的訊息。",
  },
  "ja-JP": {
    noOpInstruction:
      "対応が不要な場合は、短い理由を添えて automation-no-op を呼び出してください。ツールや送信の失敗、認証情報の不足はエラーであり、対応不要には該当しません。",
    noOpReason: "操作やレポートが不要だった短い理由（1～500文字）。",
    emailNotSent: "メールは配信プロバイダーから送信されませんでした。",
    noWork:
      "自動化は操作が確認されないまま終了しました。読み取り専用のレポートには配信先を設定してください。",
    emptyDelivery:
      "自動化は設定された配信先へのメッセージを生成しませんでした。",
  },
  "ko-KR": {
    noOpInstruction:
      "할 일이 없으면 짧은 이유와 함께 automation-no-op을 호출하세요. 도구 또는 전송 실패와 자격 증명 누락은 작업 없음이 아닌 오류입니다.",
    noOpReason: "작업이나 보고서가 필요하지 않았던 짧은 이유(1–500자).",
    emailNotSent: "이메일이 전송 제공업체를 통해 전송되지 않았습니다.",
    noWork:
      "확인된 작업 없이 자동화가 종료되었습니다. 읽기 전용 보고서에는 전송 대상을 설정하세요.",
    emptyDelivery:
      "자동화가 설정된 전송 대상에 보낼 메시지를 생성하지 않았습니다.",
  },
  "hi-IN": {
    noOpInstruction:
      "यदि कुछ करने की आवश्यकता नहीं है, तो संक्षिप्त कारण के साथ automation-no-op कॉल करें। विफल टूल, विफल भेजने की कोशिश या अनुपलब्ध क्रेडेंशियल त्रुटियाँ हैं, काम न होने की स्थिति नहीं।",
    noOpReason:
      "किसी कार्रवाई या रिपोर्ट की आवश्यकता न होने का संक्षिप्त कारण (1–500 अक्षर)।",
    emailNotSent: "ईमेल किसी डिलीवरी प्रदाता द्वारा नहीं भेजा गया।",
    noWork:
      "ऑटोमेशन किसी पुष्ट कार्रवाई के बिना समाप्त हो गया। केवल पढ़ने वाली रिपोर्ट के लिए डिलीवरी गंतव्य कॉन्फ़िगर करें।",
    emptyDelivery:
      "ऑटोमेशन ने अपने कॉन्फ़िगर किए गए डिलीवरी गंतव्य के लिए कोई संदेश नहीं बनाया।",
  },
  "ar-SA": {
    noOpInstruction:
      "إذا لم يكن هناك ما يجب فعله، استدعِ automation-no-op مع سبب موجز. فشل الأدوات أو الإرسال أو غياب بيانات الاعتماد أخطاء، وليس حالات لا تتطلب عملاً.",
    noOpReason: "سبب موجز لعدم الحاجة إلى إجراء أو تقرير (1–500 حرف).",
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
