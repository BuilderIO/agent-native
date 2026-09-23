import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface EnvironmentBadgeMessages {
  betaLabel: string;
  betaTitle: string;
  productionTitle: string;
  activeDevelopment: string;
  feedbackPrompt: string;
  continuePrompt: string;
  switchToProduction: string;
  goToBeta: string;
  hideBadge: string;
  openSwitcher: string;
  localDevelopment: string;
  development: string;
}

export const ENVIRONMENT_BADGE_MESSAGES: Record<
  BuiltinLocaleCode,
  EnvironmentBadgeMessages
> = {
  "en-US": {
    betaLabel: "beta",
    betaTitle: "You're on Agent-Native {{label}}",
    productionTitle: "You're on Agent-Native Production",
    activeDevelopment: "Under active development",
    feedbackPrompt:
      "This template is under active development. We'd love your feedback as we build it.",
    continuePrompt: "Choose where you want to continue.",
    switchToProduction: "Switch to production",
    goToBeta: "Go to beta",
    hideBadge: "Hide badge",
    openSwitcher: "Open {{title}} switcher",
    localDevelopment: "Local development environment",
    development: "Development environment",
  },
  "es-ES": {
    betaLabel: "beta",
    betaTitle: "Estás en Agent-Native {{label}}",
    productionTitle: "Estás en Agent-Native Production",
    activeDevelopment: "En desarrollo activo",
    feedbackPrompt:
      "Esta plantilla está en desarrollo activo. Nos encantaría recibir tus comentarios mientras la construimos.",
    continuePrompt: "Elige dónde quieres continuar.",
    switchToProduction: "Cambiar a producción",
    goToBeta: "Ir a beta",
    hideBadge: "Ocultar insignia",
    openSwitcher: "Abrir el selector de {{title}}",
    localDevelopment: "Entorno de desarrollo local",
    development: "Entorno de desarrollo",
  },
  "fr-FR": {
    betaLabel: "bêta",
    betaTitle: "Vous êtes sur Agent-Native {{label}}",
    productionTitle: "Vous êtes sur Agent-Native Production",
    activeDevelopment: "En développement actif",
    feedbackPrompt:
      "Ce modèle est en développement actif. Vos retours nous aideront à le construire.",
    continuePrompt: "Choisissez où continuer.",
    switchToProduction: "Passer en production",
    goToBeta: "Accéder à la bêta",
    hideBadge: "Masquer le badge",
    openSwitcher: "Ouvrir le sélecteur {{title}}",
    localDevelopment: "Environnement de développement local",
    development: "Environnement de développement",
  },
  "de-DE": {
    betaLabel: "beta",
    betaTitle: "Du verwendest Agent-Native {{label}}",
    productionTitle: "Du verwendest Agent-Native Production",
    activeDevelopment: "In aktiver Entwicklung",
    feedbackPrompt:
      "Diese Vorlage befindet sich in aktiver Entwicklung. Wir freuen uns über dein Feedback.",
    continuePrompt: "Wähle aus, wo du fortfahren möchtest.",
    switchToProduction: "Zur Produktionsumgebung wechseln",
    goToBeta: "Zur Beta wechseln",
    hideBadge: "Badge ausblenden",
    openSwitcher: "{{title}}-Umschalter öffnen",
    localDevelopment: "Lokale Entwicklungsumgebung",
    development: "Entwicklungsumgebung",
  },
  "pt-BR": {
    betaLabel: "beta",
    betaTitle: "Você está no Agent-Native {{label}}",
    productionTitle: "Você está no Agent-Native Production",
    activeDevelopment: "Em desenvolvimento ativo",
    feedbackPrompt:
      "Este template está em desenvolvimento ativo. Adoraríamos receber seu feedback enquanto o construímos.",
    continuePrompt: "Escolha onde deseja continuar.",
    switchToProduction: "Mudar para produção",
    goToBeta: "Ir para beta",
    hideBadge: "Ocultar selo",
    openSwitcher: "Abrir o seletor de {{title}}",
    localDevelopment: "Ambiente de desenvolvimento local",
    development: "Ambiente de desenvolvimento",
  },
  "zh-CN": {
    betaLabel: "测试版",
    betaTitle: "你正在使用 Agent-Native {{label}}",
    productionTitle: "你正在使用 Agent-Native 正式版",
    activeDevelopment: "正在积极开发",
    feedbackPrompt: "此模板正在积极开发中。欢迎在我们完善它的过程中提供反馈。",
    continuePrompt: "选择要继续使用的环境。",
    switchToProduction: "切换到正式版",
    goToBeta: "前往测试版",
    hideBadge: "隐藏标记",
    openSwitcher: "打开 {{title}} 切换器",
    localDevelopment: "本地开发环境",
    development: "开发环境",
  },
  "zh-TW": {
    betaLabel: "測試版",
    betaTitle: "你目前正在使用 Agent-Native {{label}}",
    productionTitle: "你目前正在使用 Agent-Native 正式版",
    activeDevelopment: "正在積極開發",
    feedbackPrompt:
      "此範本正在積極開發中。歡迎在我們完善它的過程中提供意見回饋。",
    continuePrompt: "選擇要繼續使用的環境。",
    switchToProduction: "切換至正式版",
    goToBeta: "前往測試版",
    hideBadge: "隱藏標記",
    openSwitcher: "開啟 {{title}} 切換器",
    localDevelopment: "本機開發環境",
    development: "開發環境",
  },
  "ja-JP": {
    betaLabel: "ベータ",
    betaTitle: "Agent-Native {{label}}を使用中です",
    productionTitle: "Agent-Native 本番環境を使用中です",
    activeDevelopment: "積極的に開発中",
    feedbackPrompt:
      "このテンプレートは積極的に開発中です。開発を進めるため、ぜひフィードバックをお寄せください。",
    continuePrompt: "続行する環境を選択してください。",
    switchToProduction: "本番環境に切り替え",
    goToBeta: "ベータ版へ移動",
    hideBadge: "バッジを非表示",
    openSwitcher: "{{title}}切り替えを開く",
    localDevelopment: "ローカル開発環境",
    development: "開発環境",
  },
  "ko-KR": {
    betaLabel: "베타",
    betaTitle: "Agent-Native {{label}}를 사용 중입니다",
    productionTitle: "Agent-Native 프로덕션을 사용 중입니다",
    activeDevelopment: "활발히 개발 중",
    feedbackPrompt:
      "이 템플릿은 활발히 개발 중입니다. 만들어 가는 과정에서 의견을 들려주세요.",
    continuePrompt: "계속할 환경을 선택하세요.",
    switchToProduction: "프로덕션으로 전환",
    goToBeta: "베타로 이동",
    hideBadge: "배지 숨기기",
    openSwitcher: "{{title}} 전환기 열기",
    localDevelopment: "로컬 개발 환경",
    development: "개발 환경",
  },
  "hi-IN": {
    betaLabel: "बीटा",
    betaTitle: "आप Agent-Native {{label}} पर हैं",
    productionTitle: "आप Agent-Native प्रोडक्शन पर हैं",
    activeDevelopment: "सक्रिय विकास के तहत",
    feedbackPrompt:
      "यह टेम्पलेट सक्रिय विकास के तहत है। इसे बेहतर बनाने के लिए आपका फ़ीडबैक हमें पसंद आएगा।",
    continuePrompt: "चुनें कि आप कहाँ जारी रखना चाहते हैं।",
    switchToProduction: "प्रोडक्शन पर स्विच करें",
    goToBeta: "बीटा पर जाएँ",
    hideBadge: "बैज छिपाएँ",
    openSwitcher: "{{title}} स्विचर खोलें",
    localDevelopment: "स्थानीय विकास परिवेश",
    development: "विकास परिवेश",
  },
  "ar-SA": {
    betaLabel: "بيتا",
    betaTitle: "أنت على إصدار Agent-Native {{label}}",
    productionTitle: "أنت على إصدار Agent-Native للإنتاج",
    activeDevelopment: "قيد التطوير النشط",
    feedbackPrompt:
      "هذا القالب قيد التطوير النشط. يسعدنا تلقي ملاحظاتك بينما نعمل على تطويره.",
    continuePrompt: "اختر أين تريد المتابعة.",
    switchToProduction: "التبديل إلى إصدار الإنتاج",
    goToBeta: "الانتقال إلى الإصدار التجريبي",
    hideBadge: "إخفاء الشارة",
    openSwitcher: "فتح مُبدّل {{title}}",
    localDevelopment: "بيئة التطوير المحلية",
    development: "بيئة التطوير",
  },
};

export function environmentBadgeMessagesForLocale(
  locale: LocaleCode,
): EnvironmentBadgeMessages {
  return ENVIRONMENT_BADGE_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
