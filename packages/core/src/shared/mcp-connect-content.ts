import type { LocaleCode } from "../localization/shared.js";

export type McpConnectGuideId =
  | "claude"
  | "chatgpt"
  | "cursor"
  | "vscode"
  | "claude-code"
  | "codex"
  | "grok"
  | "other";

export interface McpConnectHost {
  id: string;
  label: string;
  aliases: readonly string[];
  guideId: McpConnectGuideId;
}

export interface McpConnectTemplateValues {
  appName: string;
  appUrl: string;
  mcpUrl: string;
  serverId: string;
}

export type McpConnectEnvironment = "local" | "beta" | "production" | "preview";

/**
 * What an MCP client stores for this app: the name its config entry goes
 * under and the URL it connects to. It never carries a credential, so every
 * surface can render it and write it into an install link.
 */
export interface McpConnectIdentity {
  serverName: string;
  appName: string;
  appUrl: string;
  mcpUrl: string;
  environment: McpConnectEnvironment;
}

export type McpInstallClient = "cursor" | "vscode" | "vscode-insiders";

export interface McpConnectInstallOption {
  client: McpInstallClient;
  label: string;
}

export interface McpConnectGuide {
  id: McpConnectGuideId;
  label: string;
  install?: readonly McpConnectInstallOption[];
  steps?: readonly string[];
  intro?: string;
  commandTemplate?: string;
  configTemplate?: string;
  action?: {
    kind: "link" | "copy";
    label: string;
    href?: string;
  };
  note?: string;
}

export const MCP_CONNECT_MCP_URL_TEMPLATE = "{appUrl}/mcp";

export const MCP_CONNECT_GUIDES: readonly McpConnectGuide[] = [
  {
    id: "claude",
    label: "Claude",
    steps: [
      "Open Customize → Connectors in Claude.",
      "Click the + button → Add custom connector.",
      "Paste the MCP URL above, name it {appName}, click Connect.",
      "On the consent page, click Authorize to approve mcp:read, mcp:write, mcp:apps.",
    ],
    action: {
      kind: "link",
      label: "Open Claude → Connectors",
      href: "https://claude.ai/customize/connectors",
    },
    note: "Works in Claude web and Claude Desktop. Inline MCP Apps (charts, dashboards, drafts) render automatically inside the chat.",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    steps: [
      "In ChatGPT web, open Settings → Apps → Advanced settings and enable developer mode if your workspace requires it.",
      "Choose Create app, paste the MCP URL above, select OAuth, and scan the tools.",
      "Sign in with your Agent-Native account, approve the requested scopes, and enable the app in a chat.",
    ],
    action: {
      kind: "link",
      label: "Open ChatGPT",
      href: "https://chatgpt.com/",
    },
    note: "Custom MCP apps are available on supported ChatGPT web workspaces. Business, Enterprise, and Edu workspaces support full MCP, including write actions; Pro supports read and fetch in developer mode. If Apps or Create app is missing, your plan or workspace policy does not allow this setup. Workspace admins may need to enable developer mode or publish the app.",
  },
  {
    id: "cursor",
    label: "Cursor",
    install: [{ client: "cursor", label: "Add to Cursor" }],
    steps: [
      "Click Add to Cursor, then Install when Cursor asks.",
      "Without the button, open Cursor Settings → Tools & MCPs → New MCP Server and add the MCP URL above.",
      "When prompted, sign in with your Agent-Native account and approve the MCP scopes.",
    ],
    note: "Cursor supports remote-OAuth MCP servers, same paste-URL flow as Claude — no terminal needed.",
  },
  {
    id: "vscode",
    label: "VS Code",
    install: [
      { client: "vscode", label: "Add to VS Code" },
      { client: "vscode-insiders", label: "Add to VS Code Insiders" },
    ],
    steps: [
      "Click Add to VS Code, then Install on the server page VS Code opens.",
      "Without the button, run MCP: Add Server from the Command Palette, choose HTTP, and paste the MCP URL above.",
      "When VS Code asks, allow the sign-in and approve the MCP scopes on the Agent-Native consent page.",
    ],
    note: "The tools appear in the Chat view in Agent mode.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    intro: "In your terminal, run:",
    commandTemplate: "claude mcp add --transport http {serverId} {mcpUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Then inside Claude Code type /mcp, choose {serverId}, and click Authenticate. Claude completes the OAuth flow itself — no static token needed.",
  },
  {
    id: "codex",
    label: "Codex",
    intro: "In your terminal, run:",
    commandTemplate: "codex mcp add {serverId} --url {mcpUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Then run codex mcp login {serverId} and sign in with your Agent-Native account. For Claude Cowork or Goose, run npx @agent-native/core@latest connect {appUrl} instead.",
  },
  {
    id: "grok",
    label: "Grok",
    steps: [
      "Open grok.com/connectors and choose New Connector → Custom.",
      "Paste the MCP URL above and complete the requested authentication.",
      "Enable the connector in a chat after Grok discovers the tools.",
    ],
    action: {
      kind: "link",
      label: "Open Grok → Connectors",
      href: "https://grok.com/connectors",
    },
    note: "Grok requires a publicly reachable MCP server. Connector availability and authentication options depend on your plan and workspace policy.",
  },
  {
    id: "other",
    label: "Other",
    intro:
      "Any MCP-compatible client with remote-OAuth support: paste the MCP URL above. For clients without OAuth, paste this .mcp.json snippet and generate a static bearer below:",
    configTemplate: `{
  "mcpServers": {
    "{serverId}": {
      "type": "http",
      "url": "{mcpUrl}"
    }
  }
}`,
    action: { kind: "copy", label: "Copy config" },
  },
] as const;

export const MCP_CONNECT_HOSTS: readonly McpConnectHost[] = [
  {
    id: "claude",
    label: "Claude",
    aliases: ["claude", "claude desktop", "anthropic"],
    guideId: "claude",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    aliases: ["claude code"],
    guideId: "claude-code",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    aliases: ["chatgpt", "openai"],
    guideId: "chatgpt",
  },
  {
    id: "codex",
    label: "Codex",
    aliases: ["openai codex", "codex"],
    guideId: "codex",
  },
  {
    id: "cowork",
    label: "Claude Cowork",
    aliases: ["claude cowork", "cowork"],
    guideId: "codex",
  },
  {
    id: "cursor",
    label: "Cursor",
    aliases: ["cursor"],
    guideId: "cursor",
  },
  {
    id: "vscode",
    label: "VS Code",
    aliases: [
      "vs code",
      "vscode",
      "visual studio code",
      "copilot",
      "github copilot",
    ],
    guideId: "vscode",
  },
  {
    id: "grok",
    label: "Grok",
    aliases: ["grok", "xai", "x.ai"],
    guideId: "grok",
  },
] as const;

export const MCP_CONNECT_HOST_SEARCH_TEXT = MCP_CONNECT_HOSTS.flatMap(
  (host) => [host.label, ...host.aliases],
).join(" ");

const MCP_CONNECT_GENERIC_SEARCH_TERMS = [
  "external ai host",
  "mcp",
  "model context protocol",
  "connect",
] as const;

function normalizeMcpConnectQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryContainsTerm(query: string, term: string): boolean {
  if (query.length < 3) return false;
  const normalizedTerm = normalizeMcpConnectQuery(term);
  if (query === normalizedTerm) return true;
  return ` ${query} `.includes(` ${normalizedTerm} `);
}

function queryMatchesHostAlias(query: string, alias: string): boolean {
  const normalizedAlias = normalizeMcpConnectQuery(alias);
  return (
    queryContainsTerm(query, alias) ||
    (query.length >= 3 &&
      !query.includes(" ") &&
      !normalizedAlias.includes(" ") &&
      normalizedAlias.startsWith(query))
  );
}

