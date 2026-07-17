const english = {
  readiness: "Readiness",
  noReadinessRequirements: "No readiness requirements",
  submissionRequirementsConfigured: "Submission requirements",
  statusGatesConfigured: "Status gates",
  readinessDescription:
    "Keep drafts flexible, then require evidence when work is submitted or reaches a meaningful status.",
  submissionRequirements: "Required on submission",
  submissionRequirementsDescription:
    "Forms and agent submissions must include these fields. Manual rows can remain drafts.",
  statusGates: "Status gates",
  statusGatesDescription:
    "Require specific fields before an item can enter a status.",
  addStatusGate: "Add gate",
  noStatusGates: "No status gates yet.",
  statusProperty: "Status property",
  chooseStatusProperty: "Choose a Status property",
  statusOption: "Resulting status",
  chooseStatusOption: "Choose a status",
  requiredEvidence: "Required fields",
  removeGate: "Remove gate",
  applyGate: "Apply gate",
  saveReadiness: "Save readiness",
  readinessSaved: "Readiness settings saved",
  readinessSaveFailed: "Couldn’t save readiness settings",
} as const;

type ValidationMessages = { [K in keyof typeof english]: string };
type ValidationLocale =
  | "en-US"
  | "zh-TW"
  | "zh-CN"
  | "es-ES"
  | "fr-FR"
  | "de-DE"
  | "ja-JP"
  | "ko-KR"
  | "pt-BR"
  | "hi-IN"
  | "ar-SA";

export const validationMessagesByLocale: Record<
  ValidationLocale,
  ValidationMessages
