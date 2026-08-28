import type { LocaleCode } from "./shared.js";

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
  },
};