function matchingMcpConnectHosts(query: string): McpConnectHost[] {
  return MCP_CONNECT_HOSTS.map((host) => ({
    host,
    specificity: Math.max(
      0,
      ...host.aliases
        .filter((alias) => queryMatchesHostAlias(query, alias))
        .map((alias) => normalizeMcpConnectQuery(alias).length),
    ),
  }))
    .filter(({ specificity }) => specificity > 0)
    .sort((left, right) => right.specificity - left.specificity)
    .map(({ host }) => host);
}

export function resolveMcpConnectGuideId(
  query: string | null | undefined,
): McpConnectGuideId {
  const normalized = normalizeMcpConnectQuery(query ?? "");
  if (!normalized) return "claude";
  return matchingMcpConnectHosts(normalized)[0]?.guideId ?? "other";
}

export function matchesMcpConnectHost(query: string): boolean {
  const normalized = normalizeMcpConnectQuery(query);
  if (!normalized) return true;
  return (
    matchingMcpConnectHosts(normalized).length > 0 ||
    MCP_CONNECT_GENERIC_SEARCH_TERMS.some((term) =>
      queryContainsTerm(normalized, term),
    )
  );
}

type McpConnectGuideTranslation = Partial<
  Pick<McpConnectGuide, "steps" | "intro" | "note">
> & {
  actionLabel?: string;
  installLabels?: Partial<Record<McpInstallClient, string>>;
};

const MCP_CONNECT_GUIDE_TRANSLATIONS: Partial<
  Record<
    LocaleCode,
    Partial<Record<McpConnectGuideId, McpConnectGuideTranslation>>
  >
