const messages = {
  intelligence: {
    title: "الذكاء",
    description:
      "اختر اللحظات التي ينبغي أن يلاحظها CRM في أدلة المكالمات المحدودة. تُقيَّم أدوات التتبع الذكية عبر Ask CRM، وليس مباشرةً في شاشة الإعدادات هذه.",
    loading: "جارٍ تحميل أدوات التتبع…",
    kindKeyword: "كلمة رئيسية",
    kindSmart: "ذكي",
    enable: "تمكين",
    disable: "تعطيل",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "لا توجد أدوات تتبع للإشارات بعد",
    emptyDescription:
      "أضف كلمة رئيسية للمطابقة الحتمية أو معيارًا ذكيًا لكي يراجعه Ask CRM.",
    trackerDeleted: "تم حذف أداة التتبع.",
    trackerEnabled: "تم تمكين أداة التتبع.",
    trackerDisabled: "تم تعطيل أداة التتبع.",
    trackerUpdateFailed: "تعذر تحديث أداة التتبع.",
    trackerCreated: "تم إنشاء أداة التتبع.",
    trackerCreationFailed: "تعذر إنشاء أداة التتبع.",
    newTracker: "أداة تتبع جديدة",
    createTitle: "إنشاء أداة تتبع للإشارات",
    createDescription:
      "تتبع الكلمات الرئيسية الحتمية أو عرّف معيارًا ذكيًا محدودًا ليقيّمه Ask CRM مقابل أدلة المكالمات.",
    name: "الاسم",
    trackerDescription: "الوصف",
    detector: "الكاشف",
    keywords: "الكلمات الرئيسية",
    keywordsPlaceholder: "التسعير، التجديد، مراجعة الأمان",
    keywordsHelp: "افصل ما يصل إلى 40 كلمة رئيسية بفواصل.",
    classificationCriterion: "معيار التصنيف",
    criterionPlaceholder: "طابق قلقًا واضحًا بشأن توقيت التنفيذ.",
    creating: "جارٍ الإنشاء…",
    create: "إنشاء أداة التتبع",
    deleteTrackerAria: "حذف {{name}}",
    deleteTrackerTitle: "حذف {{name}}؟",
    deleteTrackerDescription:
      "سيمنع ذلك عمليات الإشارات المستقبلية من استخدام أداة التتبع هذه. تبقى الإشارات التي تمت مراجعتها كما هي.",
    cancel: "إلغاء",
    deleteTracker: "حذف أداة التتبع",
    keywordsSummary: "الكلمات الرئيسية: {{keywords}}",
    noKeywordsConfigured: "لم تُضبط أي كلمات رئيسية.",
    evaluatedThroughAsk: "تم التقييم عبر Ask CRM.",
  },
  recordActions: {
    evidenceAttached: "تم إرفاق دليل المكالمة.",
    evidenceAttachFailed: "تعذر إرفاق الدليل.",
    addEvidence: "إضافة دليل",
    attachEvidenceTitle: "إرفاق دليل من Clips",
    attachEvidenceDescription:
      "استخدم رابط صفحة Clips دائمًا. لا يخزن CRM إلا مرجع الأداة وعنوان URL للصفحة ومقتطفًا محدودًا، ولا يخزن أبدًا وسائط أو نصًا مفرغًا.",
    artifactId: "معرّف الأداة",
    clipsUrl: "عنوان URL لـ Clips",
    summary: "الملخص",
    shortExcerpt: "مقتطف قصير",
    attachEvidence: "إرفاق الدليل",
    automate: "أتمتة",
    reviewNewClipsCalls: "مراجعة مكالمات Clips الجديدة",
    reviewDescription:
      "أعد وصفة مراجعة لسجل CRM هذا من دون نسخ وسائط Clips أو نصوصها المفرغة.",
    disabledAutomationDescription:
      "تبدأ هذه العملية معطلة وتبقى مرتبطة بـ {{name}}. عند تفعيلها صراحةً، لا يمكن لكل مقطع جديد إرفاق سوى مرجع صفحة التسجيل الذي تم التحقق من الوصول إليه بهذا السجل.",
    handoffDescription:
      "لا يحتفظ التسليم إلا بمعرّف مقطع معتم وعنوان URL دائم لصفحة {{path}} ووقت الالتقاط. ويرفض عناوين URL للأحداث والوسائط ورموز الوصول والنصوص المفرغة والسجلات المستنتجة وعمليات الكتابة لدى الموفرين.",
    manageAutomations: "إدارة الأتمتة",
    configureWithAgent: "الإعداد مع الوكيل",
  },
  dashboard: {
    metaTitle: "مسار المبيعات · CRM",
    pipeline: "مسار المبيعات",
    ready: "لوحة معلومات مسار المبيعات جاهزة.",
    installFailed: "تعذر تثبيت لوحة معلومات مسار المبيعات.",
    loadingDescription: "جارٍ تحميل لوحة معلومات مسار المبيعات ضمن نطاق الوصول…",
    emptyDescription: "عرض مباشر يراعي الأذونات لقيمة الفرص حسب المرحلة.",
    installTitle: "تثبيت لوحة معلومات مسار المبيعات",
    installDescription:
      "ينشئ برنامج بيانات مملوكًا لـ CRM ولوحة معلومات خاصة لمساحة العمل الحالية.",
    installAction: "تثبيت لوحة معلومات مسار المبيعات",
    liveDescription:
      "تستخدم إجماليات الفرص المباشرة وصول CRM للمشاهد الحالي وتُحدَّث من برنامج بيانات مخزن مؤقتًا.",
    updating: "جارٍ التحديث…",
    updatePack: "تحديث الحزمة",
  },
};

export default messages;
