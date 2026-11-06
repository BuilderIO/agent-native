import { getUserSetting } from "../settings/user-settings.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  type BuiltinLocaleCode,
} from "./shared.js";

const messages: Record<
  BuiltinLocaleCode,
  {
    limit: string;
    invalid: string;
    unavailable: string;
    referenceUnknown: string;
    referenceSignIn: string;
    referenceUnavailable: string;
  }
> = {
  "en-US": {
    referenceUnknown: "Unknown workspace reference source.",
    referenceSignIn: "Sign in to search workspace references.",
    referenceUnavailable: "Could not load workspace references.",

    limit: "Too many selected integrations.",
    invalid: "Choose a connected integration before sending.",
    unavailable:
      "A selected integration is no longer available to this app. Reconnect it or remove its reference before sending.",
  },
  "fr-FR": {
    referenceUnknown: "Source de référence de l’espace de travail inconnue.",
    referenceSignIn:
      "Connectez-vous pour rechercher des références de l’espace de travail.",
    referenceUnavailable:
      "Impossible de charger les références de l’espace de travail.",

    limit: "Trop d’intégrations sélectionnées.",
    invalid: "Choisissez une intégration connectée avant l’envoi.",
    unavailable:
      "Une intégration sélectionnée n’est plus accessible à cette application. Reconnectez-la ou supprimez sa référence avant l’envoi.",
  },
  "de-DE": {
    referenceUnknown: "Unbekannte Quelle für Arbeitsbereichsreferenzen.",
    referenceSignIn:
      "Melden Sie sich an, um Arbeitsbereichsreferenzen zu suchen.",
    referenceUnavailable:
      "Arbeitsbereichsreferenzen konnten nicht geladen werden.",

    limit: "Zu viele ausgewählte Integrationen.",
    invalid: "Wählen Sie vor dem Senden eine verbundene Integration.",
    unavailable:
      "Eine ausgewählte Integration ist für diese App nicht mehr verfügbar. Verbinden Sie sie erneut oder entfernen Sie ihren Verweis vor dem Senden.",
  },
  "es-ES": {
    referenceUnknown:
      "Fuente de referencias del espacio de trabajo desconocida.",
    referenceSignIn:
      "Inicia sesión para buscar referencias del espacio de trabajo.",
    referenceUnavailable:
      "No se pudieron cargar las referencias del espacio de trabajo.",

    limit: "Demasiadas integraciones seleccionadas.",
    invalid: "Elige una integración conectada antes de enviar.",
    unavailable:
      "Una integración seleccionada ya no está disponible para esta aplicación. Vuelve a conectarla o elimina su referencia antes de enviar.",
  },
  "pt-BR": {
    referenceUnknown:
      "Fonte de referências do espaço de trabalho desconhecida.",
    referenceSignIn: "Entre para pesquisar referências do espaço de trabalho.",
    referenceUnavailable:
      "Não foi possível carregar as referências do espaço de trabalho.",

    limit: "Muitas integrações selecionadas.",
    invalid: "Escolha uma integração conectada antes de enviar.",
    unavailable:
      "Uma integração selecionada não está mais disponível para este aplicativo. Reconecte-a ou remova sua referência antes de enviar.",
  },
  "ja-JP": {
    referenceUnknown: "不明なワークスペース参照元です。",
    referenceSignIn: "ワークスペースの参照を検索するにはログインしてください。",
    referenceUnavailable: "ワークスペースの参照を読み込めませんでした。",

    limit: "選択した連携が多すぎます。",
    invalid: "送信前に接続済みの連携を選択してください。",
    unavailable:
      "選択した連携はこのアプリで利用できなくなりました。再接続するか、参照を削除してから送信してください。",
  },
  "ko-KR": {
    referenceUnknown: "알 수 없는 워크스페이스 참조 소스입니다.",
    referenceSignIn: "워크스페이스 참조를 검색하려면 로그인하세요.",
    referenceUnavailable: "워크스페이스 참조를 불러오지 못했습니다.",

    limit: "선택한 통합이 너무 많습니다.",
    invalid: "전송 전에 연결된 통합을 선택하세요.",
    unavailable:
      "선택한 통합을 이 앱에서 더 이상 사용할 수 없습니다. 다시 연결하거나 참조를 제거한 후 전송하세요.",
  },
  "zh-CN": {
    referenceUnknown: "未知的工作区引用来源。",
    referenceSignIn: "请登录以搜索工作区引用。",
    referenceUnavailable: "无法加载工作区引用。",

    limit: "选择的集成过多。",
    invalid: "请在发送前选择已连接的集成。",
    unavailable:
      "所选集成已无法在此应用中使用。请重新连接或移除其引用后再发送。",
  },
  "zh-TW": {
    referenceUnknown: "未知的工作區參照來源。",
    referenceSignIn: "請登入以搜尋工作區參照。",
    referenceUnavailable: "無法載入工作區參照。",

    limit: "選取的整合項目過多。",
    invalid: "請在傳送前選擇已連線的整合項目。",
    unavailable:
      "此應用程式已無法使用選取的整合項目。請重新連線或移除其參照後再傳送。",
  },
  "hi-IN": {
    referenceUnknown: "कार्यस्थान संदर्भ का अज्ञात स्रोत।",
    referenceSignIn: "कार्यस्थान संदर्भ खोजने के लिए साइन इन करें।",
    referenceUnavailable: "कार्यस्थान संदर्भ लोड नहीं हो सके।",

    limit: "बहुत अधिक एकीकरण चुने गए हैं।",
    invalid: "भेजने से पहले कोई जुड़ा हुआ एकीकरण चुनें।",
    unavailable:
      "चुना गया एकीकरण अब इस ऐप के लिए उपलब्ध नहीं है। उसे फिर जोड़ें या भेजने से पहले उसका संदर्भ हटाएँ।",
  },
  "ar-SA": {
    referenceUnknown: "مصدر مراجع مساحة العمل غير معروف.",
    referenceSignIn: "سجّل الدخول للبحث في مراجع مساحة العمل.",
    referenceUnavailable: "تعذر تحميل مراجع مساحة العمل.",

    limit: "تم تحديد عدد كبير جدًا من عمليات التكامل.",
    invalid: "اختر تكاملًا متصلًا قبل الإرسال.",
    unavailable:
      "لم يعد أحد التكاملات المحددة متاحًا لهذا التطبيق. أعد توصيله أو أزل مرجعه قبل الإرسال.",
  },
};

export async function workspaceIntegrationMessagesForUser(userEmail: string) {
  const preference = normalizeLocalizationPreference(
    userEmail
      ? await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY)
      : undefined,
  );
  const locale = SUPPORTED_LOCALES.find(
    (candidate) => candidate === preference.locale,
  );
  return messages[locale ?? DEFAULT_LOCALE];
}