> = {
  "es-ES": {
    claude: {
      steps: [
        "Abre Customize → Connectors en Claude.",
        "Haz clic en el botón + → Add custom connector.",
        "Pega la URL de MCP de arriba, asígnale el nombre {appName} y haz clic en Connect.",
        "En la página de consentimiento, haz clic en Authorize para aprobar mcp:read, mcp:write y mcp:apps.",
      ],
      actionLabel: "Abrir Claude → Connectors",
      note: "Funciona en Claude web y Claude Desktop. Las MCP Apps integradas (gráficos, paneles y borradores) se muestran automáticamente dentro del chat.",
    },
    chatgpt: {
      steps: [
        "En la web de ChatGPT, abre Settings → Apps → Advanced settings y activa el modo de desarrollador si tu espacio de trabajo lo requiere.",
        "Elige Create app, pega la URL de MCP de arriba, selecciona OAuth y revisa las herramientas.",
        "Inicia sesión con tu cuenta de Agent-Native, aprueba los ámbitos solicitados y activa la app en un chat.",
      ],
      actionLabel: "Abrir ChatGPT",
      note: "Las apps MCP personalizadas están disponibles en los espacios de trabajo web de ChatGPT compatibles. Los espacios Business, Enterprise y Edu admiten MCP completo, incluidas las acciones de escritura; Pro admite lectura y búsqueda en modo de desarrollador. Si no aparece Apps o Create app, tu plan o la política del espacio de trabajo no permite esta configuración. Es posible que los administradores deban activar el modo de desarrollador o publicar la app.",
    },
    cursor: {
      steps: [
        "Haz clic en Añadir a Cursor y luego en Install cuando Cursor lo pida.",
        "Sin el botón, abre Cursor Settings → Tools & MCPs → New MCP Server y añade la URL de MCP de arriba.",
        "Cuando se te solicite, inicia sesión con tu cuenta de Agent-Native y aprueba los ámbitos de MCP.",
      ],
      installLabels: { cursor: "Añadir a Cursor" },
      note: "Cursor admite servidores MCP remotos con OAuth y ofrece el mismo flujo de pegar la URL que Claude, sin necesidad de usar la terminal.",
    },
    vscode: {
      steps: [
        "Haz clic en Añadir a VS Code y luego en Install en la página del servidor que abre VS Code.",
        "Sin el botón, ejecuta MCP: Add Server desde la paleta de comandos, elige HTTP y pega la URL de MCP de arriba.",
        "Cuando VS Code lo pida, permite el inicio de sesión y aprueba los ámbitos de MCP en la página de consentimiento de Agent-Native.",
      ],
      installLabels: {
        vscode: "Añadir a VS Code",
        "vscode-insiders": "Añadir a VS Code Insiders",
      },
      note: "Las herramientas aparecen en la vista Chat en modo Agent.",
    },
    "claude-code": {
      intro: "En tu terminal, ejecuta:",
      actionLabel: "Copiar comando",
      note: "Después, dentro de Claude Code, escribe /mcp, elige {serverId} y haz clic en Authenticate. Claude completa el flujo OAuth automáticamente; no necesitas un token estático.",
    },
    codex: {
      intro: "En tu terminal, ejecuta:",
      actionLabel: "Copiar comando",
      note: "Después ejecuta codex mcp login {serverId} e inicia sesión con tu cuenta de Agent-Native. Para Claude Cowork o Goose, ejecuta npx @agent-native/core@latest connect {appUrl} en su lugar.",
    },
    grok: {
      steps: [
        "Abre grok.com/connectors y elige New Connector → Custom.",
        "Pega la URL de MCP de arriba y completa la autenticación solicitada.",
        "Activa el conector en un chat después de que Grok detecte las herramientas.",
      ],
      actionLabel: "Abrir Grok → Connectors",
      note: "Grok requiere un servidor MCP accesible públicamente. La disponibilidad y la autenticación dependen de tu plan y de la política del espacio de trabajo.",
    },
    other: {
      intro:
        "Cualquier cliente compatible con MCP y OAuth remoto: pega la URL de MCP de arriba. Para clientes sin OAuth, pega este fragmento .mcp.json y genera abajo un bearer estático:",
      actionLabel: "Copiar configuración",
    },
  },
  "fr-FR": {
    claude: {
      steps: [
        "Dans Claude, ouvrez Customize → Connectors.",
        "Cliquez sur le bouton + → Add custom connector.",
        "Collez l’URL MCP ci-dessus, donnez-lui le nom {appName}, puis cliquez sur Connect.",
        "Sur la page de consentement, cliquez sur Authorize pour approuver mcp:read, mcp:write et mcp:apps.",
      ],
      actionLabel: "Ouvrir Claude → Connectors",
      note: "Fonctionne dans Claude web et Claude Desktop. Les MCP Apps intégrées (graphiques, tableaux de bord et brouillons) s’affichent automatiquement dans le chat.",
    },
    chatgpt: {
      steps: [
        "Dans ChatGPT sur le web, ouvrez Settings → Apps → Advanced settings et activez le mode développeur si votre espace de travail l’exige.",
        "Choisissez Create app, collez l’URL MCP ci-dessus, sélectionnez OAuth et analysez les outils.",
        "Connectez-vous avec votre compte Agent-Native, approuvez les champs d’application demandés et activez l’app dans un chat.",
      ],
      actionLabel: "Ouvrir ChatGPT",
      note: "Les apps MCP personnalisées sont disponibles dans les espaces de travail web ChatGPT compatibles. Les espaces Business, Enterprise et Edu prennent en charge MCP intégralement, y compris les actions d’écriture ; Pro prend en charge la lecture et la récupération en mode développeur. Si Apps ou Create app n’apparaît pas, votre forfait ou la politique de votre espace de travail n’autorise pas cette configuration. Les administrateurs devront peut-être activer le mode développeur ou publier l’app.",
    },
    cursor: {
      steps: [
        "Cliquez sur Ajouter à Cursor, puis sur Install lorsque Cursor vous le demande.",
        "Sans le bouton, ouvrez Cursor Settings → Tools & MCPs → New MCP Server et ajoutez l’URL MCP ci-dessus.",
        "Lorsque vous y êtes invité, connectez-vous avec votre compte Agent-Native et approuvez les champs d’application MCP.",
      ],
      installLabels: { cursor: "Ajouter à Cursor" },
      note: "Cursor prend en charge les serveurs MCP distants avec OAuth et propose le même flux de collage d’URL que Claude, sans terminal.",
    },
    vscode: {
      steps: [
        "Cliquez sur Ajouter à VS Code, puis sur Install dans la page du serveur ouverte par VS Code.",
        "Sans le bouton, exécutez MCP: Add Server depuis la palette de commandes, choisissez HTTP et collez l’URL MCP ci-dessus.",
        "Lorsque VS Code le demande, autorisez la connexion et approuvez les champs d’application MCP sur la page de consentement Agent-Native.",
      ],
      installLabels: {
        vscode: "Ajouter à VS Code",
        "vscode-insiders": "Ajouter à VS Code Insiders",
      },
      note: "Les outils apparaissent dans la vue Chat, en mode Agent.",
    },
    "claude-code": {
      intro: "Dans votre terminal, exécutez :",
      actionLabel: "Copier la commande",
      note: "Ensuite, dans Claude Code, saisissez /mcp, choisissez {serverId}, puis cliquez sur Authenticate. Claude effectue automatiquement le flux OAuth ; aucun jeton statique n’est nécessaire.",
    },
    codex: {
      intro: "Dans votre terminal, exécutez :",
      actionLabel: "Copier la commande",
      note: "Exécutez ensuite codex mcp login {serverId} et connectez-vous avec votre compte Agent-Native. Pour Claude Cowork ou Goose, exécutez plutôt npx @agent-native/core@latest connect {appUrl}.",
    },
    grok: {
      steps: [
        "Ouvrez grok.com/connectors et choisissez New Connector → Custom.",
        "Collez l’URL MCP ci-dessus et terminez l’authentification demandée.",
        "Activez le connecteur dans un chat après la découverte des outils par Grok.",
      ],
      actionLabel: "Ouvrir Grok → Connectors",
      note: "Grok exige un serveur MCP accessible publiquement. La disponibilité et l’authentification dépendent de votre forfait et de la politique de votre espace de travail.",
    },
    other: {
      intro:
        "Tout client compatible avec MCP et OAuth distant : collez l’URL MCP ci-dessus. Pour les clients sans OAuth, collez cet extrait .mcp.json et générez ci-dessous un bearer statique :",
      actionLabel: "Copier la configuration",
    },
  },
  "de-DE": {
    claude: {
      steps: [
        "Öffne in Claude Customize → Connectors.",
        "Klicke auf die Schaltfläche + → Add custom connector.",
        "Füge die MCP-URL oben ein, nenne die Verbindung {appName} und klicke auf Connect.",
        "Klicke auf der Zustimmungsseite auf Authorize, um mcp:read, mcp:write und mcp:apps zu genehmigen.",
      ],
      actionLabel: "Claude → Connectors öffnen",
      note: "Funktioniert in Claude im Web und in Claude Desktop. Eingebettete MCP Apps (Diagramme, Dashboards und Entwürfe) werden automatisch im Chat angezeigt.",
    },
    chatgpt: {
      steps: [
        "Öffne in ChatGPT im Web Settings → Apps → Advanced settings und aktiviere den Entwicklermodus, falls dein Arbeitsbereich dies erfordert.",
        "Wähle Create app, füge die MCP-URL oben ein, wähle OAuth und prüfe die Tools.",
        "Melde dich mit deinem Agent-Native-Konto an, genehmige die angeforderten Bereiche und aktiviere die App in einem Chat.",
      ],
      actionLabel: "ChatGPT öffnen",
      note: "Benutzerdefinierte MCP-Apps sind in unterstützten ChatGPT-Webarbeitsbereichen verfügbar. Business-, Enterprise- und Edu-Arbeitsbereiche unterstützen vollständiges MCP einschließlich Schreibaktionen; Pro unterstützt Lesen und Abrufen im Entwicklermodus. Wenn Apps oder Create app fehlen, erlauben dein Tarif oder die Richtlinien deines Arbeitsbereichs diese Einrichtung nicht. Arbeitsbereich-Admins müssen möglicherweise den Entwicklermodus aktivieren oder die App veröffentlichen.",
    },
    cursor: {
      steps: [
        "Klicke auf Zu Cursor hinzufügen und dann auf Install, wenn Cursor nachfragt.",
        "Ohne die Schaltfläche öffnest du Cursor Settings → Tools & MCPs → New MCP Server und fügst die MCP-URL oben hinzu.",
        "Melde dich bei der Aufforderung mit deinem Agent-Native-Konto an und genehmige die MCP-Bereiche.",
      ],
      installLabels: { cursor: "Zu Cursor hinzufügen" },
      note: "Cursor unterstützt entfernte MCP-Server mit OAuth und denselben URL-Einfügeablauf wie Claude, ganz ohne Terminal.",
    },
    vscode: {
      steps: [
        "Klicke auf Zu VS Code hinzufügen und dann auf der Serverseite, die VS Code öffnet, auf Install.",
        "Ohne die Schaltfläche führst du MCP: Add Server in der Befehlspalette aus, wählst HTTP und fügst die MCP-URL oben ein.",
        "Wenn VS Code nachfragt, erlaube die Anmeldung und genehmige die MCP-Bereiche auf der Agent-Native-Zustimmungsseite.",
      ],
      installLabels: {
        vscode: "Zu VS Code hinzufügen",
        "vscode-insiders": "Zu VS Code Insiders hinzufügen",
      },
      note: "Die Tools erscheinen in der Chat-Ansicht im Agent-Modus.",
    },
    "claude-code": {
      intro: "Führe in deinem Terminal Folgendes aus:",
      actionLabel: "Befehl kopieren",
      note: "Gib anschließend in Claude Code /mcp ein, wähle {serverId} und klicke auf Authenticate. Claude führt den OAuth-Ablauf selbstständig durch; ein statisches Token ist nicht erforderlich.",
    },
    codex: {
      intro: "Führe in deinem Terminal Folgendes aus:",
      actionLabel: "Befehl kopieren",
      note: "Führe danach codex mcp login {serverId} aus und melde dich mit deinem Agent-Native-Konto an. Für Claude Cowork oder Goose führe stattdessen npx @agent-native/core@latest connect {appUrl} aus.",
    },
    grok: {
      steps: [
        "Öffne grok.com/connectors und wähle New Connector → Custom.",
        "Füge die MCP-URL oben ein und schließe die angeforderte Authentifizierung ab.",
        "Aktiviere den Connector in einem Chat, nachdem Grok die Tools erkannt hat.",
      ],
      actionLabel: "Grok → Connectors öffnen",
      note: "Grok benötigt einen öffentlich erreichbaren MCP-Server. Verfügbarkeit und Authentifizierung hängen von deinem Tarif und den Richtlinien deines Arbeitsbereichs ab.",
    },
    other: {
      intro:
        "Jeder MCP-kompatible Client mit Remote-OAuth-Unterstützung: Füge die MCP-URL oben ein. Für Clients ohne OAuth füge diesen .mcp.json-Ausschnitt ein und erstelle unten einen statischen Bearer-Token:",
      actionLabel: "Konfiguration kopieren",
    },
  },
  "pt-BR": {
    claude: {
      steps: [
        "Abra Customize → Connectors no Claude.",
        "Clique no botão + → Add custom connector.",
        "Cole a URL MCP acima, dê a ela o nome {appName} e clique em Connect.",
        "Na página de consentimento, clique em Authorize para aprovar mcp:read, mcp:write e mcp:apps.",
      ],
      actionLabel: "Abrir Claude → Connectors",
      note: "Funciona no Claude web e no Claude Desktop. MCP Apps incorporados (gráficos, painéis e rascunhos) são exibidos automaticamente no chat.",
    },
    chatgpt: {
      steps: [
        "No ChatGPT web, abra Settings → Apps → Advanced settings e ative o modo de desenvolvedor se o seu espaço de trabalho exigir.",
        "Escolha Create app, cole a URL MCP acima, selecione OAuth e verifique as ferramentas.",
        "Entre com sua conta Agent-Native, aprove os escopos solicitados e ative o app em um chat.",
      ],
      actionLabel: "Abrir ChatGPT",
      note: "Apps MCP personalizados estão disponíveis em espaços de trabalho web compatíveis do ChatGPT. Os espaços Business, Enterprise e Edu oferecem suporte completo a MCP, incluindo ações de escrita; o Pro oferece suporte a leitura e busca no modo de desenvolvedor. Se Apps ou Create app não aparecer, seu plano ou a política do espaço de trabalho não permite essa configuração. Talvez os administradores precisem ativar o modo de desenvolvedor ou publicar o app.",
    },
    cursor: {
      steps: [
        "Clique em Adicionar ao Cursor e depois em Install quando o Cursor pedir.",
        "Sem o botão, abra Cursor Settings → Tools & MCPs → New MCP Server e adicione a URL MCP acima.",
        "Quando solicitado, entre com sua conta Agent-Native e aprove os escopos MCP.",
      ],
      installLabels: { cursor: "Adicionar ao Cursor" },
      note: "O Cursor aceita servidores MCP remotos com OAuth e oferece o mesmo fluxo de colar a URL do Claude, sem terminal.",
    },
    vscode: {
      steps: [
        "Clique em Adicionar ao VS Code e depois em Install na página do servidor que o VS Code abrir.",
        "Sem o botão, execute MCP: Add Server na paleta de comandos, escolha HTTP e cole a URL MCP acima.",
        "Quando o VS Code pedir, permita o login e aprove os escopos MCP na página de consentimento do Agent-Native.",
      ],
      installLabels: {
        vscode: "Adicionar ao VS Code",
        "vscode-insiders": "Adicionar ao VS Code Insiders",
      },
      note: "As ferramentas aparecem na visualização Chat, no modo Agent.",
    },
    "claude-code": {
      intro: "No terminal, execute:",
      actionLabel: "Copiar comando",
      note: "Depois, no Claude Code, digite /mcp, escolha {serverId} e clique em Authenticate. O Claude conclui o fluxo OAuth automaticamente; nenhum token estático é necessário.",
    },
    codex: {
      intro: "No terminal, execute:",
      actionLabel: "Copiar comando",
      note: "Depois execute codex mcp login {serverId} e entre com sua conta Agent-Native. Para Claude Cowork ou Goose, execute npx @agent-native/core@latest connect {appUrl}.",
    },
    grok: {
      steps: [
        "Abra grok.com/connectors e escolha New Connector → Custom.",
        "Cole a URL MCP acima e conclua a autenticação solicitada.",
        "Ative o conector em um chat depois que o Grok descobrir as ferramentas.",
      ],
      actionLabel: "Abrir Grok → Connectors",
      note: "O Grok exige um servidor MCP acessível publicamente. A disponibilidade e a autenticação dependem do seu plano e da política do espaço de trabalho.",
    },
    other: {
      intro:
        "Qualquer cliente compatível com MCP e OAuth remoto: cole a URL MCP acima. Para clientes sem OAuth, cole este trecho .mcp.json e gere um bearer estático abaixo:",
      actionLabel: "Copiar configuração",
    },
  },
  "zh-CN": {
    claude: {
      steps: [
        "在 Claude 中打开 Customize → Connectors。",
        "点击 + 按钮 → Add custom connector。",
        "粘贴上面的 MCP URL，将其命名为 {appName}，然后点击 Connect。",
        "在同意页面点击 Authorize，批准 mcp:read、mcp:write 和 mcp:apps。",
      ],
      actionLabel: "打开 Claude → Connectors",
      note: "适用于 Claude 网页版和 Claude Desktop。嵌入式 MCP Apps（图表、仪表板和草稿）会自动显示在聊天中。",
    },
    chatgpt: {
      steps: [
        "在 ChatGPT 网页版中打开 Settings → Apps → Advanced settings；如果工作区要求，请启用开发者模式。",
        "选择 Create app，粘贴上面的 MCP URL，选择 OAuth，然后扫描工具。",
        "使用 Agent-Native 账户登录，批准请求的权限范围，并在聊天中启用该应用。",
      ],
      actionLabel: "打开 ChatGPT",
      note: "自定义 MCP 应用适用于受支持的 ChatGPT 网页工作区。Business、Enterprise 和 Edu 工作区支持完整 MCP，包括写入操作；Pro 在开发者模式下支持读取和获取。如果看不到 Apps 或 Create app，你的套餐或工作区策略不允许此设置。工作区管理员可能需要启用开发者模式或发布应用。",
    },
    cursor: {
      steps: [
        "点击“添加到 Cursor”，然后在 Cursor 询问时点击 Install。",
        "如果没有该按钮，请打开 Cursor Settings → Tools & MCPs → New MCP Server，并添加上面的 MCP URL。",
        "出现提示时，使用 Agent-Native 账户登录并批准 MCP 权限范围。",
      ],
      installLabels: { cursor: "添加到 Cursor" },
      note: "Cursor 支持远程 OAuth MCP 服务器，使用与 Claude 相同的粘贴 URL 流程，无需终端。",
    },
    vscode: {
      steps: [
        "点击“添加到 VS Code”，然后在 VS Code 打开的服务器页面上点击 Install。",
        "如果没有该按钮，请在命令面板中运行 MCP: Add Server，选择 HTTP，然后粘贴上面的 MCP URL。",
        "VS Code 询问时，允许登录，并在 Agent-Native 授权页面上批准 MCP 权限范围。",
      ],
      installLabels: {
        vscode: "添加到 VS Code",
        "vscode-insiders": "添加到 VS Code Insiders",
      },
      note: "这些工具会出现在 Agent 模式下的 Chat 视图中。",
    },
    "claude-code": {
      intro: "在终端中运行：",
      actionLabel: "复制命令",
      note: "然后在 Claude Code 中输入 /mcp，选择 {serverId}，再点击 Authenticate。Claude 会自动完成 OAuth 流程，无需静态令牌。",
    },
    codex: {
      intro: "在终端中运行：",
      actionLabel: "复制命令",
      note: "然后运行 codex mcp login {serverId}，并使用 Agent-Native 账户登录。如需连接 Claude Cowork 或 Goose，请改为运行 npx @agent-native/core@latest connect {appUrl}。",
    },
    grok: {
      steps: [
        "打开 grok.com/connectors，然后选择 New Connector → Custom。",
        "粘贴上面的 MCP URL，并完成要求的身份验证。",
        "Grok 发现工具后，在聊天中启用该连接器。",
      ],
      actionLabel: "打开 Grok → Connectors",
      note: "Grok 需要可公开访问的 MCP 服务器。连接器可用性和身份验证选项取决于你的套餐和工作区策略。",
    },
    other: {
      intro:
        "任何支持远程 OAuth 的 MCP 兼容客户端：粘贴上面的 MCP URL。对于不支持 OAuth 的客户端，粘贴此 .mcp.json 片段，然后在下方生成静态 bearer：",
      actionLabel: "复制配置",
    },
  },
  "zh-TW": {
    claude: {
      steps: [
        "在 Claude 中開啟 Customize → Connectors。",
        "按一下 + 按鈕 → Add custom connector。",
        "貼上方的 MCP URL，將其命名為 {appName}，然後按一下 Connect。",
        "在同意頁面按一下 Authorize，核准 mcp:read、mcp:write 和 mcp:apps。",
      ],
      actionLabel: "開啟 Claude → Connectors",
      note: "適用於 Claude 網頁版和 Claude Desktop。內嵌 MCP Apps（圖表、儀表板和草稿）會自動顯示在聊天中。",
    },
    chatgpt: {
      steps: [
        "在 ChatGPT 網頁版中開啟 Settings → Apps → Advanced settings；如果工作區要求，請啟用開發人員模式。",
        "選擇 Create app，貼上方的 MCP URL，選擇 OAuth，然後掃描工具。",
        "使用 Agent-Native 帳戶登入，核准要求的權限範圍，並在聊天中啟用該應用程式。",
      ],
      actionLabel: "開啟 ChatGPT",
      note: "自訂 MCP 應用程式適用於受支援的 ChatGPT 網頁工作區。Business、Enterprise 和 Edu 工作區支援完整 MCP，包括寫入動作；Pro 在開發人員模式下支援讀取和擷取。如果看不到 Apps 或 Create app，你的方案或工作區政策不允許此設定。工作區管理員可能需要啟用開發人員模式或發佈應用程式。",
    },
    cursor: {
      steps: [
        "按一下「新增至 Cursor」，然後在 Cursor 詢問時按一下 Install。",
        "如果沒有這個按鈕，請開啟 Cursor Settings → Tools & MCPs → New MCP Server，並新增上方的 MCP URL。",
        "出現提示時，使用 Agent-Native 帳戶登入並核准 MCP 權限範圍。",
      ],
      installLabels: { cursor: "新增至 Cursor" },
      note: "Cursor 支援遠端 OAuth MCP 伺服器，使用與 Claude 相同的貼上 URL 流程，不需要終端機。",
    },
    vscode: {
      steps: [
        "按一下「新增至 VS Code」，然後在 VS Code 開啟的伺服器頁面上按一下 Install。",
        "如果沒有這個按鈕，請在命令選擇區執行 MCP: Add Server，選擇 HTTP，然後貼上上方的 MCP URL。",
        "VS Code 詢問時，允許登入，並在 Agent-Native 同意頁面上核准 MCP 權限範圍。",
      ],
      installLabels: {
        vscode: "新增至 VS Code",
        "vscode-insiders": "新增至 VS Code Insiders",
      },
      note: "這些工具會出現在 Agent 模式下的 Chat 檢視中。",
    },
    "claude-code": {
      intro: "在終端機中執行：",
      actionLabel: "複製指令",
      note: "接著在 Claude Code 中輸入 /mcp，選擇 {serverId}，再按一下 Authenticate。Claude 會自動完成 OAuth 流程，不需要靜態權杖。",
    },
    codex: {
      intro: "在終端機中執行：",
      actionLabel: "複製指令",
      note: "接著執行 codex mcp login {serverId}，並使用 Agent-Native 帳戶登入。若要連接 Claude Cowork 或 Goose，請改為執行 npx @agent-native/core@latest connect {appUrl}。",
    },
    grok: {
      steps: [
        "開啟 grok.com/connectors，然後選擇 New Connector → Custom。",
        "貼上上方的 MCP URL，並完成要求的驗證。",
        "Grok 探索工具後，在聊天中啟用連接器。",
      ],
      actionLabel: "開啟 Grok → Connectors",
      note: "Grok 需要可公開連線的 MCP 伺服器。連接器可用性和驗證選項取決於你的方案和工作區政策。",
    },
    other: {
      intro:
        "任何支援遠端 OAuth 的 MCP 相容用戶端：貼上方的 MCP URL。對於不支援 OAuth 的用戶端，貼上此 .mcp.json 片段，然後在下方產生靜態 bearer：",
      actionLabel: "複製設定",
    },
  },
  "ja-JP": {
    claude: {
      steps: [
        "Claude で Customize → Connectors を開きます。",
        "+ ボタン → Add custom connector をクリックします。",
        "上の MCP URL を貼り付け、{appName} という名前を付けて Connect をクリックします。",
        "同意ページで Authorize をクリックし、mcp:read、mcp:write、mcp:apps を承認します。",
      ],
      actionLabel: "Claude → Connectors を開く",
      note: "Claude ウェブ版と Claude Desktop で利用できます。埋め込み MCP Apps（グラフ、ダッシュボード、下書き）はチャット内に自動的に表示されます。",
    },
    chatgpt: {
      steps: [
        "ChatGPT ウェブ版で Settings → Apps → Advanced settings を開き、ワークスペースで必要な場合は開発者モードを有効にします。",
        "Create app を選び、上の MCP URL を貼り付け、OAuth を選択してツールをスキャンします。",
        "Agent-Native アカウントでサインインし、要求されたスコープを承認して、チャットでアプリを有効にします。",
      ],
      actionLabel: "ChatGPT を開く",
      note: "カスタム MCP アプリは、対応している ChatGPT ウェブワークスペースで利用できます。Business、Enterprise、Edu のワークスペースは書き込み操作を含む完全な MCP をサポートし、Pro は開発者モードで読み取りと取得をサポートします。Apps または Create app が表示されない場合、プランまたはワークスペースのポリシーでこの設定が許可されていません。ワークスペース管理者が開発者モードを有効にするか、アプリを公開する必要がある場合があります。",
    },
    cursor: {
      steps: [
        "「Cursor に追加」をクリックし、Cursor で確認されたら Install をクリックします。",
        "ボタンを使わない場合は、Cursor Settings → Tools & MCPs → New MCP Server を開き、上の MCP URL を追加します。",
        "求められたら Agent-Native アカウントでサインインし、MCP スコープを承認します。",
      ],
      installLabels: { cursor: "Cursor に追加" },
      note: "Cursor はリモート OAuth MCP サーバーをサポートしており、ターミナルを使わず Claude と同じ URL 貼り付けフローで設定できます。",
    },
    vscode: {
      steps: [
        "「VS Code に追加」をクリックし、VS Code が開くサーバー ページで Install をクリックします。",
        "ボタンを使わない場合は、コマンド パレットで MCP: Add Server を実行し、HTTP を選んで上の MCP URL を貼り付けます。",
        "VS Code で確認されたらサインインを許可し、Agent-Native の同意ページで MCP スコープを承認します。",
      ],
      installLabels: {
        vscode: "VS Code に追加",
        "vscode-insiders": "VS Code Insiders に追加",
      },
      note: "ツールは Agent モードの Chat ビューに表示されます。",
    },
    "claude-code": {
      intro: "ターミナルで次を実行します：",
      actionLabel: "コマンドをコピー",
      note: "次に Claude Code で /mcp と入力し、{serverId} を選んで Authenticate をクリックします。Claude が OAuth フローを自動的に完了するため、静的トークンは不要です。",
    },
    codex: {
      intro: "ターミナルで次を実行します：",
      actionLabel: "コマンドをコピー",
      note: "続けて codex mcp login {serverId} を実行し、Agent-Native アカウントでサインインします。Claude Cowork や Goose の場合は、代わりに npx @agent-native/core@latest connect {appUrl} を実行します。",
    },
    grok: {
      steps: [
        "grok.com/connectors を開き、New Connector → Custom を選びます。",
        "上の MCP URL を貼り付け、要求された認証を完了します。",
        "Grok がツールを検出したら、チャットでコネクタを有効にします。",
      ],
      actionLabel: "Grok → Connectors を開く",
      note: "Grok には公開アクセス可能な MCP サーバーが必要です。コネクタの利用可否と認証方法はプランとワークスペースポリシーによります。",
    },
    other: {
      intro:
        "リモート OAuth に対応する MCP 互換クライアントの場合：上の MCP URL を貼り付けます。OAuth に対応していないクライアントの場合は、この .mcp.json スニペットを貼り付け、下で静的 bearer を生成します：",
      actionLabel: "設定をコピー",
    },
  },
  "ko-KR": {
    claude: {
      steps: [
        "Claude에서 Customize → Connectors를 엽니다.",
        "+ 버튼 → Add custom connector를 클릭합니다.",
        "위의 MCP URL을 붙여 넣고 {appName}으로 이름을 지정한 다음 Connect를 클릭합니다.",
        "동의 페이지에서 Authorize를 클릭하여 mcp:read, mcp:write, mcp:apps를 승인합니다.",
      ],
      actionLabel: "Claude → Connectors 열기",
      note: "Claude 웹과 Claude Desktop에서 사용할 수 있습니다. 인라인 MCP Apps(차트, 대시보드, 초안)는 채팅 안에 자동으로 표시됩니다.",
    },
    chatgpt: {
      steps: [
        "ChatGPT 웹에서 Settings → Apps → Advanced settings를 열고 워크스페이스에서 요구하는 경우 개발자 모드를 활성화합니다.",
        "Create app을 선택하고 위의 MCP URL을 붙여 넣은 다음 OAuth를 선택하고 도구를 스캔합니다.",
        "Agent-Native 계정으로 로그인하고 요청된 범위를 승인한 다음 채팅에서 앱을 활성화합니다.",
      ],
      actionLabel: "ChatGPT 열기",
      note: "사용자 지정 MCP 앱은 지원되는 ChatGPT 웹 워크스페이스에서 사용할 수 있습니다. Business, Enterprise, Edu 워크스페이스는 쓰기 작업을 포함한 전체 MCP를 지원하고, Pro는 개발자 모드에서 읽기와 가져오기를 지원합니다. Apps 또는 Create app이 표시되지 않으면 요금제나 워크스페이스 정책에서 이 설정을 허용하지 않는 것입니다. 워크스페이스 관리자가 개발자 모드를 활성화하거나 앱을 게시해야 할 수 있습니다.",
    },
    cursor: {
      steps: [
        "Cursor에 추가를 클릭한 다음 Cursor에서 묻는 경우 Install을 클릭합니다.",
        "버튼이 없다면 Cursor Settings → Tools & MCPs → New MCP Server를 열고 위의 MCP URL을 추가합니다.",
        "메시지가 표시되면 Agent-Native 계정으로 로그인하고 MCP 범위를 승인합니다.",
      ],
      installLabels: { cursor: "Cursor에 추가" },
      note: "Cursor는 원격 OAuth MCP 서버를 지원하며 터미널 없이 Claude와 같은 URL 붙여 넣기 흐름을 사용합니다.",
    },
    vscode: {
      steps: [
        "VS Code에 추가를 클릭한 다음 VS Code가 여는 서버 페이지에서 Install을 클릭합니다.",
        "버튼이 없다면 명령 팔레트에서 MCP: Add Server를 실행하고 HTTP를 선택한 다음 위의 MCP URL을 붙여 넣습니다.",
        "VS Code에서 묻는 경우 로그인을 허용하고 Agent-Native 동의 페이지에서 MCP 범위를 승인합니다.",
      ],
      installLabels: {
        vscode: "VS Code에 추가",
        "vscode-insiders": "VS Code Insiders에 추가",
      },
      note: "도구는 Agent 모드의 Chat 보기에 표시됩니다.",
    },
    "claude-code": {
      intro: "터미널에서 다음을 실행합니다:",
      actionLabel: "명령 복사",
      note: "그런 다음 Claude Code에서 /mcp를 입력하고 {serverId}를 선택한 뒤 Authenticate를 클릭합니다. Claude가 OAuth 흐름을 자동으로 완료하므로 정적 토큰이 필요하지 않습니다.",
    },
    codex: {
      intro: "터미널에서 다음을 실행합니다:",
      actionLabel: "명령 복사",
      note: "그런 다음 codex mcp login {serverId}를 실행하고 Agent-Native 계정으로 로그인합니다. Claude Cowork 또는 Goose에서는 대신 npx @agent-native/core@latest connect {appUrl}를 실행합니다.",
    },
    grok: {
      steps: [
        "grok.com/connectors를 열고 New Connector → Custom을 선택합니다.",
        "위의 MCP URL을 붙여 넣고 요청된 인증을 완료합니다.",
        "Grok이 도구를 검색한 후 채팅에서 커넥터를 활성화합니다.",
      ],
      actionLabel: "Grok → Connectors 열기",
      note: "Grok에는 공개적으로 접근 가능한 MCP 서버가 필요합니다. 커넥터 사용 가능 여부와 인증 옵션은 요금제와 워크스페이스 정책에 따라 달라집니다.",
    },
    other: {
      intro:
        "원격 OAuth를 지원하는 모든 MCP 호환 클라이언트: 위의 MCP URL을 붙여 넣습니다. OAuth를 지원하지 않는 클라이언트는 이 .mcp.json 스니펫을 붙여 넣고 아래에서 정적 bearer를 생성합니다:",
      actionLabel: "구성 복사",
    },
  },
  "hi-IN": {
    claude: {
      steps: [
        "Claude में Customize → Connectors खोलें।",
        "+ बटन → Add custom connector पर क्लिक करें।",
        "ऊपर दिया गया MCP URL पेस्ट करें, इसका नाम {appName} रखें और Connect पर क्लिक करें।",
        "सहमति वाले पेज पर Authorize पर क्लिक करके mcp:read, mcp:write और mcp:apps को मंज़ूरी दें।",
      ],
      actionLabel: "Claude → Connectors खोलें",
      note: "Claude वेब और Claude Desktop में काम करता है। इनलाइन MCP Apps (चार्ट, डैशबोर्ड और ड्राफ़्ट) चैट के अंदर अपने आप दिखाई देते हैं।",
    },
    chatgpt: {
      steps: [
        "ChatGPT वेब में Settings → Apps → Advanced settings खोलें और अगर आपका workspace कहता है तो developer mode चालू करें।",
        "Create app चुनें, ऊपर दिया MCP URL पेस्ट करें, OAuth चुनें और tools को स्कैन करें।",
        "अपने Agent-Native खाते से साइन इन करें, मांगे गए scopes को मंज़ूरी दें और चैट में app चालू करें।",
      ],
      actionLabel: "ChatGPT खोलें",
      note: "कस्टम MCP apps समर्थित ChatGPT वेब workspaces में उपलब्ध हैं। Business, Enterprise और Edu workspaces write actions सहित पूर्ण MCP का समर्थन करते हैं; Pro developer mode में read और fetch का समर्थन करता है। अगर Apps या Create app दिखाई नहीं देता, तो आपका plan या workspace policy इस सेटअप की अनुमति नहीं देता। Workspace admins को developer mode चालू करने या app प्रकाशित करने की ज़रूरत पड़ सकती है।",
    },
    cursor: {
      steps: [
        "Cursor में जोड़ें पर क्लिक करें, फिर Cursor के पूछने पर Install पर क्लिक करें।",
        "बटन के बिना, Cursor Settings → Tools & MCPs → New MCP Server खोलें और ऊपर दिया MCP URL जोड़ें।",
        "पूछे जाने पर अपने Agent-Native खाते से साइन इन करें और MCP scopes को मंज़ूरी दें।",
      ],
      installLabels: { cursor: "Cursor में जोड़ें" },
      note: "Cursor remote-OAuth MCP servers का समर्थन करता है और terminal के बिना Claude जैसा paste-URL flow देता है।",
    },
    vscode: {
      steps: [
        "VS Code में जोड़ें पर क्लिक करें, फिर VS Code के खोले गए सर्वर पेज पर Install पर क्लिक करें।",
        "बटन के बिना, Command Palette से MCP: Add Server चलाएँ, HTTP चुनें और ऊपर दिया MCP URL पेस्ट करें।",
        "VS Code के पूछने पर साइन-इन की अनुमति दें और Agent-Native सहमति पेज पर MCP scopes को मंज़ूरी दें।",
      ],
      installLabels: {
        vscode: "VS Code में जोड़ें",
        "vscode-insiders": "VS Code Insiders में जोड़ें",
      },
      note: "टूल Agent मोड में Chat व्यू में दिखते हैं।",
    },
    "claude-code": {
      intro: "अपने terminal में चलाएँ:",
      actionLabel: "कमांड कॉपी करें",
      note: "फिर Claude Code में /mcp टाइप करें, {serverId} चुनें और Authenticate पर क्लिक करें। Claude OAuth flow अपने आप पूरा करता है; static token की ज़रूरत नहीं है।",
    },
    codex: {
      intro: "अपने terminal में चलाएँ:",
      actionLabel: "कमांड कॉपी करें",
      note: "फिर codex mcp login {serverId} चलाएँ और अपने Agent-Native खाते से साइन इन करें। Claude Cowork या Goose के लिए इसके बजाय npx @agent-native/core@latest connect {appUrl} चलाएँ।",
    },
    grok: {
      steps: [
        "grok.com/connectors खोलें और New Connector → Custom चुनें।",
        "ऊपर दिया MCP URL पेस्ट करें और मांगा गया authentication पूरा करें।",
        "Grok के tools खोज लेने के बाद chat में connector चालू करें।",
      ],
      actionLabel: "Grok → Connectors खोलें",
      note: "Grok को सार्वजनिक रूप से उपलब्ध MCP server चाहिए। Connector availability और authentication options आपके plan और workspace policy पर निर्भर हैं।",
    },
    other: {
      intro:
        "Remote-OAuth support वाला कोई भी MCP-compatible client: ऊपर दिया MCP URL पेस्ट करें। OAuth के बिना clients के लिए यह .mcp.json snippet पेस्ट करें और नीचे static bearer बनाएँ:",
      actionLabel: "कॉन्फ़िगरेशन कॉपी करें",
    },
  },
  "ar-SA": {
    claude: {
      steps: [
        "افتح Customize → Connectors في Claude.",
        "انقر على زر + → Add custom connector.",
        "الصق عنوان MCP أعلاه، وسمّه {appName}، ثم انقر على Connect.",
        "في صفحة الموافقة، انقر على Authorize للموافقة على mcp:read وmcp:write وmcp:apps.",
      ],
      actionLabel: "فتح Claude → Connectors",
      note: "يعمل في Claude على الويب وClaude Desktop. تظهر MCP Apps المضمّنة (المخططات ولوحات المعلومات والمسودات) تلقائيًا داخل الدردشة.",
    },
    chatgpt: {
      steps: [
        "في ChatGPT على الويب، افتح Settings → Apps → Advanced settings وفعّل وضع المطوّر إذا تطلّب ذلك نطاق عملك.",
        "اختر Create app، والصق عنوان MCP أعلاه، وحدد OAuth، ثم افحص الأدوات.",
        "سجّل الدخول بحساب Agent-Native، ووافق على النطاقات المطلوبة، وفعّل التطبيق في إحدى المحادثات.",
      ],
      actionLabel: "فتح ChatGPT",
      note: "تتوفر تطبيقات MCP المخصصة في مساحات عمل ChatGPT على الويب المدعومة. تدعم مساحات Business وEnterprise وEdu بروتوكول MCP بالكامل، بما في ذلك إجراءات الكتابة؛ بينما يدعم Pro القراءة والجلب في وضع المطوّر. إذا لم يظهر Apps أو Create app، فلا تسمح خطتك أو سياسة مساحة العمل بهذا الإعداد. قد يحتاج مسؤولو مساحة العمل إلى تفعيل وضع المطوّر أو نشر التطبيق.",
    },
    cursor: {
      steps: [
        "انقر على إضافة إلى Cursor، ثم على Install عندما يطلب Cursor ذلك.",
        "من دون الزر، افتح Cursor Settings → Tools & MCPs → New MCP Server وأضف عنوان MCP أعلاه.",
        "عند الطلب، سجّل الدخول بحساب Agent-Native ووافق على نطاقات MCP.",
      ],
      installLabels: { cursor: "إضافة إلى Cursor" },
      note: "يدعم Cursor خوادم MCP البعيدة باستخدام OAuth، مع نفس طريقة لصق العنوان المتوفرة في Claude، من دون الحاجة إلى الطرفية.",
    },
    vscode: {
      steps: [
        "انقر على إضافة إلى VS Code، ثم على Install في صفحة الخادم التي يفتحها VS Code.",
        "من دون الزر، شغّل MCP: Add Server من لوحة الأوامر، واختر HTTP، والصق عنوان MCP أعلاه.",
        "عندما يطلب VS Code ذلك، اسمح بتسجيل الدخول ووافق على نطاقات MCP في صفحة الموافقة في Agent-Native.",
      ],
      installLabels: {
        vscode: "إضافة إلى VS Code",
        "vscode-insiders": "إضافة إلى VS Code Insiders",
      },
      note: "تظهر الأدوات في عرض Chat في وضع Agent.",
    },
    "claude-code": {
      intro: "شغّل الأمر التالي في الطرفية:",
      actionLabel: "نسخ الأمر",
      note: "بعد ذلك اكتب /mcp داخل Claude Code، واختر {serverId}، ثم انقر على Authenticate. يكمل Claude تدفق OAuth تلقائيًا، ولا تحتاج إلى رمز ثابت.",
    },
    codex: {
      intro: "شغّل الأمر التالي في الطرفية:",
      actionLabel: "نسخ الأمر",
      note: "ثم شغّل codex mcp login {serverId} وسجّل الدخول بحساب Agent-Native. بالنسبة إلى Claude Cowork أو Goose، شغّل npx @agent-native/core@latest connect {appUrl} بدلاً من ذلك.",
    },
    grok: {
      steps: [
        "افتح grok.com/connectors واختر New Connector → Custom.",
        "الصق عنوان MCP أعلاه وأكمل المصادقة المطلوبة.",
        "فعّل الموصل في محادثة بعد أن يكتشف Grok الأدوات.",
      ],
      actionLabel: "فتح Grok → Connectors",
      note: "يتطلب Grok خادم MCP متاحًا للعامة. يعتمد توفر الموصل وخيارات المصادقة على خطتك وسياسة مساحة العمل.",
    },
    other: {
      intro:
        "أي عميل متوافق مع MCP ويدعم OAuth عن بُعد: الصق عنوان MCP أعلاه. للعملاء الذين لا يدعمون OAuth، الصق مقتطف .mcp.json هذا وأنشئ رمز bearer ثابتًا أدناه:",
      actionLabel: "نسخ الإعدادات",
    },
  },
};

