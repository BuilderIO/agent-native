import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface ConsentBannerMessages {
  label: string;
  message: string;
  privacyPolicy: string;
  necessary: string;
  performance: string;
  targeting: string;
  rejectAll: string;
  acceptAll: string;
  save: string;
  manage: string;
  cookieSettings: string;
}

export const CONSENT_BANNER_MESSAGES: Record<
  BuiltinLocaleCode,
  ConsentBannerMessages
> = {
  "en-US": {
    label: "Cookie preferences",
    message:
      "We use cookies to measure how this site is used and which ads bring visitors here.",
    privacyPolicy: "Privacy policy",
    necessary: "Strictly necessary",
    performance: "Analytics",
    targeting: "Advertising and attribution",
    rejectAll: "Reject all",
    acceptAll: "Accept all",
    save: "Save choices",
    manage: "Manage settings",
    cookieSettings: "Cookie settings",
  },
  "es-ES": {
    label: "Preferencias de cookies",
    message:
      "Usamos cookies para medir cómo se usa este sitio y qué anuncios traen visitantes.",
    privacyPolicy: "Política de privacidad",
    necessary: "Estrictamente necesarias",
    performance: "Analítica",
    targeting: "Publicidad y atribución",
    rejectAll: "Rechazar todas",
    acceptAll: "Aceptar todas",
    save: "Guardar selección",
    manage: "Gestionar ajustes",
    cookieSettings: "Configuración de cookies",
  },
  "fr-FR": {
    label: "Préférences de cookies",
    message:
      "Nous utilisons des cookies pour mesurer l’utilisation de ce site et savoir quelles publicités amènent des visiteurs.",
    privacyPolicy: "Politique de confidentialité",
    necessary: "Strictement nécessaires",
    performance: "Mesure d’audience",
    targeting: "Publicité et attribution",
    rejectAll: "Tout refuser",
    acceptAll: "Tout accepter",
    save: "Enregistrer mes choix",
    manage: "Gérer les paramètres",
    cookieSettings: "Paramètres des cookies",
  },
  "de-DE": {
    label: "Cookie-Einstellungen",
    message:
      "Wir verwenden Cookies, um zu messen, wie diese Website genutzt wird und welche Anzeigen Besucher hierher bringen.",
    privacyPolicy: "Datenschutzerklärung",
    necessary: "Unbedingt erforderlich",
    performance: "Analyse",
    targeting: "Werbung und Attribution",
    rejectAll: "Alle ablehnen",
    acceptAll: "Alle akzeptieren",
    save: "Auswahl speichern",
    manage: "Einstellungen verwalten",
    cookieSettings: "Cookie-Einstellungen",
  },
  "pt-BR": {
    label: "Preferências de cookies",
    message:
      "Usamos cookies para medir como este site é usado e quais anúncios trazem visitantes.",
    privacyPolicy: "Política de privacidade",
    necessary: "Estritamente necessários",
    performance: "Análise",
    targeting: "Publicidade e atribuição",
    rejectAll: "Rejeitar todos",
    acceptAll: "Aceitar todos",
    save: "Salvar escolhas",
    manage: "Gerenciar configurações",
    cookieSettings: "Configurações de cookies",
  },
  "ja-JP": {
    label: "Cookie の設定",
    message:
      "このサイトの利用状況と、どの広告から訪問者が来ているかを測定するために Cookie を使用しています。",
    privacyPolicy: "プライバシーポリシー",
    necessary: "必須",
    performance: "分析",
    targeting: "広告とアトリビューション",
    rejectAll: "すべて拒否",
    acceptAll: "すべて許可",
    save: "選択を保存",
    manage: "設定を管理",
    cookieSettings: "Cookie の設定",
  },
  "ko-KR": {
    label: "쿠키 환경설정",
    message:
      "이 사이트의 이용 방식과 방문자를 데려오는 광고를 측정하기 위해 쿠키를 사용합니다.",
    privacyPolicy: "개인정보 처리방침",
    necessary: "필수",
    performance: "분석",
    targeting: "광고 및 어트리뷰션",
    rejectAll: "모두 거부",
    acceptAll: "모두 허용",
    save: "선택 저장",
    manage: "설정 관리",
    cookieSettings: "쿠키 설정",
  },
  "zh-CN": {
    label: "Cookie 偏好设置",
    message: "我们使用 Cookie 来衡量本网站的使用情况，以及哪些广告带来了访客。",
    privacyPolicy: "隐私政策",
    necessary: "绝对必要",
    performance: "分析",
    targeting: "广告与归因",
    rejectAll: "全部拒绝",
    acceptAll: "全部接受",
    save: "保存选择",
    manage: "管理设置",
    cookieSettings: "Cookie 设置",
  },
  "zh-TW": {
    label: "Cookie 偏好設定",
    message: "我們使用 Cookie 來衡量本網站的使用情況，以及哪些廣告帶來了訪客。",
    privacyPolicy: "隱私權政策",
    necessary: "絕對必要",
    performance: "分析",
    targeting: "廣告與歸因",
    rejectAll: "全部拒絕",
    acceptAll: "全部接受",
    save: "儲存選擇",
    manage: "管理設定",
    cookieSettings: "Cookie 設定",
  },
  "hi-IN": {
    label: "कुकी प्राथमिकताएँ",
    message:
      "हम यह मापने के लिए कुकी का उपयोग करते हैं कि यह साइट कैसे उपयोग होती है और कौन-से विज्ञापन विज़िटर लाते हैं।",
    privacyPolicy: "गोपनीयता नीति",
    necessary: "पूरी तरह आवश्यक",
    performance: "एनालिटिक्स",
    targeting: "विज्ञापन और एट्रिब्यूशन",
    rejectAll: "सभी अस्वीकार करें",
    acceptAll: "सभी स्वीकार करें",
    save: "विकल्प सहेजें",
    manage: "सेटिंग प्रबंधित करें",
    cookieSettings: "कुकी सेटिंग",
  },
  "ar-SA": {
    label: "تفضيلات ملفات تعريف الارتباط",
    message:
      "نستخدم ملفات تعريف الارتباط لقياس كيفية استخدام هذا الموقع والإعلانات التي تجلب الزوار إليه.",
    privacyPolicy: "سياسة الخصوصية",
    necessary: "ضرورية للغاية",
    performance: "التحليلات",
    targeting: "الإعلانات والإسناد",
    rejectAll: "رفض الكل",
    acceptAll: "قبول الكل",
    save: "حفظ الاختيارات",
    manage: "إدارة الإعدادات",
    cookieSettings: "إعدادات ملفات تعريف الارتباط",
  },
};

export function consentBannerMessagesForLocale(
  locale: LocaleCode,
): ConsentBannerMessages {
  return CONSENT_BANNER_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
