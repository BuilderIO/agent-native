import type { LocaleCode } from "./shared.js";

export interface McpConnectMessages {
  pageTitle: string;
  authorizeLabel: string;
  terminalTitle: string;
  assistantTitle: string;
  signedInAs: string;
  deviceCode: string;
  guidesLabel: string;
  advancedOptions: string;
  labelOptional: string;
  labelPlaceholder: string;
  expiresInDays: string;
  terminalAlternative: string;
  existingConnections: string;
  checkingConnections: string;
  unavailable: string;
  couldNotLoadConnections: string;
  emptyConnections: string;
  unlabeled: string;
  lastUsed: string;
  revoked: string;
  created: string;
  revoke: string;
  couldNotRevoke: string;
  authorizeDevice: string;
  createToken: string;
  authorizingDevice: string;
  creatingToken: string;
  couldNotAuthorize: string;
  finishingConnection: string;
  deviceAuthorized: string;
  connected: string;
  connectedDescription: string;
  couldNotCreate: string;
  networkError: string;
  urlTitle: string;
}

export const MCP_CONNECT_MESSAGES: Record<LocaleCode, McpConnectMessages> = {
  "en-US": {
    pageTitle: "Connect {appName}",
    authorizeLabel: "Authorize {appName}",
    terminalTitle: "Authorize {appName} from your terminal?",
    assistantTitle: "Use {appName} from your AI assistant",
    signedInAs: "Signed in as",
    deviceCode: "Device code",
    guidesLabel: "MCP URL guides",
    advancedOptions: "Advanced options",
    labelOptional: "Label (optional)",
    labelPlaceholder: "e.g. Claude Code on my laptop",
    expiresInDays: "Expires in (days, 1–365)",
    terminalAlternative: "Terminal alternative",
    existingConnections: "Existing connections",
    checkingConnections: "Checking connections...",
    unavailable: "Unavailable",
    couldNotLoadConnections: "Could not load connections.",
    emptyConnections:
      "Created connections will appear here for revoking later.",
    unlabeled: "(unlabeled)",
    lastUsed: "last used",
    revoked: "Revoked",
    created: "Created",
    revoke: "Revoke",
    couldNotRevoke: "Could not revoke token.",
    authorizeDevice: "Authorize device",
    createToken: "Create connection token",
    authorizingDevice: "Authorizing device...",
    creatingToken: "Creating token...",
    couldNotAuthorize: "Could not authorize this device code.",
    finishingConnection:
      "Finishing connection… you can return to your terminal.",
    deviceAuthorized: "Device authorized",
    connected: "Connected",
    connectedDescription:
      "This device can now act as you — manage or revoke it below.",
    couldNotCreate: "Could not create token.",
    networkError: "Network error. Please try again.",
    urlTitle: "Your MCP URL",
  },
  "es-ES": {
    pageTitle: "Conectar {appName}",
    authorizeLabel: "Autorizar {appName}",
    terminalTitle: "¿Autorizar {appName} desde tu terminal?",
    assistantTitle: "Usa {appName} desde tu asistente de IA",
    signedInAs: "Sesión iniciada como",
    deviceCode: "Código del dispositivo",
    guidesLabel: "Guías de URL de MCP",
    advancedOptions: "Opciones avanzadas",
    labelOptional: "Etiqueta (opcional)",
    labelPlaceholder: "p. ej., Claude Code en mi portátil",
    expiresInDays: "Caduca en (días, 1–365)",
    terminalAlternative: "Alternativa para la terminal",
    existingConnections: "Conexiones existentes",
    checkingConnections: "Comprobando conexiones...",
    unavailable: "No disponible",
    couldNotLoadConnections: "No se pudieron cargar las conexiones.",
    emptyConnections:
      "Las conexiones creadas aparecerán aquí para revocarlas más adelante.",
    unlabeled: "(sin etiqueta)",
    lastUsed: "último uso",
    revoked: "Revocado",
    created: "Creado",
    revoke: "Revocar",
    couldNotRevoke: "No se pudo revocar el token.",
    authorizeDevice: "Autorizar dispositivo",
    createToken: "Crear token de conexión",
    authorizingDevice: "Autorizando dispositivo...",
    creatingToken: "Creando token...",
    couldNotAuthorize: "No se pudo autorizar este código de dispositivo.",
    finishingConnection: "Terminando la conexión… puedes volver a tu terminal.",
    deviceAuthorized: "Dispositivo autorizado",
    connected: "Conectado",
    connectedDescription:
      "Este dispositivo ya puede actuar como tú; puedes administrarlo o revocarlo abajo.",
    couldNotCreate: "No se pudo crear el token.",
    networkError: "Error de red. Inténtalo de nuevo.",
    urlTitle: "Tu URL de MCP",
  },
  "fr-FR": {
    pageTitle: "Connecter {appName}",
    authorizeLabel: "Autoriser {appName}",
    terminalTitle: "Autoriser {appName} depuis votre terminal ?",
    assistantTitle: "Utiliser {appName} depuis votre assistant IA",
    signedInAs: "Connecté en tant que",
    deviceCode: "Code de l’appareil",
    guidesLabel: "Guides d’URL MCP",
    advancedOptions: "Options avancées",
    labelOptional: "Libellé (facultatif)",
    labelPlaceholder: "ex. Claude Code sur mon ordinateur portable",
    expiresInDays: "Expire dans (jours, 1–365)",
    terminalAlternative: "Alternative terminal",
    existingConnections: "Connexions existantes",
    checkingConnections: "Vérification des connexions...",
    unavailable: "Indisponible",
    couldNotLoadConnections: "Impossible de charger les connexions.",
    emptyConnections:
      "Les connexions créées apparaîtront ici pour être révoquées plus tard.",
    unlabeled: "(sans libellé)",
    lastUsed: "dernière utilisation",
    revoked: "Révoqué",
    created: "Créé",
    revoke: "Révoquer",
    couldNotRevoke: "Impossible de révoquer le jeton.",
    authorizeDevice: "Autoriser l’appareil",
    createToken: "Créer un jeton de connexion",
    authorizingDevice: "Autorisation de l’appareil...",
    creatingToken: "Création du jeton...",
    couldNotAuthorize: "Impossible d’autoriser ce code d’appareil.",
    finishingConnection:
      "Connexion en cours… vous pouvez retourner à votre terminal.",
    deviceAuthorized: "Appareil autorisé",
    connected: "Connecté",
    connectedDescription:
      "Cet appareil peut maintenant agir en votre nom. Gérez-le ou révoquez-le ci-dessous.",
    couldNotCreate: "Impossible de créer le jeton.",
    networkError: "Erreur réseau. Réessayez.",
    urlTitle: "Votre URL MCP",
  },
  "de-DE": {
    pageTitle: "{appName} verbinden",
    authorizeLabel: "{appName} autorisieren",
    terminalTitle: "{appName} über dein Terminal autorisieren?",
    assistantTitle: "{appName} mit deinem KI-Assistenten verwenden",
    signedInAs: "Angemeldet als",
    deviceCode: "Gerätecode",
    guidesLabel: "MCP-URL-Anleitungen",
    advancedOptions: "Erweiterte Optionen",
    labelOptional: "Bezeichnung (optional)",
    labelPlaceholder: "z. B. Claude Code auf meinem Laptop",
    expiresInDays: "Läuft ab in (Tagen, 1–365)",
    terminalAlternative: "Terminal-Alternative",
    existingConnections: "Vorhandene Verbindungen",
    checkingConnections: "Verbindungen werden geprüft...",
    unavailable: "Nicht verfügbar",
    couldNotLoadConnections: "Verbindungen konnten nicht geladen werden.",
    emptyConnections:
      "Erstellte Verbindungen werden hier angezeigt, damit du sie später widerrufen kannst.",
    unlabeled: "(ohne Bezeichnung)",
    lastUsed: "zuletzt verwendet",
    revoked: "Widerrufen",
    created: "Erstellt",
    revoke: "Widerrufen",
    couldNotRevoke: "Token konnte nicht widerrufen werden.",
    authorizeDevice: "Gerät autorisieren",
    createToken: "Verbindungstoken erstellen",
    authorizingDevice: "Gerät wird autorisiert...",
    creatingToken: "Token wird erstellt...",
    couldNotAuthorize: "Dieser Gerätecode konnte nicht autorisiert werden.",
    finishingConnection:
      "Verbindung wird abgeschlossen… du kannst zu deinem Terminal zurückkehren.",
    deviceAuthorized: "Gerät autorisiert",
    connected: "Verbunden",
    connectedDescription:
      "Dieses Gerät kann jetzt in deinem Namen handeln. Verwalte oder widerrufe es unten.",
    couldNotCreate: "Token konnte nicht erstellt werden.",
    networkError: "Netzwerkfehler. Bitte versuche es erneut.",
    urlTitle: "Deine MCP-URL",
  },
  "pt-BR": {
    pageTitle: "Conectar {appName}",
    authorizeLabel: "Autorizar {appName}",
    terminalTitle: "Autorizar {appName} pelo seu terminal?",
    assistantTitle: "Usar {appName} pelo seu assistente de IA",
    signedInAs: "Sessão iniciada como",
    deviceCode: "Código do dispositivo",
    guidesLabel: "Guias de URL MCP",
    advancedOptions: "Opções avançadas",
    labelOptional: "Rótulo (opcional)",
    labelPlaceholder: "ex.: Claude Code no meu laptop",
    expiresInDays: "Expira em (dias, 1–365)",
    terminalAlternative: "Alternativa pelo terminal",
    existingConnections: "Conexões existentes",
    checkingConnections: "Verificando conexões...",
    unavailable: "Indisponível",
    couldNotLoadConnections: "Não foi possível carregar as conexões.",
    emptyConnections:
      "As conexões criadas aparecerão aqui para revogação posterior.",
    unlabeled: "(sem rótulo)",
    lastUsed: "último uso",
    revoked: "Revogado",
    created: "Criado",
    revoke: "Revogar",
    couldNotRevoke: "Não foi possível revogar o token.",
    authorizeDevice: "Autorizar dispositivo",
    createToken: "Criar token de conexão",
    authorizingDevice: "Autorizando dispositivo...",
    creatingToken: "Criando token...",
    couldNotAuthorize: "Não foi possível autorizar este código de dispositivo.",
    finishingConnection:
      "Concluindo a conexão… você pode voltar ao seu terminal.",
    deviceAuthorized: "Dispositivo autorizado",
    connected: "Conectado",
    connectedDescription:
      "Este dispositivo agora pode agir por você. Gerencie ou revogue-o abaixo.",
    couldNotCreate: "Não foi possível criar o token.",
    networkError: "Erro de rede. Tente novamente.",
    urlTitle: "Sua URL MCP",
  },
  "zh-CN": {
    pageTitle: "连接 {appName}",
    authorizeLabel: "授权 {appName}",
    terminalTitle: "要从终端授权 {appName} 吗？",
    assistantTitle: "通过 AI 助手使用 {appName}",
    signedInAs: "已登录为",
    deviceCode: "设备代码",
    guidesLabel: "MCP URL 指南",
    advancedOptions: "高级选项",
    labelOptional: "标签（可选）",
    labelPlaceholder: "例如：我笔记本上的 Claude Code",
    expiresInDays: "有效期（天，1–365）",
    terminalAlternative: "终端替代方案",
    existingConnections: "现有连接",
    checkingConnections: "正在检查连接...",
    unavailable: "不可用",
    couldNotLoadConnections: "无法加载连接。",
    emptyConnections: "创建的连接会显示在这里，方便稍后撤销。",
    unlabeled: "（无标签）",
    lastUsed: "上次使用",
    revoked: "已撤销",
    created: "已创建",
    revoke: "撤销",
    couldNotRevoke: "无法撤销令牌。",
    authorizeDevice: "授权设备",
    createToken: "创建连接令牌",
    authorizingDevice: "正在授权设备...",
    creatingToken: "正在创建令牌...",
    couldNotAuthorize: "无法授权此设备代码。",
    finishingConnection: "正在完成连接…你可以返回终端。",
    deviceAuthorized: "设备已授权",
    connected: "已连接",
    connectedDescription:
      "此设备现在可以代表你操作，你可以在下方管理或撤销它。",
    couldNotCreate: "无法创建令牌。",
    networkError: "网络错误。请重试。",
    urlTitle: "你的 MCP URL",
  },
  "zh-TW": {
    pageTitle: "連線 {appName}",
    authorizeLabel: "授權 {appName}",
    terminalTitle: "要從終端機授權 {appName} 嗎？",
    assistantTitle: "透過 AI 助理使用 {appName}",
    signedInAs: "已登入為",
    deviceCode: "裝置代碼",
    guidesLabel: "MCP URL 指南",
    advancedOptions: "進階選項",
    labelOptional: "標籤（選填）",
    labelPlaceholder: "例如：我筆記型電腦上的 Claude Code",
    expiresInDays: "有效期限（天，1–365）",
    terminalAlternative: "終端機替代方案",
    existingConnections: "現有連線",
    checkingConnections: "正在檢查連線...",
    unavailable: "無法使用",
    couldNotLoadConnections: "無法載入連線。",
    emptyConnections: "建立的連線會顯示在這裡，方便稍後撤銷。",
    unlabeled: "（無標籤）",
    lastUsed: "上次使用",
    revoked: "已撤銷",
    created: "已建立",
    revoke: "撤銷",
    couldNotRevoke: "無法撤銷權杖。",
    authorizeDevice: "授權裝置",
    createToken: "建立連線權杖",
    authorizingDevice: "正在授權裝置...",
    creatingToken: "正在建立權杖...",
    couldNotAuthorize: "無法授權此裝置代碼。",
    finishingConnection: "正在完成連線…你可以返回終端機。",
    deviceAuthorized: "裝置已授權",
    connected: "已連線",
    connectedDescription:
      "此裝置現在可以代表你操作，你可以在下方管理或撤銷它。",
    couldNotCreate: "無法建立權杖。",
    networkError: "網路錯誤。請再試一次。",
    urlTitle: "你的 MCP URL",
  },
  "ja-JP": {
    pageTitle: "{appName} に接続",
    authorizeLabel: "{appName} を承認",
    terminalTitle: "ターミナルから {appName} を承認しますか？",
    assistantTitle: "AI アシスタントで {appName} を使う",
    signedInAs: "ログイン中のアカウント:",
    deviceCode: "デバイスコード",
    guidesLabel: "MCP URL ガイド",
    advancedOptions: "詳細設定",
    labelOptional: "ラベル（任意）",
    labelPlaceholder: "例: ノートパソコンの Claude Code",
    expiresInDays: "有効期限（日数、1–365）",
    terminalAlternative: "ターミナルでの代替方法",
    existingConnections: "既存の接続",
    checkingConnections: "接続を確認中...",
    unavailable: "利用できません",
    couldNotLoadConnections: "接続を読み込めませんでした。",
    emptyConnections: "作成した接続は、後で取り消せるようここに表示されます。",
    unlabeled: "（ラベルなし）",
    lastUsed: "最終使用",
    revoked: "取り消し済み",
    created: "作成済み",
    revoke: "取り消す",
    couldNotRevoke: "トークンを取り消せませんでした。",
    authorizeDevice: "デバイスを承認",
    createToken: "接続トークンを作成",
    authorizingDevice: "デバイスを承認中...",
    creatingToken: "トークンを作成中...",
    couldNotAuthorize: "このデバイスコードを承認できませんでした。",
    finishingConnection:
      "接続を完了しています…ターミナルに戻ることができます。",
    deviceAuthorized: "デバイスを承認しました",
    connected: "接続済み",
    connectedDescription:
      "このデバイスはあなたの代わりに操作できます。下で管理または取り消しができます。",
    couldNotCreate: "トークンを作成できませんでした。",
    networkError: "ネットワークエラーです。もう一度お試しください。",
    urlTitle: "MCP URL",
  },
  "ko-KR": {
    pageTitle: "{appName} 연결",
    authorizeLabel: "{appName} 승인",
    terminalTitle: "터미널에서 {appName}을(를) 승인하시겠습니까?",
    assistantTitle: "AI 도우미에서 {appName} 사용",
    signedInAs: "로그인 계정",
    deviceCode: "기기 코드",
    guidesLabel: "MCP URL 안내",
    advancedOptions: "고급 옵션",
    labelOptional: "라벨(선택사항)",
    labelPlaceholder: "예: 내 노트북의 Claude Code",
    expiresInDays: "만료 기간(일, 1–365)",
    terminalAlternative: "터미널 대안",
    existingConnections: "기존 연결",
    checkingConnections: "연결 확인 중...",
    unavailable: "사용할 수 없음",
    couldNotLoadConnections: "연결을 불러올 수 없습니다.",
    emptyConnections:
      "생성된 연결이 나중에 취소할 수 있도록 여기에 표시됩니다.",
    unlabeled: "(라벨 없음)",
    lastUsed: "마지막 사용",
    revoked: "취소됨",
    created: "생성됨",
    revoke: "취소",
    couldNotRevoke: "토큰을 취소할 수 없습니다.",
    authorizeDevice: "기기 승인",
    createToken: "연결 토큰 생성",
    authorizingDevice: "기기 승인 중...",
    creatingToken: "토큰 생성 중...",
    couldNotAuthorize: "이 기기 코드를 승인할 수 없습니다.",
    finishingConnection: "연결을 완료하는 중… 터미널로 돌아가도 됩니다.",
    deviceAuthorized: "기기 승인됨",
    connected: "연결됨",
    connectedDescription:
      "이 기기는 이제 사용자를 대신해 작업할 수 있습니다. 아래에서 관리하거나 취소하세요.",
    couldNotCreate: "토큰을 생성할 수 없습니다.",
    networkError: "네트워크 오류입니다. 다시 시도하세요.",
    urlTitle: "MCP URL",
  },
  "hi-IN": {
    pageTitle: "{appName} कनेक्ट करें",
    authorizeLabel: "{appName} को अनुमति दें",
    terminalTitle: "अपने terminal से {appName} को अनुमति दें?",
    assistantTitle: "अपने AI assistant से {appName} का उपयोग करें",
    signedInAs: "इस रूप में साइन इन",
    deviceCode: "डिवाइस कोड",
    guidesLabel: "MCP URL गाइड",
    advancedOptions: "उन्नत विकल्प",
    labelOptional: "लेबल (वैकल्पिक)",
    labelPlaceholder: "उदाहरण: मेरे laptop पर Claude Code",
    expiresInDays: "समाप्ति (दिन, 1–365)",
    terminalAlternative: "Terminal विकल्प",
    existingConnections: "मौजूदा कनेक्शन",
    checkingConnections: "कनेक्शन जाँचे जा रहे हैं...",
    unavailable: "उपलब्ध नहीं",
    couldNotLoadConnections: "कनेक्शन लोड नहीं किए जा सके।",
    emptyConnections: "बाद में revoke करने के लिए बनाए गए कनेक्शन यहाँ दिखेंगे।",
    unlabeled: "(बिना लेबल)",
    lastUsed: "अंतिम उपयोग",
    revoked: "Revoke किया गया",
    created: "बनाया गया",
    revoke: "Revoke करें",
    couldNotRevoke: "Token revoke नहीं किया जा सका।",
    authorizeDevice: "डिवाइस को अनुमति दें",
    createToken: "कनेक्शन token बनाएँ",
    authorizingDevice: "डिवाइस को अनुमति दी जा रही है...",
    creatingToken: "Token बनाया जा रहा है...",
    couldNotAuthorize: "इस डिवाइस कोड को अनुमति नहीं दी जा सकी।",
    finishingConnection: "कनेक्शन पूरा हो रहा है… आप terminal पर लौट सकते हैं।",
    deviceAuthorized: "डिवाइस को अनुमति दी गई",
    connected: "कनेक्टेड",
    connectedDescription:
      "यह डिवाइस अब आपकी ओर से काम कर सकता है। नीचे इसे manage या revoke करें।",
    couldNotCreate: "Token बनाया नहीं जा सका।",
    networkError: "Network error. फिर से कोशिश करें।",
    urlTitle: "आपका MCP URL",
  },
  "ar-SA": {
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
    createToken: "إنشاء رمز اتصال",
    authorizingDevice: "جارٍ تخويل الجهاز...",
    creatingToken: "جارٍ إنشاء الرمز...",
    couldNotAuthorize: "تعذر تخويل رمز الجهاز هذا.",
    finishingConnection: "جارٍ إنهاء الاتصال… يمكنك العودة إلى الطرفية.",
    deviceAuthorized: "تم تخويل الجهاز",
    connected: "متصل",
    connectedDescription:
      "يمكن لهذا الجهاز الآن التصرف نيابةً عنك. يمكنك إدارته أو إلغاءه أدناه.",
    couldNotCreate: "تعذر إنشاء الرمز.",
    networkError: "حدث خطأ في الشبكة. حاول مرة أخرى.",
    urlTitle: "عنوان MCP الخاص بك",
  },
};