export function getMcpConnectGuides(
  locale: LocaleCode,
): readonly McpConnectGuide[] {
  const translations = MCP_CONNECT_GUIDE_TRANSLATIONS[locale];
  if (!translations) return MCP_CONNECT_GUIDES;

  return MCP_CONNECT_GUIDES.map((guide) => {
    const translation = translations[guide.id];
    if (!translation) return guide;
    return {
      ...guide,
      ...(translation.steps ? { steps: translation.steps } : {}),
      ...(translation.intro ? { intro: translation.intro } : {}),
      ...(translation.note ? { note: translation.note } : {}),
      ...(translation.actionLabel && guide.action
        ? { action: { ...guide.action, label: translation.actionLabel } }
        : {}),
      ...(translation.installLabels && guide.install
        ? {
            install: guide.install.map((option) => ({
              ...option,
              label: translation.installLabels?.[option.client] ?? option.label,
            })),
          }
        : {}),
    };
  });
}

export const MCP_STATIC_TOKEN_FALLBACK = {
  title: "Generate a static token",
  state: "Advanced — clients without OAuth",
  resultTitle: "Connection token created",
  resultCopy:
    "Paste this into your agent's MCP config. The token is shown only once.",
};

const MCP_STATIC_TOKEN_TRANSLATIONS: Partial<
  Record<LocaleCode, Partial<typeof MCP_STATIC_TOKEN_FALLBACK>>
