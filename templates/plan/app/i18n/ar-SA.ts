const messages = {
  root: {
    commandActions: "الإجراءات",
    askPlan: "اسأل Plan",
    openPlans: "فتح الخطط",
    openRecaps: "فتح الملخصات",
    commandAppearance: "المظهر",
    toggleTheme: "تبديل السمة",
  },
  header: {
    plan: "Plan",
    settings: "الإعدادات",
    team: "الفريق",
    extensions: "الإضافات",
  },
  navigation: {
    settings: "الإعدادات",
    ask: "اسأل",
    plan: "الخطة",
  },
  settings: {
    title: "الإعدادات",
    description: "تفضيلات اللغة ومساحة العمل لهذا التطبيق.",
    languageTitle: "اللغة",
    languageDescription: "اختر لغة الواجهة. يتم حفظ هذا التفضيل في حسابك.",
    languageLabel: "لغة الواجهة",
    workspaceTitle: "مساحة العمل",
    workspaceDescription:
      "إدارة أعضاء الفريق ووصول المؤسسة وتفضيلات مساحة العمل المشتركة.",
    openTeamSettings: "فتح إعدادات الفريق",
    openResourceSettings: "فتح إعدادات الموارد",
    agentTitle: "إعدادات الوكيل",
    agentDescription:
      "افتح إعدادات الوكيل في الشريط الجانبي لإدارة النموذج ومفاتيح API والأتمتة والصوت وعناصر التحكم الأخرى.",
    openAgentSettings: "فتح إعدادات الوكيل",
  },
  agent: {
    emptyState:
      "اطلب من وكيل Plan البحث في ملخصات طلبات الدمج المدمجة، أو فحص هذا المستند، أو إضافة مخططات، أو الإجابة عن أسئلة الكود كخطط مرئية.",
    suggestionShipped: "ما الذي تم شحنه في الأسبوع الماضي؟",
    suggestionUi: "كيف تبدو هذه الواجهة؟",
    suggestionApi: "ما شكل واجهة API هذه؟",
  },
  sidebar: {
    openNavigation: "فتح التنقل",
    navigation: "التنقل",
    navigationDescription: "روابط التنقل في التطبيق",
    chats: "المحادثات",
    newPlanChat: "محادثة Plan جديدة",
    newChat: "محادثة جديدة",
    renameChat: "إعادة تسمية المحادثة",
    unpinChat: "إلغاء تثبيت المحادثة",
    pinChat: "تثبيت المحادثة",
    archiveChat: "أرشفة المحادثة",
    planSection: "الخطة",
    newPlan: "خطة جديدة",
    signInCreatePlan: "سجّل الدخول لإنشاء خطة",
    signInToCreate: "سجّل الدخول للإنشاء",
    signInKeepPlans: "سجّل الدخول لإنشاء الخطط والاحتفاظ بها.",
    noPlans: "لا توجد خطط بعد.",
    recapBadge: "ملخص",
    viewAllPlans: "عرض كل الخطط...",
    brandingSentLocal: "تم إرسال طلب العلامة إلى وكيل الكود المحلي",
    brandingSent: "تم إرسال طلب العلامة إلى وكيل الكود",
    customizePlanBranding: "تخصيص علامة Plan",
    customizeBranding: "تخصيص العلامة",
    customizeBrandingDescription:
      "صف تغييرات العلامة التي تريد تطبيقها عبر Plan.",
    customizeBrandingPlaceholder:
      "استخدم شعارنا، غيّر اسم التطبيق، حدّث الألوان...",
    expandSidebar: "توسيع الشريط الجانبي",
    collapseSidebar: "طي الشريط الجانبي",
    signIn: "تسجيل الدخول",
  },
  chat: {
    suggestionShipped: "What shipped in the last week?",
    suggestionUi: "What does the new checkout UI look like?",
    suggestionAuth: "When did the auth API change?",
    suggestionApi: "What is the shape of the billing API?",
    emptyState: "Ask Plan",
    placeholder:
      "Ask what shipped, what changed, or what the current code shows...",
    heading: "Ask Plan",
    description:
      "Search merged PR recaps, inspect visual blocks, and publish code answers as diagrams, wireframes, API specs, and data models.",
  },
  guest: {
    banner:
      "You're browsing as a guest. Sign in to create plans, leave comments, and keep your work.",
    signIn: "Sign in",
  },
};

export default messages;