> = {
  "en-US": english,
  "zh-TW": {
    readiness: "就緒條件",
    noReadinessRequirements: "沒有就緒條件",
    submissionRequirementsConfigured: "提交必填條件",
    statusGatesConfigured: "狀態門檻",
    readinessDescription:
      "草稿可保持彈性；提交工作或進入重要狀態時，再要求完整資料。",
    submissionRequirements: "提交時必填",
    submissionRequirementsDescription:
      "表單與代理提交必須包含這些欄位；手動建立的資料列仍可保留為草稿。",
    statusGates: "狀態門檻",
    statusGatesDescription: "項目進入特定狀態前，必須填妥指定欄位。",
    addStatusGate: "新增門檻",
    noStatusGates: "尚無狀態門檻。",
    statusProperty: "狀態屬性",
    chooseStatusProperty: "選擇狀態屬性",
    statusOption: "結果狀態",
    chooseStatusOption: "選擇狀態",
    requiredEvidence: "必填欄位",
    removeGate: "移除門檻",
    applyGate: "套用門檻",
    saveReadiness: "儲存就緒條件",
    readinessSaved: "已儲存就緒條件",
    readinessSaveFailed: "無法儲存就緒條件",
  },
  "zh-CN": {
    readiness: "就绪条件",
    noReadinessRequirements: "没有就绪条件",
    submissionRequirementsConfigured: "提交必填条件",
    statusGatesConfigured: "状态门槛",
    readinessDescription:
      "草稿可以保持灵活；提交工作或进入重要状态时，再要求完整资料。",
    submissionRequirements: "提交时必填",
    submissionRequirementsDescription:
      "表单和代理提交必须包含这些字段；手动创建的行仍可保留为草稿。",
    statusGates: "状态门槛",
    statusGatesDescription: "项目进入特定状态前，必须填写指定字段。",
    addStatusGate: "添加门槛",
    noStatusGates: "尚无状态门槛。",
    statusProperty: "状态属性",
    chooseStatusProperty: "选择状态属性",
    statusOption: "结果状态",
    chooseStatusOption: "选择状态",
    requiredEvidence: "必填字段",
    removeGate: "移除门槛",
    applyGate: "应用门槛",
    saveReadiness: "保存就绪条件",
    readinessSaved: "已保存就绪条件",
    readinessSaveFailed: "无法保存就绪条件",
  },
  "es-ES": {
    readiness: "Preparación",
    noReadinessRequirements: "Sin requisitos de preparación",
    submissionRequirementsConfigured: "Requisitos de envío",
    statusGatesConfigured: "Controles de estado",
    readinessDescription:
      "Mantén flexibles los borradores y exige pruebas al enviar el trabajo o alcanzar un estado importante.",
    submissionRequirements: "Obligatorio al enviar",
    submissionRequirementsDescription:
      "Los formularios y envíos del agente deben incluir estos campos. Las filas manuales pueden seguir como borradores.",
    statusGates: "Controles de estado",
    statusGatesDescription:
      "Exige campos concretos antes de que un elemento entre en un estado.",
    addStatusGate: "Añadir control",
    noStatusGates: "Aún no hay controles de estado.",
    statusProperty: "Propiedad de estado",
    chooseStatusProperty: "Elegir una propiedad Estado",
    statusOption: "Estado resultante",
    chooseStatusOption: "Elegir un estado",
    requiredEvidence: "Campos obligatorios",
    removeGate: "Quitar control",
    applyGate: "Aplicar control",
    saveReadiness: "Guardar preparación",
    readinessSaved: "Configuración de preparación guardada",
    readinessSaveFailed: "No se pudo guardar la preparación",
  },
  "fr-FR": {
    readiness: "État de préparation",
    noReadinessRequirements: "Aucune condition de préparation",
    submissionRequirementsConfigured: "Conditions de soumission",
    statusGatesConfigured: "Verrous de statut",
    readinessDescription:
      "Gardez les brouillons souples, puis exigez des éléments lors de la soumission ou d’un statut important.",
    submissionRequirements: "Requis à la soumission",
    submissionRequirementsDescription:
      "Les formulaires et soumissions de l’agent doivent inclure ces champs. Les lignes manuelles peuvent rester en brouillon.",
    statusGates: "Verrous de statut",
    statusGatesDescription:
      "Exigez certains champs avant qu’un élément puisse atteindre un statut.",
    addStatusGate: "Ajouter un verrou",
    noStatusGates: "Aucun verrou de statut.",
    statusProperty: "Propriété de statut",
    chooseStatusProperty: "Choisir une propriété Statut",
    statusOption: "Statut obtenu",
    chooseStatusOption: "Choisir un statut",
    requiredEvidence: "Champs requis",
    removeGate: "Retirer le verrou",
    applyGate: "Appliquer le verrou",
    saveReadiness: "Enregistrer la préparation",
    readinessSaved: "Paramètres de préparation enregistrés",
    readinessSaveFailed: "Impossible d’enregistrer la préparation",
  },
  "de-DE": {
    readiness: "Bereitschaft",
    noReadinessRequirements: "Keine Bereitschaftsanforderungen",
    submissionRequirementsConfigured: "Einreichungsanforderungen",
    statusGatesConfigured: "Statussperren",
    readinessDescription:
      "Entwürfe bleiben flexibel; bei Einreichung oder einem wichtigen Status werden Nachweise verlangt.",
    submissionRequirements: "Bei Einreichung erforderlich",
    submissionRequirementsDescription:
      "Formulare und Agent-Einreichungen müssen diese Felder enthalten. Manuelle Zeilen dürfen Entwürfe bleiben.",
    statusGates: "Statussperren",
    statusGatesDescription:
      "Bestimmte Felder müssen ausgefüllt sein, bevor ein Eintrag einen Status erreicht.",
    addStatusGate: "Sperre hinzufügen",
    noStatusGates: "Noch keine Statussperren.",
    statusProperty: "Statuseigenschaft",
    chooseStatusProperty: "Statuseigenschaft auswählen",
    statusOption: "Zielstatus",
    chooseStatusOption: "Status auswählen",
    requiredEvidence: "Pflichtfelder",
    removeGate: "Sperre entfernen",
    applyGate: "Sperre anwenden",
    saveReadiness: "Bereitschaft speichern",
    readinessSaved: "Bereitschaftseinstellungen gespeichert",
    readinessSaveFailed: "Bereitschaft konnte nicht gespeichert werden",
  },
  "ja-JP": {
    readiness: "準備条件",
    noReadinessRequirements: "準備条件はありません",
    submissionRequirementsConfigured: "送信要件",
    statusGatesConfigured: "ステータス条件",
    readinessDescription:
      "下書きは柔軟に保ち、送信時や重要なステータスに進む際に必要情報を求めます。",
    submissionRequirements: "送信時の必須項目",
    submissionRequirementsDescription:
      "フォームとエージェントの送信にはこれらの項目が必要です。手動の行は下書きのままにできます。",
    statusGates: "ステータス条件",
    statusGatesDescription:
      "項目がステータスに進む前に、指定フィールドへの入力を求めます。",
    addStatusGate: "条件を追加",
    noStatusGates: "ステータス条件はまだありません。",
    statusProperty: "ステータスプロパティ",
    chooseStatusProperty: "ステータスプロパティを選択",
    statusOption: "移行先ステータス",
    chooseStatusOption: "ステータスを選択",
    requiredEvidence: "必須フィールド",
    removeGate: "条件を削除",
    applyGate: "条件を適用",
    saveReadiness: "準備条件を保存",
    readinessSaved: "準備条件を保存しました",
    readinessSaveFailed: "準備条件を保存できませんでした",
  },
  "ko-KR": {
    readiness: "준비 조건",
    noReadinessRequirements: "준비 조건 없음",
    submissionRequirementsConfigured: "제출 요구사항",
    statusGatesConfigured: "상태 조건",
    readinessDescription:
      "초안은 유연하게 두고, 제출하거나 중요한 상태에 도달할 때 필요한 정보를 요구합니다.",
    submissionRequirements: "제출 시 필수",
    submissionRequirementsDescription:
      "양식과 에이전트 제출에는 이 필드가 필요합니다. 수동 행은 초안으로 남길 수 있습니다.",
    statusGates: "상태 조건",
    statusGatesDescription:
      "항목이 특정 상태로 이동하기 전에 지정 필드를 요구합니다.",
    addStatusGate: "조건 추가",
    noStatusGates: "아직 상태 조건이 없습니다.",
    statusProperty: "상태 속성",
    chooseStatusProperty: "상태 속성 선택",
    statusOption: "결과 상태",
    chooseStatusOption: "상태 선택",
    requiredEvidence: "필수 필드",
    removeGate: "조건 제거",
    applyGate: "조건 적용",
    saveReadiness: "준비 조건 저장",
    readinessSaved: "준비 조건을 저장했습니다",
    readinessSaveFailed: "준비 조건을 저장하지 못했습니다",
  },
  "pt-BR": {
    readiness: "Prontidão",
    noReadinessRequirements: "Sem requisitos de prontidão",
    submissionRequirementsConfigured: "Requisitos de envio",
    statusGatesConfigured: "Controles de status",
    readinessDescription:
      "Mantenha os rascunhos flexíveis e exija evidências no envio ou ao atingir um status importante.",
    submissionRequirements: "Obrigatório no envio",
    submissionRequirementsDescription:
      "Formulários e envios do agente devem incluir estes campos. Linhas manuais podem continuar como rascunhos.",
    statusGates: "Controles de status",
    statusGatesDescription:
      "Exija campos específicos antes que um item entre em um status.",
    addStatusGate: "Adicionar controle",
    noStatusGates: "Ainda não há controles de status.",
    statusProperty: "Propriedade de status",
    chooseStatusProperty: "Escolher propriedade de Status",
    statusOption: "Status resultante",
    chooseStatusOption: "Escolher status",
    requiredEvidence: "Campos obrigatórios",
    removeGate: "Remover controle",
    applyGate: "Aplicar controle",
    saveReadiness: "Salvar prontidão",
    readinessSaved: "Configurações de prontidão salvas",
    readinessSaveFailed: "Não foi possível salvar a prontidão",
  },
  "hi-IN": {
    readiness: "तैयारी",
    noReadinessRequirements: "तैयारी की कोई आवश्यकता नहीं",
    submissionRequirementsConfigured: "सबमिशन आवश्यकताएँ",
    statusGatesConfigured: "स्थिति शर्तें",
    readinessDescription:
      "ड्राफ्ट को लचीला रखें, फिर सबमिट करते समय या महत्वपूर्ण स्थिति पर प्रमाण माँगें।",
    submissionRequirements: "सबमिशन पर ज़रूरी",
    submissionRequirementsDescription:
      "फ़ॉर्म और एजेंट सबमिशन में ये फ़ील्ड ज़रूरी हैं। मैन्युअल पंक्तियाँ ड्राफ्ट रह सकती हैं।",
    statusGates: "स्थिति शर्तें",
    statusGatesDescription:
      "किसी आइटम को स्थिति में जाने से पहले तय फ़ील्ड भरना ज़रूरी करें।",
    addStatusGate: "शर्त जोड़ें",
    noStatusGates: "अभी कोई स्थिति शर्त नहीं है।",
    statusProperty: "स्थिति प्रॉपर्टी",
    chooseStatusProperty: "स्थिति प्रॉपर्टी चुनें",
    statusOption: "परिणामी स्थिति",
    chooseStatusOption: "स्थिति चुनें",
    requiredEvidence: "ज़रूरी फ़ील्ड",
    removeGate: "शर्त हटाएँ",
    applyGate: "शर्त लागू करें",
    saveReadiness: "तैयारी सहेजें",
    readinessSaved: "तैयारी सेटिंग सहेजी गई",
    readinessSaveFailed: "तैयारी सेटिंग सहेजी नहीं जा सकी",
  },
  "ar-SA": {
    readiness: "الجاهزية",
    noReadinessRequirements: "لا توجد متطلبات جاهزية",
    submissionRequirementsConfigured: "متطلبات الإرسال",
    statusGatesConfigured: "شروط الحالة",
    readinessDescription:
      "اترك المسودات مرنة، ثم اطلب الأدلة عند الإرسال أو الوصول إلى حالة مهمة.",
    submissionRequirements: "مطلوب عند الإرسال",
    submissionRequirementsDescription:
      "يجب أن تتضمن النماذج وعمليات إرسال الوكيل هذه الحقول. يمكن أن تبقى الصفوف اليدوية كمسودات.",
    statusGates: "شروط الحالة",
    statusGatesDescription: "اطلب حقولاً محددة قبل انتقال العنصر إلى حالة معينة.",
    addStatusGate: "إضافة شرط",
    noStatusGates: "لا توجد شروط حالة بعد.",
    statusProperty: "خاصية الحالة",
    chooseStatusProperty: "اختر خاصية الحالة",
    statusOption: "الحالة الناتجة",
    chooseStatusOption: "اختر حالة",
    requiredEvidence: "الحقول المطلوبة",
    removeGate: "إزالة الشرط",
    applyGate: "تطبيق الشرط",
    saveReadiness: "حفظ الجاهزية",
    readinessSaved: "تم حفظ إعدادات الجاهزية",
    readinessSaveFailed: "تعذر حفظ إعدادات الجاهزية",
  },
} as const;