> = {
  "es-ES": {
    title: "Generar un token estático",
    state: "Avanzado — clientes sin OAuth",
    resultTitle: "Token de conexión creado",
    resultCopy:
      "Pega esto en la configuración MCP de tu agente. El token solo se muestra una vez.",
  },
  "fr-FR": {
    title: "Générer un jeton statique",
    state: "Avancé — clients sans OAuth",
    resultTitle: "Jeton de connexion créé",
    resultCopy:
      "Collez-le dans la configuration MCP de votre agent. Le jeton ne sera affiché qu’une seule fois.",
  },
  "de-DE": {
    title: "Statisches Token erstellen",
    state: "Erweitert — Clients ohne OAuth",
    resultTitle: "Verbindungstoken erstellt",
    resultCopy:
      "Füge es in die MCP-Konfiguration deines Agenten ein. Das Token wird nur einmal angezeigt.",
  },
  "pt-BR": {
    title: "Gerar um token estático",
    state: "Avançado — clientes sem OAuth",
    resultTitle: "Token de conexão criado",
    resultCopy:
      "Cole isso na configuração MCP do seu agente. O token será exibido apenas uma vez.",
  },
  "zh-CN": {
    title: "生成静态令牌",
    state: "高级设置 — 不支持 OAuth 的客户端",
    resultTitle: "连接令牌已创建",
    resultCopy: "将其粘贴到代理的 MCP 配置中。令牌只会显示一次。",
  },
  "zh-TW": {
    title: "產生靜態權杖",
    state: "進階 — 不支援 OAuth 的用戶端",
    resultTitle: "連線權杖已建立",
    resultCopy: "將其貼到代理程式的 MCP 設定中。權杖只會顯示一次。",
  },
  "ja-JP": {
    title: "静的トークンを生成",
    state: "詳細設定 — OAuth 非対応クライアント",
    resultTitle: "接続トークンを作成しました",
    resultCopy:
      "エージェントの MCP 設定に貼り付けてください。トークンは一度だけ表示されます。",
  },
  "ko-KR": {
    title: "정적 토큰 생성",
    state: "고급 설정 — OAuth를 지원하지 않는 클라이언트",
    resultTitle: "연결 토큰이 생성되었습니다",
    resultCopy:
      "에이전트의 MCP 구성에 붙여 넣으세요. 토큰은 한 번만 표시됩니다.",
  },
  "hi-IN": {
    title: "स्टैटिक टोकन बनाएँ",
    state: "उन्नत — OAuth के बिना clients",
    resultTitle: "कनेक्शन टोकन बनाया गया",
    resultCopy:
      "इसे अपने agent के MCP config में पेस्ट करें। टोकन केवल एक बार दिखाया जाता है।",
  },
  "ar-SA": {
    title: "إنشاء رمز ثابت",
    state: "متقدم — العملاء الذين لا يدعمون OAuth",
    resultTitle: "تم إنشاء رمز الاتصال",
    resultCopy:
      "الصقه في إعدادات MCP الخاصة بالوكيل. يظهر الرمز مرة واحدة فقط.",
  },
};