export interface McpSettingsMessages {
  mcpTitle: string;
  mcpDescription: string;
  mcpUrlLabel: string;
  mcpUrlHint: string;
  mcpOpenDocs: string;
  a2aAgentCard: string;
  a2aOpenDocs: string;
  mcpClientSetup: string;
  mcpClientSetupDescription: string;
  mcpChooseAssistant: string;
  mcpCommand: string;
  mcpConfig: string;
  mcpCopy: string;
  mcpCopied: string;
  mcpStaticTokenDescription: string;
  mcpOpenConnectPage: string;
  mcpConnect: McpConnectMessages;
}

export const MCP_SETTINGS_MESSAGES: Record<LocaleCode, McpSettingsMessages> = {
  "en-US": {
    mcpTitle: "MCP",
    mcpDescription:
      "Connect this app to Claude, ChatGPT, Cursor, Codex, or another MCP host.",
    mcpUrlLabel: "MCP server URL",
    mcpUrlHint:
      "Copy this URL into the AI host you want to use. The canonical path is /mcp.",
    mcpOpenDocs: "Open MCP connection docs",
    a2aAgentCard: "A2A agent card",
    a2aOpenDocs: "Open A2A documentation",
    mcpClientSetup: "Connect an AI host",
    mcpClientSetupDescription:
      "Choose a host for step-by-step setup, or paste the URL into any MCP-compatible client.",
    mcpChooseAssistant: "Choose your AI assistant",
    mcpCommand: "Command",
    mcpConfig: "MCP config",
    mcpCopy: "Copy",
    mcpCopied: "Copied",
    mcpStaticTokenDescription:
      "Open the full connect page to create a token for clients that cannot complete OAuth.",
    mcpOpenConnectPage: "Open full connect page",
    mcpConnect: MCP_CONNECT_MESSAGES["en-US"],
  },
  "es-ES": {
    mcpTitle: "MCP",
    mcpDescription:
      "Conecta esta app con Claude, ChatGPT, Cursor, Codex u otro host MCP.",
    mcpUrlLabel: "URL del servidor MCP",
    mcpUrlHint:
      "Copia esta URL en el host de IA que quieras usar. La ruta canónica es /mcp.",
    mcpOpenDocs: "Abrir documentación de conexión MCP",
    a2aAgentCard: "Tarjeta de agente A2A",
    a2aOpenDocs: "Abrir documentación de A2A",
    mcpClientSetup: "Conectar un host de IA",
    mcpClientSetupDescription:
      "Elige un host para ver instrucciones paso a paso o pega la URL en cualquier cliente compatible con MCP.",
    mcpChooseAssistant: "Elige tu asistente de IA",
    mcpCommand: "Comando",
    mcpConfig: "Configuración MCP",
    mcpCopy: "Copiar",
    mcpCopied: "Copiado",
    mcpStaticTokenDescription:
      "Abre la página completa de conexión para crear un token para clientes que no pueden completar OAuth.",
    mcpOpenConnectPage: "Abrir página completa de conexión",
    mcpConnect: MCP_CONNECT_MESSAGES["es-ES"],
  },
  "fr-FR": {
    mcpTitle: "MCP",
    mcpDescription:
      "Connectez cette app à Claude, ChatGPT, Cursor, Codex ou un autre hôte MCP.",
    mcpUrlLabel: "URL du serveur MCP",
    mcpUrlHint:
      "Copiez cette URL dans l’hôte IA de votre choix. Le chemin canonique est /mcp.",
    mcpOpenDocs: "Ouvrir la documentation de connexion MCP",
    a2aAgentCard: "Carte d’agent A2A",
    a2aOpenDocs: "Ouvrir la documentation A2A",
    mcpClientSetup: "Connecter un hôte IA",
    mcpClientSetupDescription:
      "Choisissez un hôte pour obtenir une configuration pas à pas, ou collez l’URL dans n’importe quel client compatible MCP.",
    mcpChooseAssistant: "Choisissez votre assistant IA",
    mcpCommand: "Commande",
    mcpConfig: "Configuration MCP",
    mcpCopy: "Copier",
    mcpCopied: "Copié",
    mcpStaticTokenDescription:
      "Ouvrez la page complète de connexion pour créer un jeton pour les clients qui ne peuvent pas terminer OAuth.",
    mcpOpenConnectPage: "Ouvrir la page complète de connexion",
    mcpConnect: MCP_CONNECT_MESSAGES["fr-FR"],
  },
  "de-DE": {
    mcpTitle: "MCP",
    mcpDescription:
      "Verbinde diese App mit Claude, ChatGPT, Cursor, Codex oder einem anderen MCP-Host.",
    mcpUrlLabel: "MCP-Server-URL",
    mcpUrlHint:
      "Kopiere diese URL in den gewünschten KI-Host. Der kanonische Pfad ist /mcp.",
    mcpOpenDocs: "MCP-Verbindungsdokumentation öffnen",
    a2aAgentCard: "A2A-Agentenkarte",
    a2aOpenDocs: "A2A-Dokumentation öffnen",
    mcpClientSetup: "Einen KI-Host verbinden",
    mcpClientSetupDescription:
      "Wähle einen Host für eine Schritt-für-Schritt-Einrichtung oder füge die URL in einen beliebigen MCP-kompatiblen Client ein.",
    mcpChooseAssistant: "Deinen KI-Assistenten auswählen",
    mcpCommand: "Befehl",
    mcpConfig: "MCP-Konfiguration",
    mcpCopy: "Kopieren",
    mcpCopied: "Kopiert",
    mcpStaticTokenDescription:
      "Öffne die vollständige Verbindungsseite, um ein Token für Clients zu erstellen, die OAuth nicht abschließen können.",
    mcpOpenConnectPage: "Vollständige Verbindungsseite öffnen",
    mcpConnect: MCP_CONNECT_MESSAGES["de-DE"],
  },
  "pt-BR": {
    mcpTitle: "MCP",
    mcpDescription:
      "Conecte este app ao Claude, ChatGPT, Cursor, Codex ou outro host MCP.",
    mcpUrlLabel: "URL do servidor MCP",
    mcpUrlHint:
      "Copie esta URL para o host de IA que deseja usar. O caminho canônico é /mcp.",
    mcpOpenDocs: "Abrir documentação de conexão MCP",
    a2aAgentCard: "Cartão do agente A2A",
    a2aOpenDocs: "Abrir documentação do A2A",
    mcpClientSetup: "Conectar um host de IA",
    mcpClientSetupDescription:
      "Escolha um host para ver a configuração passo a passo ou cole a URL em qualquer cliente compatível com MCP.",
    mcpChooseAssistant: "Escolha seu assistente de IA",
    mcpCommand: "Comando",
    mcpConfig: "Configuração MCP",
    mcpCopy: "Copiar",
    mcpCopied: "Copiado",
    mcpStaticTokenDescription:
      "Abra a página completa de conexão para criar um token para clientes que não conseguem concluir o OAuth.",
    mcpOpenConnectPage: "Abrir página completa de conexão",
    mcpConnect: MCP_CONNECT_MESSAGES["pt-BR"],
  },
  "zh-CN": {
    mcpTitle: "MCP",
    mcpDescription:
      "将此应用连接到 Claude、ChatGPT、Cursor、Codex 或其他 MCP 主机。",
    mcpUrlLabel: "MCP 服务器 URL",
    mcpUrlHint: "将此 URL 复制到你要使用的 AI 主机中。规范路径为 /mcp。",
    mcpOpenDocs: "打开 MCP 连接文档",
    a2aAgentCard: "A2A 代理卡",
    a2aOpenDocs: "打开 A2A 文档",
    mcpClientSetup: "连接 AI 主机",
    mcpClientSetupDescription:
      "选择一个主机查看分步设置，或将 URL 粘贴到任何兼容 MCP 的客户端。",
    mcpChooseAssistant: "选择你的 AI 助手",
    mcpCommand: "命令",
    mcpConfig: "MCP 配置",
    mcpCopy: "复制",
    mcpCopied: "已复制",
    mcpStaticTokenDescription:
      "打开完整连接页面，为无法完成 OAuth 的客户端创建令牌。",
    mcpOpenConnectPage: "打开完整连接页面",
    mcpConnect: MCP_CONNECT_MESSAGES["zh-CN"],
  },
  "zh-TW": {
    mcpTitle: "MCP",
    mcpDescription:
      "將此應用程式連線到 Claude、ChatGPT、Cursor、Codex 或其他 MCP 主機。",
    mcpUrlLabel: "MCP 伺服器 URL",
    mcpUrlHint: "將此 URL 複製到你要使用的 AI 主機中。標準路徑為 /mcp。",
    mcpOpenDocs: "開啟 MCP 連線文件",
    a2aAgentCard: "A2A 代理程式卡片",
    a2aOpenDocs: "開啟 A2A 文件",
    mcpClientSetup: "連線 AI 主機",
    mcpClientSetupDescription:
      "選擇主機查看逐步設定，或將 URL 貼到任何相容 MCP 的用戶端。",
    mcpChooseAssistant: "選擇你的 AI 助理",
    mcpCommand: "指令",
    mcpConfig: "MCP 設定",
    mcpCopy: "複製",
    mcpCopied: "已複製",
    mcpStaticTokenDescription:
      "開啟完整連線頁面，為無法完成 OAuth 的用戶端建立權杖。",
    mcpOpenConnectPage: "開啟完整連線頁面",
    mcpConnect: MCP_CONNECT_MESSAGES["zh-TW"],
  },
  "ja-JP": {
    mcpTitle: "MCP",
    mcpDescription:
      "このアプリを Claude、ChatGPT、Cursor、Codex、その他の MCP ホストに接続します。",
    mcpUrlLabel: "MCP サーバー URL",
    mcpUrlHint:
      "この URL を使用する AI ホストにコピーします。標準パスは /mcp です。",
    mcpOpenDocs: "MCP 接続ドキュメントを開く",
    a2aAgentCard: "A2A エージェントカード",
    a2aOpenDocs: "A2A ドキュメントを開く",
    mcpClientSetup: "AI ホストを接続",
    mcpClientSetupDescription:
      "ホストを選ぶと手順に沿って設定できます。または、MCP 対応クライアントに URL を貼り付けます。",
    mcpChooseAssistant: "AI アシスタントを選択",
    mcpCommand: "コマンド",
    mcpConfig: "MCP 設定",
    mcpCopy: "コピー",
    mcpCopied: "コピーしました",
    mcpStaticTokenDescription:
      "完全な接続ページを開いて、OAuth を完了できないクライアント用のトークンを作成します。",
    mcpOpenConnectPage: "完全な接続ページを開く",
    mcpConnect: MCP_CONNECT_MESSAGES["ja-JP"],
  },
  "ko-KR": {
    mcpTitle: "MCP",
    mcpDescription:
      "이 앱을 Claude, ChatGPT, Cursor, Codex 또는 다른 MCP 호스트에 연결합니다.",
    mcpUrlLabel: "MCP 서버 URL",
    mcpUrlHint:
      "사용할 AI 호스트에 이 URL을 복사하세요. 표준 경로는 /mcp입니다.",
    mcpOpenDocs: "MCP 연결 문서 열기",
    a2aAgentCard: "A2A 에이전트 카드",
    a2aOpenDocs: "A2A 문서 열기",
    mcpClientSetup: "AI 호스트 연결",
    mcpClientSetupDescription:
      "호스트를 선택하면 단계별 설정을 확인할 수 있고, 모든 MCP 호환 클라이언트에 URL을 붙여 넣을 수도 있습니다.",
    mcpChooseAssistant: "AI 도우미 선택",
    mcpCommand: "명령",
    mcpConfig: "MCP 구성",
    mcpCopy: "복사",
    mcpCopied: "복사됨",
    mcpStaticTokenDescription:
      "전체 연결 페이지를 열어 OAuth를 완료할 수 없는 클라이언트용 토큰을 만드세요.",
    mcpOpenConnectPage: "전체 연결 페이지 열기",
    mcpConnect: MCP_CONNECT_MESSAGES["ko-KR"],
  },
  "hi-IN": {
    mcpTitle: "MCP",
    mcpDescription:
      "इस ऐप को Claude, ChatGPT, Cursor, Codex या किसी अन्य MCP host से कनेक्ट करें।",
    mcpUrlLabel: "MCP server URL",
    mcpUrlHint:
      "इस URL को उस AI host में कॉपी करें जिसका आप उपयोग करना चाहते हैं। मानक पथ /mcp है।",
    mcpOpenDocs: "MCP कनेक्शन दस्तावेज़ खोलें",
    a2aAgentCard: "A2A agent card",
    a2aOpenDocs: "A2A दस्तावेज़ खोलें",
    mcpClientSetup: "AI host कनेक्ट करें",
    mcpClientSetupDescription:
      "चरण-दर-चरण सेटअप के लिए कोई host चुनें या किसी भी MCP-compatible client में URL पेस्ट करें।",
    mcpChooseAssistant: "अपना AI assistant चुनें",
    mcpCommand: "कमांड",
    mcpConfig: "MCP config",
    mcpCopy: "कॉपी करें",
    mcpCopied: "कॉपी हो गया",
    mcpStaticTokenDescription:
      "पूरी कनेक्शन पेज खोलकर उन clients के लिए token बनाएँ जो OAuth पूरा नहीं कर सकते।",
    mcpOpenConnectPage: "पूरी कनेक्शन पेज खोलें",
    mcpConnect: MCP_CONNECT_MESSAGES["hi-IN"],
  },
  "ar-SA": {
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
    mcpConnect: MCP_CONNECT_MESSAGES["ar-SA"],
  },
};
