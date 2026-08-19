import type { LocaleCode } from "../localization/shared.js";

export interface AuthMarketingLocaleCopy {
  tagline?: string;
  description?: string;
  features?: string[];
}

export const AUTH_MARKETING_LOCALE_COPY: Partial<
  Record<LocaleCode, Record<string, AuthMarketingLocaleCopy>>
> = {
  "zh-CN": {
    analytics: {
      tagline: "你的 AI 代理会查询数据源、构建仪表板，并与你一起回答业务问题。",
      features: [
        "向 BigQuery、HubSpot、Jira 等数据源提问并获得答案",
        "代理构建的仪表板从所有数据源获取实时数据",
        "保存分析结果，代理可以按需使用最新数据重新运行",
      ],
    },
    brain: {
      tagline: "企业知识层，将未经整理的对话转化为经过审核、可搜索的机构知识。",
      features: [
        "导入转录、笔记、Slack 导出内容和 Granola 摘要",
        "用精确的来源引文验证每条事实",
        "通过提案工作流审核全公司的知识",
      ],
    },
    calendar: {
      tagline: "你的 AI 代理会安排、改期并管理日历，让你无需亲自处理。",
      features: [
        "查找空闲时间并代表你预订会议",
        "自动管理可用时间和预订链接",
        "即时回答日程问题并解决冲突",
      ],
    },
    clips: {
      tagline: "你的 AI 代理会转录、总结并搜索你记录的所有内容。",
      features: [
        "一键录屏（Loom 风格），自动生成标题、摘要和章节",
        "与日历同步的会议笔记（Granola 风格），提供实时转录和 AI 行动项",
        "按住 Fn 即可随时进行语音听写（Wisprflow 风格），返回干净文本",
        "统一搜索录音、会议和听写内容",
      ],
    },
    content: {
      tagline:
        "面向 MDX 的开源 Obsidian：你的 AI 代理会编辑本地文档、创建自定义区块并与你一起整理内容。",
      features: [
        "直接编辑本地 Markdown/MDX 文件，需要时再使用托管同步",
        "生成丰富的互动自定义 MDX 区块，并可视化编辑其属性",
        "即时搜索、总结、交叉引用并重组文档树",
      ],
    },
    plan: {
      tagline: "在代码变更前，将编码代理的计划转换为可视化、可批注的 HTML。",
      features: [
        "用一个提示创建图表、线框图、模型图和原型方案",
        "像使用视觉评审界面一样批注计划，无需阅读冗长的 Markdown",
        "在需要外部反馈时分享账户支持的评审链接",
      ],
    },
    design: {
      tagline:
        "描述你的想法即可进行设计和原型制作。AI 代理会在几秒内将其变成交互式、自适应的设计。",
      features: [
        "只需描述即可创建精致的原型",
        "构建并应用设计系统，让所有内容保持品牌一致",
        "导出作品或通过链接分享",
      ],
    },
    dispatch: {
      tagline: "你的 AI 代理会管理密钥、编排其他代理，并在工作区中路由消息。",
      features: [
        "集中管理密钥，并为每个应用提供细粒度授权",
        "跨代理编排，将任务委派给专业应用",
        "通过审批工作流路由 Slack 和 Telegram 消息",
      ],
    },
    forms: {
      tagline: "你的 AI 代理会与你一起构建、发布和分析表单。",
      features: [
        "用一句话创建完整表单",
        "即时发布，生成可分享链接和验证码",
        "按需获取回复摘要、导出和趋势分析",
      ],
    },
    assets: {
      tagline: "你的 AI 代理会与你一起创建、优化并整理符合品牌的资产。",
      features: [
        "从徽标、产品图、视频和参考资料构建可复用的资产库",
        "通过提示生成主视觉、图表、幻灯片素材、产品视觉和视频",
        "审核每次运行中的提示、参考资料、输出和优化过程",
      ],
    },
    mail: {
      tagline: "你的 AI 代理会与你一起阅读、起草和整理邮件。",
      features: [
        "写出符合你语气和风格的回复",
        "在统一收件箱中管理多个 Gmail 账户",
        "自动完成分流、归档和跟进",
      ],
    },
    slides: {
      tagline: "你的 AI 代理会与你一起构建、编辑和完善演示文稿。",
      features: [
        "用一个提示生成完整演示文稿",
        "演示或评审时进行精准的幻灯片编辑",
        "实现你与代理之间的实时协作",
      ],
    },
    chat: {
      tagline:
        "从聊天优先的 agent-native 应用开始，随着代理成长添加操作、界面和工作流。",
      features: [
        "支持持久线程和工具调用记录的全页聊天",
        "一次添加操作，即可从聊天、界面、HTTP、MCP、A2A 和 CLI 使用",
        "接入自己的代理运行时，或使用内置的 app-agent 循环构建",
      ],
    },
    crm: {
      tagline: "完整的 Native SQL CRM，或扎根于源系统的连接式伴侣应用。",
      features: [
        "在 Native SQL 中管理账户、人员、商机、任务和跟进节奏",
        "连接受限的 HubSpot 或 Salesforce 记录，无需复制凭据",
        "从界面或 CRM 代理使用相同的安全操作",
      ],
    },
    factory: {
      tagline:
        "构建代理工厂：一端输入工作，另一端输出已交付的变更，并由你控制关卡。",
      features: [
        "在一个队列中检查 Slack 和拉取请求信号",
        "通过提示和可审核的反馈调整规则",
        "带着持久审计记录批准有界的代理工作",
      ],
    },
    tasks: {
      tagline:
        "管理个人任务：在收件箱中分流，从列表中完成。让代理替你完成这一切。",
      features: [
        "收件箱分流：随时记录想法和草稿，准备好后再提升为任务",
        "任务管理：在保持你设定顺序的列表中创建、排序和完成任务",
        "用自定义字段追踪重要事项：文本、数字、货币、日期和彩色选择项",
        "你能在这里做的事，代理也能做；它还能看到屏幕，所以“完成这些”指的是你实际选中的行",
      ],
    },
  },
  "zh-TW": {
    analytics: {
      tagline:
        "你的 AI 代理會查詢資料來源、建立儀表板，並和你一起回答商業問題。",
      features: [
        "向 BigQuery、HubSpot、Jira 等資料來源提問並取得答案",
        "代理建立的儀表板會從所有資料來源擷取即時資料",
        "儲存分析結果，代理可以依需求用最新數據重新執行",
      ],
    },
    brain: {
      tagline: "企業知識層，將未整理的對話轉化為經過審核、可搜尋的機構知識。",
      features: [
        "匯入轉錄、筆記、Slack 匯出內容和 Granola 摘要",
        "用精確的來源引文驗證每項事實",
        "透過提案工作流程審核全公司的知識",
      ],
    },
    calendar: {
      tagline: "你的 AI 代理會安排、改期並管理行事曆，讓你不必親自處理。",
      features: [
        "尋找空檔並代表你預訂會議",
        "自動管理可用時間和預訂連結",
        "立即回答行程問題並解決衝突",
      ],
    },
    clips: {
      tagline: "你的 AI 代理會轉錄、摘要並搜尋你錄下的所有內容。",
      features: [
        "一鍵錄製螢幕（Loom 風格），自動產生標題、摘要和章節",
        "與行事曆同步的會議筆記（Granola 風格），提供即時轉錄和 AI 行動項目",
        "按住 Fn 即可隨時進行語音聽寫（Wisprflow 風格），返回乾淨文字",
        "統一搜尋錄音、會議和聽寫內容",
      ],
    },
    content: {
      tagline:
        "面向 MDX 的開源 Obsidian：你的 AI 代理會編輯本機文件、建立自訂區塊並和你一起整理內容。",
      features: [
        "直接編輯本機 Markdown/MDX 檔案，需要時再使用託管同步",
        "產生豐富的互動式自訂 MDX 區塊，並可視化編輯其屬性",
        "立即搜尋、摘要、交叉引用並重組文件樹",
      ],
    },
    plan: {
      tagline: "在程式碼變更前，將編碼代理的計畫轉換為可視化、可註記的 HTML。",
      features: [
        "用一個提示建立圖表、線框圖、模型圖和原型方案",
        "像使用視覺審查介面一樣註記計畫，不必閱讀冗長的 Markdown",
        "需要外部意見時分享帳戶支援的審查連結",
      ],
    },
    design: {
      tagline:
        "描述你的想法即可進行設計和原型製作。AI 代理會在幾秒內將其變成交互式、自適應的設計。",
      features: [
        "只要描述即可建立精緻原型",
        "建立並套用設計系統，讓所有內容維持品牌一致",
        "匯出作品或透過連結分享",
      ],
    },
    dispatch: {
      tagline: "你的 AI 代理會管理密鑰、編排其他代理，並在工作區中路由訊息。",
      features: [
        "集中管理密鑰，並為每個應用程式提供細緻的授權",
        "跨代理編排，將工作委派給專業應用程式",
        "透過審批工作流程路由 Slack 和 Telegram 訊息",
      ],
    },
    forms: {
      tagline: "你的 AI 代理會和你一起建立、發布與分析表單。",
      features: [
        "用一句話建立完整表單",
        "立即發布，產生可分享連結與驗證碼",
        "依需求取得回覆摘要、匯出與趨勢分析",
      ],
    },
    assets: {
      tagline: "你的 AI 代理會和你一起建立、優化並整理符合品牌的資產。",
      features: [
        "從標誌、產品圖、影片和參考資料建立可重複使用的資產庫",
        "透過提示產生主視覺、圖表、投影片素材、產品視覺和影片",
        "稽核每次執行中的提示、參考資料、輸出和優化過程",
      ],
    },
    mail: {
      tagline: "你的 AI 代理會和你一起閱讀、撰寫和整理電子郵件。",
      features: [
        "寫出符合你語氣和風格的回覆",
        "在統一收件匣中管理多個 Gmail 帳戶",
        "自動完成分流、封存和跟進",
      ],
    },
    slides: {
      tagline: "你的 AI 代理會和你一起建立、編輯和完善簡報。",
      features: [
        "用一個提示產生完整簡報",
        "簡報或審查時進行精準的投影片編輯",
        "實現你與代理之間的即時協作",
      ],
    },
    chat: {
      tagline:
        "從聊天優先的 agent-native 應用程式開始，隨著代理成長新增操作、畫面和工作流程。",
      features: [
        "支援持久執行緒和工具呼叫記錄的全頁聊天",
        "一次新增操作，即可從聊天、介面、HTTP、MCP、A2A 和 CLI 使用",
        "接入自己的代理執行環境，或使用內建的 app-agent 迴圈建立",
      ],
    },
    crm: {
      tagline: "完整的 Native SQL CRM，或紮根於來源系統的連線式伴侶應用程式。",
      features: [
        "在 Native SQL 中管理帳戶、人員、商機、任務和跟進節奏",
        "連線受限的 HubSpot 或 Salesforce 記錄，不必複製憑證",
        "從介面或 CRM 代理使用相同的安全操作",
      ],
    },
    factory: {
      tagline:
        "建立代理工廠：一端輸入工作，另一端輸出已交付的變更，並由你控制關卡。",
      features: [
        "在一個佇列中檢查 Slack 和拉取請求訊號",
        "透過提示和可審查的回饋調整規則",
        "帶著持久稽核記錄核准有界的代理工作",
      ],
    },
    tasks: {
      tagline:
        "管理個人任務：在收件匣中分流，從清單中完成。讓代理替你完成這一切。",
      features: [
        "收件匣分流：隨時記錄想法和草稿，準備好後再提升為任務",
        "任務管理：在保持你設定順序的清單中建立、排序和完成任務",
        "用自訂欄位追蹤重要事項：文字、數字、貨幣、日期和彩色選項",
        "你能在這裡做的事，代理也能做；它還能看到畫面，所以「完成這些」指的是你實際選取的列",
      ],
    },
  },
  "es-ES": {
    analytics: {
      tagline:
        "Tu agente de IA consulta tus fuentes de datos, crea paneles y responde preguntas de negocio contigo.",
      features: [
        "Haz preguntas y obtén respuestas desde BigQuery, HubSpot, Jira y más",
        "Paneles creados por el agente con datos actualizados de todas tus fuentes",
        "Análisis guardados que el agente puede volver a ejecutar con cifras nuevas",
      ],
    },
    brain: {
      tagline:
        "Una capa de conocimiento de la empresa donde las conversaciones sin procesar se convierten en conocimiento institucional revisado y consultable.",
      features: [
        "Importa transcripciones, notas, exportaciones de Slack y resúmenes de Granola",
        "Valida cada hecho con citas exactas de la fuente",
        "Revisa el conocimiento de toda la empresa mediante flujos de propuestas",
      ],
    },
    calendar: {
      tagline:
        "Tu agente de IA programa, cambia y gestiona tu calendario para que tú no tengas que hacerlo.",
      features: [
        "Encuentra huecos y reserva reuniones por ti",
        "Gestiona automáticamente la disponibilidad y los enlaces de reserva",
        "Responde preguntas sobre tu agenda y resuelve conflictos al instante",
      ],
    },
    clips: {
      tagline:
        "Tu agente de IA transcribe, resume y busca todo lo que grabas a tu lado.",
      features: [
        "Grabación de pantalla con un clic (estilo Loom), títulos, resúmenes y capítulos automáticos",
        "Notas de reuniones sincronizadas con el calendario (estilo Granola), con transcripciones en vivo y acciones de IA",
        "Dictado de voz con pulsación Fn (estilo Wisprflow): mantenla pulsada en cualquier lugar y recibe texto limpio",
        "Una biblioteca donde buscar grabaciones, reuniones y dictados",
      ],
    },
    content: {
      tagline:
        "Obsidian de código abierto para MDX: tu agente de IA edita documentos locales, crea bloques personalizados y organiza todo contigo.",
      features: [
        "Edita archivos Markdown/MDX locales directamente y usa sincronización alojada cuando la necesites",
        "Genera bloques MDX personalizados e interactivos y edita sus propiedades visualmente",
        "Busca, resume, cruza y reorganiza árboles de documentos al instante",
      ],
    },
    plan: {
      tagline:
        "Convierte los planes de tu agente de código en HTML visual y anotable antes de cambiar el código.",
      features: [
        "Crea diagramas, wireframes, maquetas y opciones de prototipo con un solo prompt",
        "Anota planes como una superficie de revisión visual en lugar de leer Markdown interminable",
        "Comparte enlaces de revisión vinculados a una cuenta cuando necesites comentarios externos",
      ],
    },
    design: {
      tagline:
        "Diseña y crea prototipos describiendo lo que quieres. El agente de IA convierte tus ideas en diseños interactivos y adaptables en segundos.",
      features: [
        "Crea prototipos pulidos con solo describirlos",
        "Construye y aplica sistemas de diseño para mantener todo alineado con tu marca",
        "Exporta tu trabajo o compártelo con un enlace",
      ],
    },
    dispatch: {
      tagline:
        "Tu agente de IA gestiona secretos, coordina otros agentes y enruta mensajes por tu workspace.",
      features: [
        "Bóveda centralizada para secretos con permisos detallados por aplicación",
        "Orquestación entre agentes y delegación a aplicaciones especializadas",
        "Enrutamiento de Slack y Telegram con flujos de aprobación",
      ],
    },
    forms: {
      tagline: "Tu agente de IA crea, publica y analiza formularios contigo.",
      features: [
        "Crea formularios completos con una sola frase",
        "Publicación instantánea con enlaces compartibles y captcha",
        "Resúmenes de respuestas, exportaciones y análisis de tendencias al instante",
      ],
    },
    assets: {
      tagline:
        "Tu agente de IA crea, perfecciona y organiza activos alineados con tu marca.",
      features: [
        "Construye bibliotecas reutilizables de logotipos, fotos de producto, vídeos y referencias",
        "Genera imágenes principales, diagramas, arte para diapositivas, visuales de producto y vídeos desde un prompt",
        "Audita prompts, referencias, resultados y mejoras en cada ejecución",
      ],
    },
    mail: {
      tagline: "Tu agente de IA lee, redacta y organiza tu correo contigo.",
      features: [
        "Respuestas que coinciden con tu tono y estilo",
        "Varias cuentas de Gmail en una sola bandeja de entrada",
        "Clasificación, archivo y seguimientos autónomos",
      ],
    },
    slides: {
      tagline:
        "Tu agente de IA crea, edita y perfecciona presentaciones contigo.",
      features: [
        "Genera presentaciones completas con un solo prompt",
        "Ediciones precisas de diapositivas mientras presentas o revisas",
        "Colaboración en tiempo real entre tú y el agente",
      ],
    },
    chat: {
      tagline:
        "Empieza con una aplicación agent-native centrada en el chat y añade acciones, pantallas y flujos a medida que crece tu agente.",
      features: [
        "Chat a pantalla completa con hilos persistentes e historial de llamadas a herramientas",
        "Añade acciones una vez y úsalas desde el chat, la UI, HTTP, MCP, A2A y CLI",
        "Conecta tu propio runtime de agente o usa el bucle app-agent incluido",
      ],
    },
    crm: {
      tagline:
        "Un CRM Native SQL completo o un compañero conectado basado en su sistema de origen.",
      features: [
        "Gestiona cuentas, personas, oportunidades, tareas y cadencias en Native SQL",
        "Conecta registros delimitados de HubSpot o Salesforce sin copiar credenciales",
        "Usa las mismas acciones seguras desde la UI o tu agente de CRM",
      ],
    },
    factory: {
      tagline:
        "Construye fábricas de agentes: trabajo por un lado, cambios entregados por el otro, con controles que tú defines.",
      features: [
        "Inspecciona señales de Slack y pull requests en una sola cola",
        "Ajusta reglas con prompts y feedback revisable",
        "Aprueba trabajo acotado del agente con un registro de auditoría duradero",
      ],
    },
    tasks: {
      tagline:
        "Gestiona tus tareas personales: clasifícalas en la bandeja y termínalas desde la lista. Un agente puede hacerlo todo por ti.",
      features: [
        "Clasificación de bandeja: captura ideas y borradores y conviértelos en tareas cuando estén listos",
        "Gestión de tareas: crea, reordena y completa tareas en una lista que conserva tu orden",
        "Sigue lo importante con campos personalizados: texto, números, moneda, fechas y selectores de colores",
        "Todo lo que haces aquí también puede hacerlo el agente; ve tu pantalla, así que «termina estas» significa las filas que seleccionaste",
      ],
    },
  },
  "fr-FR": {
    analytics: {
      tagline:
        "Votre agent IA interroge vos sources de données, crée des tableaux de bord et répond à vos questions métier avec vous.",
      features: [
        "Posez vos questions à BigQuery, HubSpot, Jira et bien d’autres sources",
        "Des tableaux de bord construits par l’agent avec les données à jour de toutes vos sources",
        "Des analyses enregistrées que l’agent peut relancer à la demande avec des chiffres récents",
      ],
    },
    brain: {
      tagline:
        "Une couche de connaissance d’entreprise où les conversations brutes deviennent un savoir institutionnel vérifié et consultable.",
      features: [
        "Importez des transcriptions, notes, exports Slack et résumés Granola",
        "Validez chaque fait avec des citations exactes de la source",
        "Révisez les connaissances de l’entreprise grâce à des workflows de propositions",
      ],
    },
    calendar: {
      tagline:
        "Votre agent IA planifie, replanifie et gère votre calendrier pour que vous n’ayez plus à le faire.",
      features: [
        "Trouvez des créneaux libres et réservez des réunions pour vous",
        "Gérez automatiquement les disponibilités et les liens de réservation",
        "Répondez aux questions d’agenda et résolvez les conflits instantanément",
      ],
    },
    clips: {
      tagline:
        "Votre agent IA transcrit, résume et recherche tout ce que vous enregistrez à vos côtés.",
      features: [
        "Enregistrement d’écran en un clic (style Loom), titres, résumés et chapitres automatiques",
        "Notes de réunion synchronisées au calendrier (style Granola), transcriptions en direct et actions IA",
        "Dictée vocale avec la touche Fn (style Wisprflow) : maintenez-la enfoncée n’importe où pour obtenir du texte propre",
        "Une bibliothèque unique pour rechercher enregistrements, réunions et dictées",
      ],
    },
    content: {
      tagline:
        "Un Obsidian open source pour MDX : votre agent IA édite les documents locaux, crée des blocs personnalisés et organise tout avec vous.",
      features: [
        "Modifiez directement les fichiers Markdown/MDX locaux et utilisez la synchronisation hébergée quand nécessaire",
        "Générez des blocs MDX personnalisés et interactifs et modifiez leurs propriétés visuellement",
        "Recherchez, résumez, croisez et réorganisez les arborescences de documents instantanément",
      ],
    },
    plan: {
      tagline:
        "Transformez les plans de votre agent de code en HTML visuel et annotable avant de modifier le code.",
      features: [
        "Créez diagrammes, wireframes, maquettes et options de prototype avec un seul prompt",
        "Annotez les plans sur une surface de revue visuelle au lieu de lire un long Markdown",
        "Partagez des liens de revue liés à un compte quand un retour externe est nécessaire",
      ],
    },
    design: {
      tagline:
        "Concevez et prototypez en décrivant ce que vous voulez. L’agent IA transforme vos idées en designs interactifs et responsives en quelques secondes.",
      features: [
        "Créez des prototypes soignés en les décrivant simplement",
        "Construisez et appliquez des systèmes de design pour garder une image de marque cohérente",
        "Exportez votre travail ou partagez-le avec un lien",
      ],
    },
    dispatch: {
      tagline:
        "Votre agent IA gère les secrets, orchestre les autres agents et achemine les messages dans votre workspace.",
      features: [
        "Coffre centralisé pour les secrets avec des accès précis par application",
        "Orchestration entre agents et délégation à des applications spécialisées",
        "Routage Slack et Telegram avec des workflows d’approbation",
      ],
    },
    forms: {
      tagline:
        "Votre agent IA crée, publie et analyse des formulaires avec vous.",
      features: [
        "Créez des formulaires complets à partir d’une seule phrase",
        "Publication instantanée avec liens partageables et captcha",
        "Résumés de réponses, exports et analyse des tendances à la demande",
      ],
    },
    assets: {
      tagline:
        "Votre agent IA crée, affine et organise des assets cohérents avec votre marque.",
      features: [
        "Construisez des bibliothèques réutilisables de logos, photos produit, vidéos et références",
        "Générez héros, diagrammes, visuels de présentation, visuels produit et vidéos depuis un prompt",
        "Auditez prompts, références, résultats et améliorations à chaque exécution",
      ],
    },
    mail: {
      tagline: "Votre agent IA lit, rédige et organise vos e-mails avec vous.",
      features: [
        "Des réponses qui respectent votre ton et votre style",
        "Plusieurs comptes Gmail dans une seule boîte de réception",
        "Tri, archivage et relances autonomes",
      ],
    },
    slides: {
      tagline:
        "Votre agent IA crée, modifie et affine vos présentations avec vous.",
      features: [
        "Générez des présentations entières avec un seul prompt",
        "Modifiez précisément les diapositives pendant la présentation ou la revue",
        "Collaborez en temps réel avec l’agent",
      ],
    },
    chat: {
      tagline:
        "Commencez avec une application agent-native centrée sur le chat et ajoutez actions, écrans et workflows au fil de la croissance de votre agent.",
      features: [
        "Chat pleine page avec fils persistants et historique des appels d’outils",
        "Ajoutez une action une fois et utilisez-la depuis le chat, l’UI, HTTP, MCP, A2A et la CLI",
        "Branchez votre propre runtime d’agent ou utilisez la boucle app-agent incluse",
      ],
    },
    crm: {
      tagline:
        "Un CRM Native SQL complet ou un compagnon connecté et ancré dans son système source.",
      features: [
        "Gérez comptes, personnes, opportunités, tâches et cadences dans Native SQL",
        "Connectez des enregistrements HubSpot ou Salesforce avec accès limité, sans copier les identifiants",
        "Utilisez les mêmes actions sûres depuis l’UI ou votre agent CRM",
      ],
    },
    factory: {
      tagline:
        "Construisez des usines d’agents : le travail entre d’un côté, les changements livrés sortent de l’autre, avec des garde-fous que vous contrôlez.",
      features: [
        "Inspectez les signaux Slack et les pull requests dans une seule file",
        "Ajustez les règles avec des prompts et des retours révisables",
        "Approuvez le travail borné de l’agent avec une piste d’audit durable",
      ],
    },
    tasks: {
      tagline:
        "Gérez vos tâches personnelles : triez-les dans la boîte de réception et terminez-les depuis la liste. Un agent peut tout faire pour vous.",
      features: [
        "Tri de la boîte de réception : capturez idées et brouillons, puis transformez-les en tâches quand ils sont prêts",
        "Gestion des tâches : créez, réorganisez et terminez les tâches dans une liste qui conserve votre ordre",
        "Suivez l’essentiel avec des champs personnalisés : texte, nombres, devise, dates et sélecteurs colorés",
        "Tout ce que vous faites ici, l’agent peut aussi le faire ; il voit votre écran, donc « termine celles-ci » désigne les lignes sélectionnées",
      ],
    },
  },
  "de-DE": {
    analytics: {
      tagline:
        "Dein KI-Agent fragt deine Datenquellen ab, erstellt Dashboards und beantwortet gemeinsam mit dir Geschäftsfragen.",
      features: [
        "Stelle Fragen und erhalte Antworten aus BigQuery, HubSpot, Jira und mehr",
        "Vom Agenten erstellte Dashboards mit aktuellen Daten aus all deinen Quellen",
        "Gespeicherte Analysen, die der Agent bei Bedarf mit neuen Zahlen erneut ausführen kann",
      ],
    },
    brain: {
      tagline:
        "Eine Wissensebene für Unternehmen, die rohe Gespräche in geprüfte und durchsuchbare institutionelle Erkenntnisse verwandelt.",
      features: [
        "Importiere Transkripte, Notizen, Slack-Exporte und Granola-Zusammenfassungen",
        "Prüfe jede Tatsache anhand exakter Quellenzitate",
        "Überprüfe unternehmensweites Wissen in Vorschlags-Workflows",
      ],
    },
    calendar: {
      tagline:
        "Dein KI-Agent plant, verschiebt und verwaltet deinen Kalender, damit du es nicht selbst tun musst.",
      features: [
        "Finde freie Zeiten und buche Meetings in deinem Namen",
        "Verwalte Verfügbarkeiten und Buchungslinks automatisch",
        "Beantworte Fragen zum Zeitplan und löse Konflikte sofort",
      ],
    },
    clips: {
      tagline:
        "Dein KI-Agent transkribiert, fasst zusammen und durchsucht alles, was du nebenbei aufzeichnest.",
      features: [
        "Bildschirmaufnahme mit einem Klick (Loom-Stil) sowie automatische Titel, Zusammenfassungen und Kapitel",
        "Kalendersynchronisierte Meeting-Notizen (Granola-Stil) mit Live-Transkripten und KI-Aktionspunkten",
        "Push-to-talk-Sprachdiktat mit Fn-Taste (Wisprflow-Stil): überall gedrückt halten und sauberen Text erhalten",
        "Eine durchsuchbare Bibliothek für Aufnahmen, Meetings und Diktate",
      ],
    },
    content: {
      tagline:
        "Open-Source-Obsidian für MDX: Dein KI-Agent bearbeitet lokale Dokumente, erstellt eigene Blöcke und organisiert alles mit dir.",
      features: [
        "Bearbeite lokale Markdown/MDX-Dateien direkt und nutze bei Bedarf die gehostete Synchronisierung",
        "Erzeuge interaktive benutzerdefinierte MDX-Blöcke und bearbeite ihre Eigenschaften visuell",
        "Durchsuche, fasse zusammen, verknüpfe und strukturiere Dokumentbäume sofort neu",
      ],
    },
    plan: {
      tagline:
        "Verwandle die Pläne deines Coding-Agenten in visuelles, annotierbares HTML, bevor sich der Code ändert.",
      features: [
        "Erstelle Diagramme, Wireframes, Mockups und Prototyp-Varianten aus einem Prompt",
        "Kommentiere Pläne auf einer visuellen Review-Fläche statt langes Markdown zu lesen",
        "Teile kontobasierte Review-Links, wenn externes Feedback nötig ist",
      ],
    },
    design: {
      tagline:
        "Entwirf und prototypisiere, indem du beschreibst, was du möchtest. Der KI-Agent macht daraus in Sekunden interaktive, responsive Designs.",
      features: [
        "Erstelle ausgearbeitete Prototypen, indem du sie einfach beschreibst",
        "Baue Designsysteme und wende sie an, damit alles markenkonform bleibt",
        "Exportiere deine Arbeit oder teile sie per Link",
      ],
    },
    dispatch: {
      tagline:
        "Dein KI-Agent verwaltet Secrets, koordiniert andere Agenten und leitet Nachrichten durch deinen Workspace.",
      features: [
        "Zentraler Tresor für Secrets mit granularen Freigaben pro App",
        "Orchestrierung zwischen Agenten und Delegation an spezialisierte Apps",
        "Slack- und Telegram-Routing mit Genehmigungs-Workflows",
      ],
    },
    forms: {
      tagline:
        "Dein KI-Agent erstellt, veröffentlicht und analysiert gemeinsam mit dir Formulare.",
      features: [
        "Erstelle vollständige Formulare aus einem einzigen Satz",
        "Sofortige Veröffentlichung mit teilbaren Links und Captcha",
        "Antwortzusammenfassungen, Exporte und Trendanalysen auf Abruf",
      ],
    },
    assets: {
      tagline:
        "Dein KI-Agent erstellt, verfeinert und organisiert markengerechte Assets gemeinsam mit dir.",
      features: [
        "Baue wiederverwendbare Asset-Bibliotheken aus Logos, Produktfotos, Videos und Referenzen",
        "Erzeuge Hero-Bilder, Diagramme, Foliengrafiken, Produktvisuals und Videos aus einem Prompt",
        "Prüfe Prompts, Referenzen, Ergebnisse und Verfeinerungen über jeden Lauf hinweg",
      ],
    },
    mail: {
      tagline:
        "Dein KI-Agent liest, verfasst und organisiert gemeinsam mit dir E-Mails.",
      features: [
        "Antworten, die zu deinem Ton und Stil passen",
        "Mehrere Gmail-Konten in einem gemeinsamen Posteingang",
        "Automatische Sortierung, Archivierung und Nachverfolgung",
      ],
    },
    slides: {
      tagline:
        "Dein KI-Agent erstellt, bearbeitet und verfeinert Präsentationen gemeinsam mit dir.",
      features: [
        "Erzeuge komplette Präsentationen aus einem einzigen Prompt",
        "Präzise Folienbearbeitung während der Präsentation oder des Reviews",
        "Echtzeit-Zusammenarbeit zwischen dir und dem Agenten",
      ],
    },
    chat: {
      tagline:
        "Starte mit einer chat-zentrierten agent-native App und ergänze Aktionen, Screens und Workflows, während dein Agent wächst.",
      features: [
        "Vollseitiger Chat mit dauerhaften Threads und Tool-Aufrufverlauf",
        "Aktionen einmal hinzufügen und aus Chat, UI, HTTP, MCP, A2A und CLI verwenden",
        "Eigene Agent-Runtime anschließen oder den enthaltenen app-agent-Loop nutzen",
      ],
    },
    crm: {
      tagline:
        "Ein vollständiges Native-SQL-CRM oder ein angebundener Begleiter, der auf seinem Quellsystem aufbaut.",
      features: [
        "Konten, Personen, Chancen, Aufgaben und Taktungen in Native SQL verwalten",
        "Begrenzte HubSpot- oder Salesforce-Datensätze anbinden, ohne Zugangsdaten zu kopieren",
        "Dieselben sicheren Aktionen aus der UI oder deinem CRM-Agenten nutzen",
      ],
    },
    factory: {
      tagline:
        "Baue Agentenfabriken: Arbeit kommt auf der einen Seite hinein, ausgelieferte Änderungen kommen auf der anderen heraus, mit deinen Regeln.",
      features: [
        "Slack- und Pull-Request-Signale in einer einzigen Warteschlange prüfen",
        "Regeln mit Prompts und überprüfbarem Feedback abstimmen",
        "Begrenzte Agentenarbeit mit einer dauerhaften Audit-Spur genehmigen",
      ],
    },
    tasks: {
      tagline:
        "Verwalte deine persönlichen Aufgaben: im Posteingang sortieren, aus der Liste erledigen. Ein Agent kann das alles für dich übernehmen.",
      features: [
        "Posteingangssortierung: Ideen und Entwürfe erfassen und bei Bedarf in Aufgaben umwandeln",
        "Aufgabenverwaltung: Aufgaben in einer Liste erstellen, neu ordnen und erledigen, die deine Reihenfolge beibehält",
        "Wichtiges mit benutzerdefinierten Feldern verfolgen: Text, Zahlen, Währung, Daten und farbige Auswahlfelder",
        "Alles, was du hier tun kannst, kann auch der Agent; er sieht deinen Bildschirm, daher meint „diese erledigen“ die ausgewählten Zeilen",
      ],
    },
  },
  "ja-JP": {
    analytics: {
      tagline:
        "AI エージェントがデータソースを検索し、ダッシュボードを作成し、ビジネス上の質問にあなたと一緒に答えます。",
      features: [
        "BigQuery、HubSpot、Jira などに質問して回答を取得",
        "すべてのデータソースから最新データを取得するエージェント作成のダッシュボード",
        "保存した分析を、最新の数値でエージェントが必要なときに再実行",
      ],
    },
    brain: {
      tagline:
        "生の会話をレビュー済みで検索可能な組織知識に変える、会社のナレッジレイヤーです。",
      features: [
        "文字起こし、メモ、Slack エクスポート、Granola の要約をインポート",
        "正確な出典の引用で事実を検証",
        "提案ワークフローで会社全体のナレッジをレビュー",
      ],
    },
    calendar: {
      tagline:
        "AI エージェントが予定の作成、変更、管理を行うので、あなたが操作する必要はありません。",
      features: [
        "空き時間を探して、あなたに代わって会議を予約",
        "空き状況と予約リンクを自動管理",
        "スケジュールの質問に答え、競合をすぐに解決",
      ],
    },
    clips: {
      tagline:
        "AI エージェントがあなたの録画をすべて文字起こし、要約、検索します。",
      features: [
        "ワンクリックの画面録画（Loom スタイル）と自動タイトル、要約、チャプター",
        "カレンダー同期の会議メモ（Granola スタイル）とライブ文字起こし、AI アクション項目",
        "Fn キーを押してどこでも音声入力（Wisprflow スタイル）。きれいなテキストを取得",
        "録画、会議、音声入力をまとめて検索できるライブラリ",
      ],
    },
    content: {
      tagline:
        "MDX のためのオープンソース Obsidian：AI エージェントがローカル文書を編集し、カスタムブロックを作成して整理します。",
      features: [
        "ローカルの Markdown/MDX ファイルを直接編集し、必要なときだけホスト同期を利用",
        "リッチなインタラクティブ MDX ブロックを生成し、プロパティを視覚的に編集",
        "文書ツリーを検索、要約、相互参照、再構成",
      ],
    },
    plan: {
      tagline:
        "コードを変更する前に、コーディングエージェントの計画を視覚的で注釈可能な HTML に変換します。",
      features: [
        "1 つのプロンプトから図、ワイヤーフレーム、モックアップ、プロトタイプ案を作成",
        "長い Markdown を読む代わりに、ビジュアルレビュー画面で計画に注釈を追加",
        "外部からのフィードバックが必要なときにアカウント対応のレビューリンクを共有",
      ],
    },
    design: {
      tagline:
        "欲しいものを説明してデザインとプロトタイプを作成。AI エージェントが数秒でインタラクティブでレスポンシブなデザインにします。",
      features: [
        "説明するだけで洗練されたプロトタイプを作成",
        "デザインシステムを構築して適用し、ブランドの一貫性を維持",
        "作品をエクスポートまたはリンクで共有",
      ],
    },
    dispatch: {
      tagline:
        "AI エージェントがシークレットを管理し、他のエージェントを調整し、ワークスペース内でメッセージを振り分けます。",
      features: [
        "アプリごとに細かな権限を設定できるシークレットの集中保管庫",
        "エージェント間のオーケストレーションと専門アプリへの委任",
        "承認ワークフロー付きの Slack と Telegram ルーティング",
      ],
    },
    forms: {
      tagline: "AI エージェントがフォームの作成、公開、分析を一緒に進めます。",
      features: [
        "一文から完全なフォームを作成",
        "共有リンクと CAPTCHA 付きで即時公開",
        "回答の要約、エクスポート、トレンド分析を必要なときに実行",
      ],
    },
    assets: {
      tagline:
        "AI エージェントがブランドに合ったアセットを作成、改善、整理します。",
      features: [
        "ロゴ、商品写真、動画、参考資料から再利用可能なアセットライブラリを構築",
        "プロンプトからヒーロー画像、図、スライド素材、商品ビジュアル、動画を生成",
        "すべての実行でプロンプト、参考資料、出力、改善を監査",
      ],
    },
    mail: {
      tagline: "AI エージェントがメールを読み、下書きし、整理します。",
      features: [
        "あなたのトーンとスタイルに合った返信",
        "複数の Gmail アカウントを 1 つの受信トレイで管理",
        "振り分け、アーカイブ、フォローアップを自動化",
      ],
    },
    slides: {
      tagline: "AI エージェントがプレゼンテーションを作成、編集、改善します。",
      features: [
        "1 つのプロンプトからデッキ全体を生成",
        "発表中やレビュー中でもスライドを正確に編集",
        "あなたとエージェントがリアルタイムで共同作業",
      ],
    },
    chat: {
      tagline:
        "チャット中心の agent-native アプリから始め、エージェントの成長に合わせてアクション、画面、ワークフローを追加します。",
      features: [
        "永続スレッドとツール呼び出し履歴を備えたフルページチャット",
        "アクションを一度追加すれば、チャット、UI、HTTP、MCP、A2A、CLI から利用可能",
        "独自のエージェントランタイムを接続するか、組み込みの app-agent ループを利用",
      ],
    },
    crm: {
      tagline:
        "完全な Native SQL CRM、またはソースシステムを基盤にした接続型コンパニオンです。",
      features: [
        "Native SQL でアカウント、人物、商談、タスク、ケイデンスを管理",
        "認証情報をコピーせず、権限を絞った HubSpot や Salesforce のレコードを接続",
        "UI または CRM エージェントから同じ安全なアクションを利用",
      ],
    },
    factory: {
      tagline:
        "エージェントファクトリーを構築：一方から仕事を受け取り、管理できるゲートを通して変更を届けます。",
      features: [
        "Slack とプルリクエストのシグナルを 1 つのキューで確認",
        "プロンプトとレビュー可能なフィードバックでルールを調整",
        "永続的な監査証跡付きで範囲を限定したエージェント作業を承認",
      ],
    },
    tasks: {
      tagline:
        "個人タスクを管理：受信トレイで振り分け、リストから完了。エージェントにすべて任せられます。",
      features: [
        "受信トレイの振り分け：アイデアや下書きを記録し、準備ができたらタスクに昇格",
        "タスク管理：設定した順序を保つリストでタスクを作成、並べ替え、完了",
        "カスタムフィールド（テキスト、数値、通貨、日付、色付き選択肢）で大切なものを追跡",
        "ここでできることはエージェントにもできます。画面を見ているので、「これらを完了」は選択した行を指します",
      ],
    },
  },
  "ko-KR": {
    analytics: {
      tagline:
        "AI 에이전트가 데이터 소스를 조회하고 대시보드를 만들며 비즈니스 질문에 함께 답합니다.",
      features: [
        "BigQuery, HubSpot, Jira 등 어디에든 질문하고 답변 받기",
        "모든 소스의 최신 데이터를 가져오는 에이전트 제작 대시보드",
        "저장한 분석을 최신 수치로 필요할 때 에이전트가 다시 실행",
      ],
    },
    brain: {
      tagline:
        "가공되지 않은 대화를 검토되고 검색 가능한 조직 지식으로 바꾸는 회사 지식 계층입니다.",
      features: [
        "트랜스크립트, 메모, Slack 내보내기, Granola 요약 가져오기",
        "정확한 출처 인용으로 모든 사실 검증",
        "제안 워크플로를 통해 회사 전체 지식 검토",
      ],
    },
    calendar: {
      tagline:
        "AI 에이전트가 캘린더를 예약하고 변경하고 관리하므로 직접 처리할 필요가 없습니다.",
      features: [
        "빈 시간을 찾아 대신 회의 예약",
        "가용 시간과 예약 링크 자동 관리",
        "일정 질문에 답하고 충돌 즉시 해결",
      ],
    },
    clips: {
      tagline: "AI 에이전트가 녹화한 모든 내용을 받아쓰고 요약하고 검색합니다.",
      features: [
        "원클릭 화면 녹화(Loom 스타일)와 자동 제목, 요약, 챕터",
        "캘린더 동기화 회의 노트(Granola 스타일), 실시간 트랜스크립트와 AI 액션 아이템",
        "Fn을 누르고 어디서나 음성 받아쓰기(Wisprflow 스타일), 깔끔한 텍스트 받기",
        "녹화, 회의, 받아쓰기를 한곳에서 검색하는 라이브러리",
      ],
    },
    content: {
      tagline:
        "MDX를 위한 오픈 소스 Obsidian: AI 에이전트가 로컬 문서를 편집하고 사용자 지정 블록을 만들며 함께 정리합니다.",
      features: [
        "로컬 Markdown/MDX 파일을 직접 편집하고 필요할 때 호스팅 동기화 사용",
        "풍부한 대화형 사용자 지정 MDX 블록을 생성하고 속성을 시각적으로 편집",
        "문서 트리를 즉시 검색, 요약, 상호 참조, 재구성",
      ],
    },
    plan: {
      tagline:
        "코드를 변경하기 전에 코딩 에이전트의 계획을 시각적이고 주석을 달 수 있는 HTML로 변환합니다.",
      features: [
        "하나의 프롬프트로 다이어그램, 와이어프레임, 목업, 프로토타입 옵션 생성",
        "긴 Markdown을 읽는 대신 시각적 리뷰 화면에서 계획에 주석 달기",
        "외부 피드백이 필요할 때 계정 기반 리뷰 링크 공유",
      ],
    },
    design: {
      tagline:
        "원하는 것을 설명해 디자인과 프로토타입을 만드세요. AI 에이전트가 몇 초 만에 대화형 반응형 디자인으로 바꿉니다.",
      features: [
        "설명만으로 완성도 높은 프로토타입 만들기",
        "디자인 시스템을 만들고 적용해 브랜드 일관성 유지",
        "작업을 내보내거나 링크로 공유",
      ],
    },
    dispatch: {
      tagline:
        "AI 에이전트가 시크릿을 관리하고 다른 에이전트를 조율하며 워크스페이스에서 메시지를 라우팅합니다.",
      features: [
        "앱별 세밀한 권한을 제공하는 중앙 시크릿 보관함",
        "에이전트 간 오케스트레이션과 전문 앱으로의 위임",
        "승인 워크플로가 있는 Slack 및 Telegram 라우팅",
      ],
    },
    forms: {
      tagline: "AI 에이전트가 양식 생성, 게시, 분석을 함께 도와줍니다.",
      features: [
        "한 문장으로 완성된 양식 만들기",
        "공유 링크와 captcha로 즉시 게시",
        "응답 요약, 내보내기, 추세 분석을 필요할 때 실행",
      ],
    },
    assets: {
      tagline:
        "AI 에이전트가 브랜드에 맞는 에셋을 함께 만들고 다듬고 정리합니다.",
      features: [
        "로고, 제품 사진, 동영상, 레퍼런스로 재사용 가능한 에셋 라이브러리 구축",
        "프롬프트로 히어로 이미지, 다이어그램, 슬라이드 아트, 제품 비주얼, 동영상 생성",
        "모든 실행에서 프롬프트, 레퍼런스, 결과물, 개선 과정 감사",
      ],
    },
    mail: {
      tagline: "AI 에이전트가 이메일을 읽고 작성하고 함께 정리합니다.",
      features: [
        "내 말투와 스타일에 맞는 답장",
        "하나의 통합 받은편지함에서 여러 Gmail 계정 관리",
        "분류, 보관, 후속 조치 자동화",
      ],
    },
    slides: {
      tagline: "AI 에이전트가 프레젠테이션을 함께 만들고 편집하고 다듬습니다.",
      features: [
        "한 번의 프롬프트로 전체 덱 생성",
        "발표하거나 검토하면서 슬라이드를 정밀하게 편집",
        "나와 에이전트 간 실시간 협업",
      ],
    },
    chat: {
      tagline:
        "채팅 중심의 agent-native 앱에서 시작해 에이전트가 성장함에 따라 액션, 화면, 워크플로를 추가하세요.",
      features: [
        "영구 스레드와 도구 호출 기록을 지원하는 전체 화면 채팅",
        "액션을 한 번 추가하고 채팅, UI, HTTP, MCP, A2A, CLI에서 사용",
        "자체 에이전트 런타임을 연결하거나 포함된 app-agent 루프를 기반으로 구축",
      ],
    },
    crm: {
      tagline:
        "완전한 Native SQL CRM 또는 소스 시스템을 기반으로 연결된 동반 앱입니다.",
      features: [
        "Native SQL에서 계정, 사람, 영업 기회, 작업, 케이던스 관리",
        "자격 증명을 복사하지 않고 범위가 제한된 HubSpot 또는 Salesforce 레코드 연결",
        "UI나 CRM 에이전트에서 동일한 안전한 액션 사용",
      ],
    },
    factory: {
      tagline:
        "에이전트 팩토리를 구축하세요. 한쪽으로 작업이 들어오고 다른 쪽으로 배포된 변경이 나오며 게이트는 직접 제어합니다.",
      features: [
        "하나의 큐에서 Slack과 풀 리퀘스트 신호 확인",
        "프롬프트와 검토 가능한 피드백으로 규칙 조정",
        "지속적인 감사 기록과 함께 범위가 제한된 에이전트 작업 승인",
      ],
    },
    tasks: {
      tagline:
        "개인 작업을 관리하세요. 받은편지함에서 분류하고 목록에서 완료하며 에이전트가 모두 대신하게 할 수 있습니다.",
      features: [
        "받은편지함 분류: 아이디어와 초안을 기록하고 준비되면 작업으로 전환",
        "작업 관리: 설정한 순서를 유지하는 목록에서 작업 생성, 재정렬, 완료",
        "사용자 지정 필드(텍스트, 숫자, 통화, 날짜, 색상 선택)로 중요한 항목 추적",
        "여기서 할 수 있는 모든 일을 에이전트도 할 수 있습니다. 화면을 보므로 ‘이것들을 완료’는 실제 선택한 행을 뜻합니다",
      ],
    },
  },
  "pt-BR": {
    analytics: {
      tagline:
        "Seu agente de IA consulta suas fontes de dados, cria painéis e responde perguntas de negócio com você.",
      features: [
        "Faça perguntas e obtenha respostas do BigQuery, HubSpot, Jira e muito mais",
        "Painéis criados pelo agente com dados atualizados de todas as suas fontes",
        "Análises salvas que o agente pode executar novamente sob demanda com números novos",
      ],
    },
    brain: {
      tagline:
        "Uma camada de conhecimento da empresa onde conversas brutas se tornam conhecimento institucional revisado e pesquisável.",
      features: [
        "Importe transcrições, notas, exportações do Slack e resumos do Granola",
        "Valide cada fato com citações exatas da fonte",
        "Revise o conhecimento de toda a empresa por meio de fluxos de propostas",
      ],
    },
    calendar: {
      tagline:
        "Seu agente de IA agenda, remarca e gerencia seu calendário para que você não precise fazer isso.",
      features: [
        "Encontre horários livres e marque reuniões por você",
        "Gerencie disponibilidade e links de reserva automaticamente",
        "Responda perguntas sobre a agenda e resolva conflitos na hora",
      ],
    },
    clips: {
      tagline:
        "Seu agente de IA transcreve, resume e pesquisa tudo o que você grava ao seu lado.",
      features: [
        "Gravação de tela com um clique (estilo Loom), títulos, resumos e capítulos automáticos",
        "Notas de reunião sincronizadas ao calendário (estilo Granola), com transcrições ao vivo e itens de ação de IA",
        "Ditado de voz com a tecla Fn (estilo Wisprflow): segure em qualquer lugar e receba texto limpo",
        "Uma biblioteca pesquisável de gravações, reuniões e ditados",
      ],
    },
    content: {
      tagline:
        "Obsidian de código aberto para MDX: seu agente de IA edita documentos locais, cria blocos personalizados e organiza tudo com você.",
      features: [
        "Edite arquivos Markdown/MDX locais diretamente e use sincronização hospedada quando precisar",
        "Gere blocos MDX personalizados e interativos e edite suas propriedades visualmente",
        "Pesquise, resuma, faça referências cruzadas e reorganize árvores de documentos instantaneamente",
      ],
    },
    plan: {
      tagline:
        "Transforme os planos do seu agente de código em HTML visual e anotável antes de alterar o código.",
      features: [
        "Crie diagramas, wireframes, mockups e opções de protótipo com um único prompt",
        "Anote planos em uma superfície visual de revisão em vez de ler Markdown longo",
        "Compartilhe links de revisão vinculados à conta quando precisar de feedback externo",
      ],
    },
    design: {
      tagline:
        "Crie designs e protótipos descrevendo o que deseja. O agente de IA transforma suas ideias em designs interativos e responsivos em segundos.",
      features: [
        "Crie protótipos refinados apenas descrevendo o que quer",
        "Construa e aplique sistemas de design para manter tudo alinhado à marca",
        "Exporte seu trabalho ou compartilhe com um link",
      ],
    },
    dispatch: {
      tagline:
        "Seu agente de IA gerencia segredos, coordena outros agentes e encaminha mensagens no seu workspace.",
      features: [
        "Cofre centralizado para segredos com permissões detalhadas por app",
        "Orquestração entre agentes e delegação para apps especializados",
        "Roteamento de Slack e Telegram com fluxos de aprovação",
      ],
    },
    forms: {
      tagline:
        "Seu agente de IA cria, publica e analisa formulários junto com você.",
      features: [
        "Crie formulários completos a partir de uma única frase",
        "Publicação instantânea com links compartilháveis e captcha",
        "Resumos de respostas, exportações e análise de tendências sob demanda",
      ],
    },
    assets: {
      tagline:
        "Seu agente de IA cria, aprimora e organiza ativos alinhados à sua marca junto com você.",
      features: [
        "Crie bibliotecas reutilizáveis de logotipos, fotos de produtos, vídeos e referências",
        "Gere imagens principais, diagramas, arte para slides, visuais de produtos e vídeos a partir de um prompt",
        "Audite prompts, referências, resultados e melhorias em cada execução",
      ],
    },
    mail: {
      tagline:
        "Seu agente de IA lê, redige e organiza seus e-mails junto com você.",
      features: [
        "Respostas que combinam com seu tom e estilo",
        "Várias contas do Gmail em uma única caixa de entrada",
        "Triagem, arquivamento e acompanhamentos automáticos",
      ],
    },
    slides: {
      tagline:
        "Seu agente de IA cria, edita e aprimora apresentações junto com você.",
      features: [
        "Gere apresentações completas com um único prompt",
        "Edite slides com precisão enquanto apresenta ou revisa",
        "Colaboração em tempo real entre você e o agente",
      ],
    },
    chat: {
      tagline:
        "Comece com um app agent-native focado em chat e adicione ações, telas e fluxos à medida que seu agente cresce.",
      features: [
        "Chat em tela cheia com threads persistentes e histórico de chamadas de ferramentas",
        "Adicione ações uma vez e use-as no chat, na UI, em HTTP, MCP, A2A e CLI",
        "Conecte seu próprio runtime de agente ou use o loop app-agent incluído",
      ],
    },
    crm: {
      tagline:
        "Um CRM Native SQL completo ou um companheiro conectado baseado no sistema de origem.",
      features: [
        "Gerencie contas, pessoas, oportunidades, tarefas e cadência no Native SQL",
        "Conecte registros delimitados do HubSpot ou Salesforce sem copiar credenciais",
        "Use as mesmas ações seguras na UI ou no seu agente de CRM",
      ],
    },
    factory: {
      tagline:
        "Construa fábricas de agentes: o trabalho entra de um lado, as mudanças entregues saem do outro, com controles definidos por você.",
      features: [
        "Inspecione sinais do Slack e pull requests em uma única fila",
        "Ajuste regras com prompts e feedback revisável",
        "Aprove trabalho limitado do agente com uma trilha de auditoria durável",
      ],
    },
    tasks: {
      tagline:
        "Gerencie suas tarefas pessoais: faça a triagem na caixa de entrada e conclua pela lista. Um agente pode fazer tudo por você.",
      features: [
        "Triagem da caixa de entrada: capture ideias e rascunhos e transforme-os em tarefas quando estiverem prontos",
        "Gestão de tarefas: crie, reordene e conclua tarefas em uma lista que mantém sua ordem",
        "Acompanhe o que importa com campos personalizados: texto, números, moeda, datas e seletores coloridos",
        "Tudo o que você faz aqui também pode ser feito pelo agente; ele vê sua tela, então “conclua estas” significa as linhas selecionadas",
      ],
    },
  },
  "hi-IN": {
    analytics: {
      tagline:
        "आपका AI एजेंट डेटा स्रोतों से जानकारी लेकर डैशबोर्ड बनाता है और आपके साथ व्यावसायिक सवालों के जवाब देता है।",
      features: [
        "BigQuery, HubSpot, Jira और अन्य स्रोतों से सवाल पूछकर जवाब पाएं",
        "आपके सभी स्रोतों से लाइव डेटा लेने वाले एजेंट-निर्मित डैशबोर्ड",
        "सहेजे गए विश्लेषण जिन्हें एजेंट नए आंकड़ों के साथ फिर चला सकता है",
      ],
    },
    brain: {
      tagline:
        "कंपनी की एक नॉलेज लेयर, जहां कच्ची बातचीत समीक्षा की गई और खोजने योग्य संस्थागत जानकारी बन जाती है।",
      features: [
        "ट्रांसक्रिप्ट, नोट्स, Slack एक्सपोर्ट और Granola सारांश आयात करें",
        "सटीक स्रोत उद्धरणों से हर तथ्य की पुष्टि करें",
        "प्रस्ताव वर्कफ़्लो के जरिए पूरी कंपनी की जानकारी की समीक्षा करें",
      ],
    },
    calendar: {
      tagline:
        "आपका AI एजेंट आपका कैलेंडर शेड्यूल, रीशेड्यूल और मैनेज करता है, ताकि आपको यह सब न करना पड़े।",
      features: [
        "खाली समय खोजकर आपकी ओर से मीटिंग बुक करें",
        "उपलब्धता और बुकिंग लिंक अपने आप मैनेज करें",
        "शेड्यूल से जुड़े सवालों के जवाब दें और टकराव तुरंत सुलझाएं",
      ],
    },
    clips: {
      tagline:
        "आपका AI एजेंट आपके रिकॉर्ड किए हुए हर कंटेंट को ट्रांसक्राइब, सारांशित और खोजता है।",
      features: [
        "एक-क्लिक स्क्रीन रिकॉर्डिंग (Loom शैली), ऑटो शीर्षक, सारांश और अध्याय",
        "कैलेंडर-सिंक मीटिंग नोट्स (Granola शैली), लाइव ट्रांसक्रिप्ट और AI एक्शन आइटम",
        "Fn दबाकर कहीं भी वॉइस डिक्टेशन (Wisprflow शैली), साफ टेक्स्ट पाएं",
        "रिकॉर्डिंग, मीटिंग और डिक्टेशन के लिए एक खोजने योग्य लाइब्रेरी",
      ],
    },
    content: {
      tagline:
        "MDX के लिए ओपन-सोर्स Obsidian: आपका AI एजेंट स्थानीय दस्तावेज़ संपादित करता है, कस्टम ब्लॉक बनाता है और सब कुछ व्यवस्थित करता है।",
      features: [
        "स्थानीय Markdown/MDX फ़ाइलें सीधे संपादित करें और जरूरत पर होस्टेड सिंक इस्तेमाल करें",
        "रिच इंटरैक्टिव कस्टम MDX ब्लॉक बनाएं और उनकी प्रॉपर्टी दृश्य रूप से संपादित करें",
        "दस्तावेज़ ट्री को तुरंत खोजें, सारांशित करें, क्रॉस-रेफरेंस और पुनर्गठित करें",
      ],
    },
    plan: {
      tagline:
        "कोड बदलने से पहले अपने कोडिंग एजेंट की योजनाओं को दृश्य और टिप्पणी योग्य HTML में बदलें।",
      features: [
        "एक प्रॉम्प्ट से डायग्राम, वायरफ्रेम, मॉकअप और प्रोटोटाइप विकल्प बनाएं",
        "लंबे Markdown को पढ़ने के बजाय दृश्य समीक्षा सतह पर योजनाओं पर टिप्पणी करें",
        "बाहरी प्रतिक्रिया चाहिए तो अकाउंट-आधारित समीक्षा लिंक साझा करें",
      ],
    },
    design: {
      tagline:
        "जो चाहिए उसका वर्णन करके डिज़ाइन और प्रोटोटाइप बनाएं। AI एजेंट सेकंडों में आपकी कल्पना को इंटरैक्टिव, रिस्पॉन्सिव डिज़ाइन में बदलता है।",
      features: [
        "सिर्फ वर्णन करके शानदार प्रोटोटाइप बनाएं",
        "डिज़ाइन सिस्टम बनाकर लागू करें और ब्रांड की एकरूपता बनाए रखें",
        "अपना काम एक्सपोर्ट करें या लिंक से साझा करें",
      ],
    },
    dispatch: {
      tagline:
        "आपका AI एजेंट सीक्रेट्स मैनेज करता है, दूसरे एजेंट्स को ऑर्केस्ट्रेट करता है और वर्कस्पेस में संदेश रूट करता है।",
      features: [
        "हर ऐप के लिए बारीक अनुमतियों वाला केंद्रीकृत सीक्रेट वॉल्ट",
        "एजेंट्स के बीच ऑर्केस्ट्रेशन और विशेषज्ञ ऐप्स को काम सौंपना",
        "अप्रूवल वर्कफ़्लो के साथ Slack और Telegram रूटिंग",
      ],
    },
    forms: {
      tagline:
        "आपका AI एजेंट आपके साथ फ़ॉर्म बनाता, प्रकाशित करता और उनका विश्लेषण करता है।",
      features: [
        "एक वाक्य से पूरे फ़ॉर्म बनाएं",
        "शेयर करने योग्य लिंक और captcha के साथ तुरंत प्रकाशित करें",
        "ज़रूरत पड़ने पर प्रतिक्रिया सारांश, exports और trend analysis पाएं",
      ],
    },
    assets: {
      tagline:
        "आपका AI एजेंट आपके साथ ब्रांड-अनुकूल एसेट बनाता, सुधारता और व्यवस्थित करता है।",
      features: [
        "लोगो, उत्पाद चित्र, वीडियो और संदर्भों से दोबारा इस्तेमाल योग्य एसेट लाइब्रेरी बनाएं",
        "प्रॉम्प्ट से हीरो इमेज, डायग्राम, स्लाइड आर्ट, उत्पाद विज़ुअल और वीडियो बनाएं",
        "हर रन में प्रॉम्प्ट, संदर्भ, आउटपुट और सुधारों का ऑडिट करें",
      ],
    },
    mail: {
      tagline: "आपका AI एजेंट आपके साथ ईमेल पढ़ता, ड्राफ्ट करता और व्यवस्थित करता है।",
      features: [
        "आपके टोन और शैली से मेल खाते जवाब",
        "एक यूनिफाइड इनबॉक्स में कई Gmail अकाउंट",
        "ट्रायेज, आर्काइविंग और फॉलो-अप अपने आप",
      ],
    },
    slides: {
      tagline: "आपका AI एजेंट आपके साथ प्रेज़ेंटेशन बनाता, संपादित करता और बेहतर करता है।",
      features: [
        "एक प्रॉम्प्ट से पूरा डेक बनाएं",
        "प्रस्तुत करते या समीक्षा करते समय स्लाइड में सटीक बदलाव करें",
        "आप और एजेंट के बीच रियल-टाइम सहयोग",
      ],
    },
    chat: {
      tagline:
        "चैट-केंद्रित agent-native ऐप से शुरू करें और एजेंट के बढ़ने के साथ एक्शन, स्क्रीन और वर्कफ़्लो जोड़ें।",
      features: [
        "स्थायी थ्रेड और टूल कॉल इतिहास वाला फुल-पेज चैट",
        "एक्शन एक बार जोड़ें और चैट, UI, HTTP, MCP, A2A और CLI से इस्तेमाल करें",
        "अपना एजेंट रनटाइम जोड़ें या शामिल app-agent लूप पर बनाएं",
      ],
    },
    crm: {
      tagline:
        "एक पूरा Native SQL CRM या अपने स्रोत सिस्टम पर आधारित कनेक्टेड साथी ऐप।",
      features: [
        "Native SQL में अकाउंट, लोग, अवसर, कार्य और कैडेंस चलाएं",
        "क्रेडेंशियल कॉपी किए बिना सीमित HubSpot या Salesforce रिकॉर्ड कनेक्ट करें",
        "UI या अपने CRM एजेंट से वही सुरक्षित एक्शन इस्तेमाल करें",
      ],
    },
    factory: {
      tagline:
        "एजेंट फैक्ट्री बनाएं: एक तरफ काम आए, दूसरी तरफ डिलीवर किए गए बदलाव निकलें, और गेट्स आपके नियंत्रण में रहें।",
      features: [
        "Slack और पुल रिक्वेस्ट संकेतों को एक कतार में देखें",
        "प्रॉम्प्ट और समीक्षा योग्य फ़ीडबैक से नियमों को बेहतर करें",
        "टिकाऊ ऑडिट ट्रेल के साथ सीमित एजेंट काम को मंज़ूर करें",
      ],
    },
    tasks: {
      tagline:
        "अपने निजी टास्क मैनेज करें: इनबॉक्स में ट्रायेज करें, सूची से पूरा करें। एजेंट यह सब आपके लिए कर सकता है।",
      features: [
        "इनबॉक्स ट्रायेज: विचार और ड्राफ्ट दर्ज करें और तैयार होने पर उन्हें टास्क में बदलें",
        "टास्क मैनेजमेंट: अपनी तय क्रम वाली सूची में टास्क बनाएं, फिर से क्रम दें और पूरा करें",
        "कस्टम फ़ील्ड (टेक्स्ट, संख्या, मुद्रा, तारीख और रंगीन चयन) से महत्वपूर्ण चीज़ें ट्रैक करें",
        "यहां आप जो कर सकते हैं एजेंट भी कर सकता है; वह स्क्रीन देखता है, इसलिए “इन्हें पूरा करो” चुनी हुई पंक्तियों को दर्शाता है",
      ],
    },
  },
  "ar-SA": {
    analytics: {
      tagline:
        "يستعلم وكيل الذكاء الاصطناعي عن مصادر بياناتك، وينشئ لوحات معلومات، ويجيب عن أسئلة العمل معك.",
      features: [
        "اطرح أي سؤال واحصل على إجابات من BigQuery وHubSpot وJira وغيرها",
        "لوحات معلومات ينشئها الوكيل وتستمد بيانات مباشرة من جميع مصادرك",
        "تحليلات محفوظة يمكن للوكيل إعادة تشغيلها عند الطلب بأرقام حديثة",
      ],
    },
    brain: {
      tagline:
        "طبقة معرفة للشركة تحول المحادثات الخام إلى معرفة مؤسسية مُراجعة وقابلة للبحث.",
      features: [
        "استورد النصوص المفرغة والملاحظات وتصديرات Slack وملخصات Granola",
        "تحقق من كل حقيقة بالاستناد إلى اقتباسات المصدر الدقيقة",
        "راجع معرفة الشركة بأكملها من خلال مسارات عمل المقترحات",
      ],
    },
    calendar: {
      tagline:
        "يجدول وكيل الذكاء الاصطناعي تقويمك ويعيد جدولتِه ويديره، حتى لا تضطر إلى ذلك.",
      features: [
        "اعثر على الأوقات المتاحة واحجز الاجتماعات نيابة عنك",
        "أدر التوفر وروابط الحجز تلقائيًا",
        "أجب عن أسئلة الجدول وحل التعارضات فورًا",
      ],
    },
    clips: {
      tagline:
        "ينسخ وكيل الذكاء الاصطناعي كل ما تسجله ويلخصه ويبحث فيه إلى جانبك.",
      features: [
        "تسجيل الشاشة بنقرة واحدة (بأسلوب Loom) مع عناوين وملخصات وفصول تلقائية",
        "ملاحظات اجتماعات متزامنة مع التقويم (بأسلوب Granola) مع نصوص مباشرة وعناصر عمل من الذكاء الاصطناعي",
        "إملاء صوتي بالضغط على Fn (بأسلوب Wisprflow): اضغط في أي مكان واحصل على نص نظيف",
        "مكتبة واحدة قابلة للبحث عبر التسجيلات والاجتماعات والإملاءات",
      ],
    },
    content: {
      tagline:
        "Obsidian مفتوح المصدر لـ MDX: يحرر وكيل الذكاء الاصطناعي مستنداتك المحلية، وينشئ كتلًا مخصصة، وينظم كل شيء معك.",
      features: [
        "حرر ملفات Markdown/MDX المحلية مباشرة واستخدم المزامنة المستضافة عند الحاجة",
        "أنشئ كتل MDX مخصصة وتفاعلية وحرر خصائصها بصريًا",
        "ابحث عن أشجار المستندات ولخصها واربطها وأعد تنظيمها فورًا",
      ],
    },
    plan: {
      tagline:
        "حوّل خطط وكيل البرمجة إلى HTML مرئي وقابل للتعليق قبل تغيير الكود.",
      features: [
        "أنشئ مخططات وإطارات سلكية ونماذج وخيارات نماذج أولية من مطالبة واحدة",
        "أضف تعليقات إلى الخطط على سطح مراجعة مرئي بدلًا من قراءة Markdown طويل",
        "شارك روابط مراجعة مرتبطة بالحساب عندما تحتاج إلى ملاحظات خارجية",
      ],
    },
    design: {
      tagline:
        "صمم وأنشئ نماذج أولية بوصف ما تريده. يحول وكيل الذكاء الاصطناعي أفكارك إلى تصميمات تفاعلية ومتجاوبة خلال ثوانٍ.",
      features: [
        "أنشئ نماذج أولية متقنة بمجرد وصفها",
        "أنشئ أنظمة تصميم وطبقها للحفاظ على اتساق العلامة التجارية",
        "صدّر عملك أو شاركه عبر رابط",
      ],
    },
    dispatch: {
      tagline:
        "يدير وكيل الذكاء الاصطناعي الأسرار، وينسق الوكلاء الآخرين، ويوجه الرسائل في مساحة عملك.",
      features: [
        "خزنة مركزية للأسرار مع منح صلاحيات دقيقة لكل تطبيق",
        "تنسيق بين الوكلاء وتفويض إلى تطبيقات متخصصة",
        "توجيه Slack وTelegram مع مسارات عمل للموافقة",
      ],
    },
    forms: {
      tagline: "يساعدك وكيل الذكاء الاصطناعي على إنشاء النماذج ونشرها وتحليلها.",
      features: [
        "أنشئ نماذج كاملة من جملة واحدة",
        "نشر فوري مع روابط قابلة للمشاركة وcaptcha",
        "ملخصات للإجابات وتصدير وتحليل اتجاهات عند الطلب",
      ],
    },
    assets: {
      tagline:
        "ينشئ وكيل الذكاء الاصطناعي الأصول المتوافقة مع علامتك التجارية ويحسنها وينظمها معك.",
      features: [
        "أنشئ مكتبات أصول قابلة لإعادة الاستخدام من الشعارات وصور المنتجات والفيديوهات والمراجع",
        "أنشئ صورًا رئيسية ومخططات ورسومات للشرائح ومرئيات للمنتجات وفيديوهات من مطالبة",
        "دقق المطالبات والمراجع والمخرجات والتحسينات في كل تشغيل",
      ],
    },
    mail: {
      tagline:
        "يقرأ وكيل الذكاء الاصطناعي بريدك الإلكتروني ويصوغ الرسائل وينظمها معك.",
      features: [
        "ردود تطابق نبرتك وأسلوبك",
        "حسابات Gmail متعددة في صندوق وارد موحد واحد",
        "فرز وأرشفة ومتابعات تلقائية",
      ],
    },
    slides: {
      tagline:
        "ينشئ وكيل الذكاء الاصطناعي العروض التقديمية ويحررها ويحسنها معك.",
      features: [
        "أنشئ عروضًا كاملة من مطالبة واحدة",
        "حرر الشرائح بدقة أثناء العرض أو المراجعة",
        "تعاون في الوقت الفعلي بينك وبين الوكيل",
      ],
    },
    chat: {
      tagline:
        "ابدأ بتطبيق agent-native يركز على الدردشة وأضف الإجراءات والشاشات ومسارات العمل مع نمو وكيلك.",
      features: [
        "دردشة بملء الصفحة مع سلاسل محادثة دائمة وسجل استدعاءات الأدوات",
        "أضف الإجراءات مرة واحدة واستخدمها من الدردشة وواجهة المستخدم وHTTP وMCP وA2A وCLI",
        "صل بيئة تشغيل وكيلك أو ابنِ على حلقة app-agent المضمنة",
      ],
    },
    crm: {
      tagline:
        "نظام CRM كامل على Native SQL أو تطبيق مرافق متصل يستند إلى نظامه المصدر.",
      features: [
        "أدر الحسابات والأشخاص والفرص والمهام والإيقاع على Native SQL",
        "صل سجلات HubSpot أو Salesforce محددة النطاق دون نسخ بيانات الاعتماد",
        "استخدم الإجراءات الآمنة نفسها من واجهة المستخدم أو وكيل CRM الخاص بك",
      ],
    },
    factory: {
      tagline:
        "ابنِ مصانع للوكلاء: يدخل العمل من جهة وتخرج التغييرات المشحونة من الجهة الأخرى، مع بوابات تتحكم بها.",
      features: [
        "افحص إشارات Slack وطلبات السحب في قائمة انتظار واحدة",
        "اضبط القواعد بالمطالبات والتعليقات القابلة للمراجعة",
        "وافق على عمل الوكيل المحدود مع سجل تدقيق دائم",
      ],
    },
    tasks: {
      tagline:
        "أدر مهامك الشخصية: فرزها في صندوق الوارد وأنجزها من القائمة. يمكن لوكيل أن يفعل كل ذلك نيابة عنك.",
      features: [
        "فرز صندوق الوارد: التقط الأفكار والمسودات ثم حولها إلى مهام عندما تصبح جاهزة",
        "إدارة المهام: أنشئ المهام وأعد ترتيبها وأنجزها في قائمة تحافظ على ترتيبك",
        "تابع ما يهمك باستخدام حقول مخصصة: نص وأرقام وعملة وتواريخ واختيارات ملونة",
        "كل ما يمكنك فعله هنا يستطيع الوكيل فعله أيضًا؛ فهو يرى شاشتك، لذا تعني «أنجز هذه» الصفوف التي حددتها فعلًا",
      ],
    },
  },
};