export function getMcpStaticTokenFallback(
  locale: LocaleCode,
): typeof MCP_STATIC_TOKEN_FALLBACK {
  return {
    ...MCP_STATIC_TOKEN_FALLBACK,
    ...MCP_STATIC_TOKEN_TRANSLATIONS[locale],
  };
}

export function interpolateMcpConnectTemplate(
  template: string,
  values: McpConnectTemplateValues,
): string {
  return template.replace(/\{(appName|appUrl|mcpUrl|serverId)\}/g, (_, key) => {
    return values[key as keyof McpConnectTemplateValues];
  });
}

/**
 * A server chooses this name before anyone has signed in, and it becomes the
 * entry's key in every client config, the label each client shows, and an
 * unquoted argument in the copyable `claude mcp add` / `codex mcp add`
 * commands, so only the identifier shape first-party server names use is
 * accepted.
 */
export const PLAIN_MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * A name the framework derives from the app id or hostname is its own guess,
 * so it is fitted to the plain shape rather than refused: a 63-character
 * hostname label is valid DNS but pushes `agent-native-<label>-preview` past
 * 64 characters. A name the developer configures is still refused.
 */
export function derivedMcpServerBaseName(
  label: string,
  environment: McpConnectEnvironment,
): string {
  const room = 64 - (environment === "production" ? 0 : environment.length + 1);
  const slug = label
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  return `agent-native-${slug || "app"}`.slice(0, room).replace(/[-_]+$/, "");
}

