import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
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
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "الاتصال بـ {appName}",
  authorizeLabel: "تخويل {appName}",
  terminalTitle: "هل تريد تخويل {appName} من الطرفية؟",
  assistantTitle: "استخدم {appName} من مساعد الذكاء الاصطناعي",
  signedInAs: "تم تسجيل الدخول باسم",
  deviceCode: "رمز الجهاز",
  guidesLabel: "أدلة عنوان MCP",
  advancedOptions: "خيارات متقدمة",
  labelOptional: "التسمية (اختيارية)",
  labelPlaceholder: "مثال: Claude Code على حاسوبي المحمول",
  expiresInDays: "تنتهي الصلاحية خلال (أيام، 1–365)",
  terminalAlternative: "بديل الطرفية",
  existingConnections: "الاتصالات الحالية",
  checkingConnections: "جارٍ التحقق من الاتصالات...",
  unavailable: "غير متاح",
  couldNotLoadConnections: "تعذر تحميل الاتصالات.",
  emptyConnections: "ستظهر الاتصالات التي أنشأتها هنا لإلغائها لاحقًا.",
  unlabeled: "(بلا تسمية)",
  lastUsed: "آخر استخدام",
  revoked: "تم الإلغاء",
  created: "تم الإنشاء",
  revoke: "إلغاء",
  couldNotRevoke: "تعذر إلغاء الرمز.",
  authorizeDevice: "تخويل الجهاز",
  fullCatalogRequested: "يطلب هذا الجهاز الوصول إلى كتالوج الإجراءات الكامل.",
  createToken: "إنشاء رمز اتصال",
  authorizingDevice: "جارٍ تخويل الجهاز...",
  creatingToken: "جارٍ إنشاء الرمز...",
  couldNotAuthorize: "تعذر تخويل رمز الجهاز هذا.",
  unknownDeviceCode:
    "لم يتم التعرف على رمز الجهاز هذا. أعد بدء الاتصال من جهازك الطرفي.",
  expiredDeviceCode:
    "انتهت صلاحية رمز الجهاز هذا. أعد بدء الاتصال من جهازك الطرفي.",
  alreadyUsedDeviceCode:
    "تم استخدام رمز الجهاز هذا من قبل. أعد بدء الاتصال من جهازك الطرفي.",
  finishingConnection: "جارٍ إنهاء الاتصال… يمكنك العودة إلى الطرفية.",
  deviceAuthorized: "تم تخويل الجهاز",
  connected: "متصل",
  connectedDescription:
    "يمكن لهذا الجهاز الآن التصرف نيابةً عنك. يمكنك إدارته أو إلغاءه أدناه.",
  couldNotCreate: "تعذر إنشاء الرمز.",
  networkError: "حدث خطأ في الشبكة. حاول مرة أخرى.",
  urlTitle: "عنوان MCP الخاص بك",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "صِل هذا التطبيق بـ Claude أو ChatGPT أو Cursor أو Codex أو أي مضيف MCP آخر.",
  mcpUrlLabel: "عنوان خادم MCP",
  mcpUrlHint:
    "انسخ هذا العنوان إلى مضيف الذكاء الاصطناعي الذي تريد استخدامه. المسار القياسي هو /mcp.",
  mcpOpenDocs: "فتح مستندات اتصال MCP",
  a2aAgentCard: "بطاقة وكيل A2A",
  a2aOpenDocs: "فتح وثائق A2A",
  mcpClientSetup: "توصيل مضيف ذكاء اصطناعي",
  mcpClientSetupDescription:
    "اختر مضيفًا لإعداد خطوة بخطوة، أو الصق العنوان في أي عميل متوافق مع MCP.",
  mcpChooseAssistant: "اختر مساعد الذكاء الاصطناعي",
  mcpCommand: "الأمر",
  mcpConfig: "إعداد MCP",
  mcpCopy: "نسخ",
  mcpCopied: "تم النسخ",
  mcpStaticTokenDescription:
    "افتح صفحة الاتصال الكاملة لإنشاء رمز مميز للعملاء الذين لا يستطيعون إكمال OAuth.",
  mcpOpenConnectPage: "فتح صفحة الاتصال الكاملة",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "الخصوصية والبيانات",
  privacyDescription: "اطلب نسخة من بياناتك أو اطلب حذف بياناتك الشخصية.",
  privacyManage: "إدارة",
  privacyRightsTitle: "حقوقك في بياناتك",
  privacyRightsDescription:
    "تُسجَّل الطلبات ليراجعها مسؤول مساحة العمل ويتحقق من هويتك ويتابع معك.",
  privacyRequestCopy: "طلب نسخة",
  privacyRequestDeletion: "طلب الحذف",
  privacyRequesting: "جارٍ تسجيل الطلب...",
  privacyRequestRecorded: "تم تسجيل الطلب. سيتواصل معك مسؤول.",
  privacyRequestRecordedShort: "تم تسجيل الطلب",
  privacyRequestError: "تعذّر تسجيل الطلب. حاول مرة أخرى.",
  privacyDeletionTitle: "طلب حذف بياناتك؟",
  privacyDeletionDescription:
    "يسجّل هذا طلب حذف، ولا يحذف البيانات فورًا. سيتحقق مسؤول من هويتك وينفذ الطلب وفق التزامات الاحتفاظ والالتزامات القانونية لهذا النشر.",
  privacyDocsLink: "قراءة معلومات الخصوصية وحقوق البيانات",
};