/**
 * Production keeps the bare name so existing client entries keep working;
 * every other environment gets its own entry instead of overwriting
 * production's in the same client.
 */
export function mcpConnectServerName(
  baseName: string,
  environment: McpConnectEnvironment,
): string {
  const name =
    environment === "production" ? baseName : `${baseName}-${environment}`;
  if (!PLAIN_MCP_SERVER_NAME.test(name)) {
    throw new Error(
      `The MCP server name ${JSON.stringify(name)} is not a plain name ` +
        `(letters, digits, "-" and "_", at most 64 characters). ` +
        `Set mcp.serverName to one.`,
    );
  }
  return name;
}

/**
 * Everything an install link may carry. There is deliberately no field for
 * headers, tokens or document data: the link lands in the person's client
 * config and in vendor URLs, and OAuth is the only auth it sets up.
 */
export interface McpInstallLinkTarget {
  serverName: string;
  mcpUrl: string;
}

export interface McpInstallLink {
  href: string;
  /**
   * Cursor's link is a web page that launches Cursor and shows the config to
   * paste when Cursor is missing, so it opens in a new tab. VS Code's web
   * redirect is a bare 302 to its scheme, so the scheme is used directly.
   */
  opensWebPage: boolean;
}

function encodeBase64(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function buildMcpInstallLink(
  client: McpInstallClient,
  target: McpInstallLinkTarget,
): McpInstallLink {
  const { serverName, mcpUrl } = target;
  if (client === "cursor") {
    const params = new URLSearchParams({
      name: serverName,
      config: encodeBase64(JSON.stringify({ url: mcpUrl })),
    });
    return {
      href: `https://cursor.com/install-mcp?${params.toString()}`,
      opensWebPage: true,
    };
  }
  const config = JSON.stringify({
    name: serverName,
    type: "http",
    url: mcpUrl,
  });
  return {
    href: `${client}:mcp/install?${encodeURIComponent(config)}`,
    opensWebPage: false,
  };
}
