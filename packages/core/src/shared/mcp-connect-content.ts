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
  /**
   * False when `mcp.connect` is off: the identity route still answers, but
   * there is no connect page, token minting, or OAuth discovery, so a client
   * installed from a link cannot sign in.
   */
  connect: boolean;
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
  urlStep?: number;
  nameStep?: number;
  stepKinds?: readonly (
    | "open"
    | "add"
    | "configure"
    | "authorize"
    | "enable"
  )[];
  intro?: string;
  commandTemplate?: string;
  configTemplate?: string;
  action?: {
    kind: "link" | "copy";
    label: string;
    href?: string;
  };
  note?: string;
  docsHref?: string;
}

export const MCP_CONNECT_MCP_URL_TEMPLATE = "{appUrl}/mcp";

export const MCP_CONNECT_GUIDES: readonly McpConnectGuide[] = [
  {
    id: "claude",
    docsHref:
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    label: "Claude",
    urlStep: 1,
    stepKinds: ["open", "add", "authorize"],
    nameStep: 1,
    steps: [
      "In Claude, go to Customize → Connectors.",
      "Choose + Add → Add custom connector. Enter these details, then select Add.",
      "Sign in to Agent-Native and approve access. In a new Claude conversation, enable {appName} and send:",
    ],
    action: {
      kind: "link",
      label: "Open Claude → Connectors",
      href: "https://claude.ai/customize/connectors",
    },
    note: "For Team and Enterprise, an owner must first add the connector in Organization settings → Connectors.",
  },
  {
    id: "chatgpt",
    docsHref: "https://developers.openai.com/plugins/deploy/connect-chatgpt",
    label: "ChatGPT",
    urlStep: 1,
    stepKinds: ["open", "configure", "authorize"],
    nameStep: 1,
    steps: [
      "Open Plugins in ChatGPT web. Choose + → Add custom MCP server.",
      "Name the server, paste the MCP URL, choose OAuth, and select Create as a plugin.",
      "Sign in to Agent-Native, review the discovered tools, install the plugin, then select it with @ in a new conversation.",
    ],
    action: {
      kind: "link",
      label: "Open ChatGPT",
      href: "https://chatgpt.com/plugins",
    },
    note: "Account and workspace policies control custom MCP access. After tool changes, open the connection in Plugins and select Refresh.",
  },
  {
    id: "cursor",
    docsHref: "https://cursor.com/docs/mcp",
    label: "Cursor",
    install: [{ client: "cursor", label: "Add to Cursor" }],
    urlStep: 1,
    stepKinds: ["open", "configure", "authorize"],
    steps: [
      "Click Add to Cursor, then Install when Cursor asks.",
      "For manual setup, add a server with this URL in mcp.json, then manage it from Customize → MCP.",
      "When prompted, sign in with your Agent-Native account and approve the MCP scopes.",
    ],
    note: "Remote HTTP servers support OAuth. Complete sign-in before using their tools.",
  },
  {
    id: "vscode",
    docsHref:
      "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
    label: "VS Code",
    install: [
      { client: "vscode", label: "Add to VS Code" },
      { client: "vscode-insiders", label: "Add to VS Code Insiders" },
    ],
    urlStep: 1,
    stepKinds: ["open", "configure", "authorize"],
    steps: [
      "Click Add to VS Code, then Install on the server page VS Code opens.",
      "Without the button, run MCP: Add Server from the Command Palette, choose HTTP, and paste the MCP URL.",
      "When VS Code asks, allow the sign-in and approve the MCP scopes on the Agent-Native consent page.",
    ],
    note: "The tools appear in the Chat view in Agent mode.",
  },
  {
    id: "claude-code",
    docsHref: "https://code.claude.com/docs/en/mcp",
    label: "Claude Code",
    intro: "In your terminal, run:",
    commandTemplate: "claude mcp add --transport http {serverId} {mcpUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Then inside Claude Code type /mcp, choose {serverId}, and click Authenticate. Claude completes the OAuth flow itself — no static token needed.",
  },
  {
    id: "codex",
    docsHref: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
    label: "Codex CLI",
    intro: "In your terminal, run:",
    commandTemplate: "codex mcp add {serverId} --url {mcpUrl}",
    action: { kind: "copy", label: "Copy command" },
    note: "Then run codex mcp login {serverId} and sign in to Agent-Native. The CLI and desktop app share MCP configuration.",
  },
  {
    id: "grok",
    docsHref: "https://docs.x.ai/grok/connectors",
    label: "Grok",
    urlStep: 1,
    stepKinds: ["open", "configure", "enable"],
    steps: [
      "Open grok.com/connectors and choose New Connector → Custom.",
      "Paste the MCP URL and complete the requested authentication.",
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
      "This JSON configures a remote HTTP server for clients using mcpServers. Complete OAuth in your client. For clients without OAuth, use the static-token option on the connect page and follow your client’s bearer-header configuration.",
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
    label: "Codex CLI",
    aliases: ["openai codex", "codex", "codex cli"],
    guideId: "codex",
  },
  {
    id: "cowork",
    label: "Claude Cowork",
    aliases: ["claude cowork", "cowork"],
    guideId: "claude",
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

function matchingMcpConnectHosts(
  query: string,
  matches: (query: string, alias: string) => boolean = queryMatchesHostAlias,
): McpConnectHost[] {
  return MCP_CONNECT_HOSTS.map((host) => ({
    host,
    specificity: Math.max(
      0,
      ...host.aliases
        .filter((alias) => matches(query, alias))
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

export function resolveMcpConnectHostId(query: string): string | undefined {
  return matchingMcpConnectHosts(normalizeMcpConnectQuery(query))[0]?.id;
}

/**
 * The host an MCP client says it is: from the name it reported in
 * `clientInfo`, or else its User-Agent, which clients that send `clientInfo`
 * only when they connect (Codex) still send on every call. Both are the
 * client's own claim, so use the result to label its work, never to grant
 * anything. Only whole words count: a typed search may match "cur" to
 * Cursor, a reported name may not.
 */
export function resolveMcpClientHostId(
  client: { name?: string; userAgent?: string } | undefined,
): string | undefined {
  for (const reported of [client?.name, client?.userAgent]) {
    const host = matchingMcpConnectHosts(
      normalizeMcpConnectQuery(reported ?? ""),
      queryContainsTerm,
    ).at(0);
    if (host) return host.id;
  }
  return undefined;
}

/** A host's display name, such as "Claude Code", for a host id. */
export function mcpConnectHostLabel(
  id: string | null | undefined,
): string | undefined {
  return MCP_CONNECT_HOSTS.find((host) => host.id === id)?.label;
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
        "En Claude, ve a Customize → Connectors.",
        "Elige + Add → Add custom connector. Introduce estos datos y selecciona Add.",
        "Inicia sesión en Agent-Native y aprueba el acceso. En una nueva conversación de Claude, activa {appName} y envía:",
      ],
      actionLabel: "Abrir Claude → Connectors",
      note: "En Team y Enterprise, un propietario debe añadir primero el conector en Organization settings → Connectors.",
    },
    chatgpt: {
      steps: [
        "Abre Plugins en ChatGPT web. Elige + → Add custom MCP server.",
        "Nombra el servidor, pega la URL MCP, elige OAuth y selecciona Create as a plugin.",
        "Inicia sesión en Agent-Native, revisa las herramientas, instala el plugin y selecciónalo con @ en una nueva conversación.",
      ],
      actionLabel: "Abrir ChatGPT",
      note: "El acceso a MCP personalizado depende de la cuenta y del espacio de trabajo. Tras cambiar las herramientas, abre la conexión en Plugins y selecciona Refresh.",
    },
    cursor: {
      steps: [
        "Haz clic en Añadir a Cursor y luego en Install cuando Cursor lo pida.",
        "Para la configuración manual, añade un servidor con esta URL en mcp.json y gestiónalo en Customize → MCP.",
        "Cuando se te solicite, inicia sesión con tu cuenta de Agent-Native y aprueba los ámbitos de MCP.",
      ],
      installLabels: { cursor: "Añadir a Cursor" },
      note: "Los servidores HTTP remotos admiten OAuth. Inicia sesión antes de usar sus herramientas.",
    },
    vscode: {
      steps: [
        "Haz clic en Añadir a VS Code y luego en Install en la página del servidor que abre VS Code.",
        "Sin el botón, ejecuta MCP: Add Server desde la paleta de comandos, elige HTTP y pega la URL de MCP.",
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
      note: "Después ejecuta codex mcp login {serverId} e inicia sesión en Agent-Native. La CLI y la app de escritorio comparten la configuración MCP.",
    },
    grok: {
      steps: [
        "Abre grok.com/connectors y elige New Connector → Custom.",
        "Pega la URL de MCP y completa la autenticación solicitada.",
        "Activa el conector en un chat después de que Grok detecte las herramientas.",
      ],
      actionLabel: "Abrir Grok → Connectors",
      note: "Grok requiere un servidor MCP accesible públicamente. La disponibilidad y la autenticación dependen de tu plan y de la política del espacio de trabajo.",
    },
    other: {
      intro:
        "Este JSON configura un servidor HTTP remoto para clientes que usan mcpServers. Completa OAuth en tu cliente. Sin OAuth, usa la opción de token estático de la página de conexión y configura la cabecera bearer según tu cliente.",
      actionLabel: "Copiar configuración",
    },
  },
  "fr-FR": {
    claude: {
      steps: [
        "Dans Claude, allez dans Customize → Connectors.",
        "Choisissez + Add → Add custom connector. Saisissez ces informations, puis sélectionnez Add.",
        "Connectez-vous à Agent-Native et autorisez l’accès. Dans une nouvelle conversation Claude, activez {appName} et envoyez :",
      ],
      actionLabel: "Ouvrir Claude → Connectors",
      note: "Pour Team et Enterprise, un propriétaire doit d’abord ajouter le connecteur dans Organization settings → Connectors.",
    },
    chatgpt: {
      steps: [
        "Ouvrez Plugins dans ChatGPT web. Choisissez + → Add custom MCP server.",
        "Nommez le serveur, collez l’URL MCP, choisissez OAuth puis Create as a plugin.",
        "Connectez-vous à Agent-Native, vérifiez les outils, installez le plugin et sélectionnez-le avec @ dans une nouvelle conversation.",
      ],
      actionLabel: "Ouvrir ChatGPT",
      note: "Les règles du compte et de l’espace de travail contrôlent l’accès MCP personnalisé. Après modification des outils, ouvrez la connexion dans Plugins et sélectionnez Refresh.",
    },
    cursor: {
      steps: [
        "Cliquez sur Ajouter à Cursor, puis sur Install lorsque Cursor vous le demande.",
        "Pour une configuration manuelle, ajoutez un serveur avec cette URL dans mcp.json, puis gérez-le dans Customize → MCP.",
        "Lorsque vous y êtes invité, connectez-vous avec votre compte Agent-Native et approuvez les champs d’application MCP.",
      ],
      installLabels: { cursor: "Ajouter à Cursor" },
      note: "Les serveurs HTTP distants prennent en charge OAuth. Connectez-vous avant d’utiliser leurs outils.",
    },
    vscode: {
      steps: [
        "Cliquez sur Ajouter à VS Code, puis sur Install dans la page du serveur ouverte par VS Code.",
        "Sans le bouton, exécutez MCP: Add Server depuis la palette de commandes, choisissez HTTP et collez l’URL MCP.",
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
      note: "Exécutez ensuite codex mcp login {serverId} et connectez-vous à Agent-Native. La CLI et l’app de bureau partagent la configuration MCP.",
    },
    grok: {
      steps: [
        "Ouvrez grok.com/connectors et choisissez New Connector → Custom.",
        "Collez l’URL MCP et terminez l’authentification demandée.",
        "Activez le connecteur dans un chat après la découverte des outils par Grok.",
      ],
      actionLabel: "Ouvrir Grok → Connectors",
      note: "Grok exige un serveur MCP accessible publiquement. La disponibilité et l’authentification dépendent de votre forfait et de la politique de votre espace de travail.",
    },
    other: {
      intro:
        "Ce JSON configure un serveur HTTP distant pour les clients utilisant mcpServers. Effectuez OAuth dans votre client. Sans OAuth, utilisez l’option de jeton statique de la page de connexion et configurez l’en-tête bearer selon votre client.",
      actionLabel: "Copier la configuration",
    },
  },
  "de-DE": {
    claude: {
      steps: [
        "Gehe in Claude zu Customize → Connectors.",
        "Wähle + Add → Add custom connector. Gib diese Daten ein und wähle Add.",
        "Melde dich bei Agent-Native an und erlaube den Zugriff. Aktiviere {appName} in einer neuen Claude-Unterhaltung und sende:",
      ],
      actionLabel: "Claude → Connectors öffnen",
      note: "Bei Team und Enterprise muss ein Inhaber den Connector zuerst unter Organization settings → Connectors hinzufügen.",
    },
    chatgpt: {
      steps: [
        "Öffne Plugins in ChatGPT im Web. Wähle + → Add custom MCP server.",
        "Benenne den Server, füge die MCP-URL ein, wähle OAuth und dann Create as a plugin.",
        "Melde dich bei Agent-Native an, prüfe die Tools, installiere das Plugin und wähle es mit @ in einer neuen Unterhaltung.",
      ],
      actionLabel: "ChatGPT öffnen",
      note: "Konto- und Arbeitsbereichsrichtlinien steuern den Zugriff auf eigenes MCP. Öffne nach Tool-Änderungen die Verbindung unter Plugins und wähle Refresh.",
    },
    cursor: {
      steps: [
        "Klicke auf Zu Cursor hinzufügen und dann auf Install, wenn Cursor nachfragt.",
        "Füge für die manuelle Einrichtung einen Server mit dieser URL in mcp.json hinzu und verwalte ihn unter Customize → MCP.",
        "Melde dich bei der Aufforderung mit deinem Agent-Native-Konto an und genehmige die MCP-Bereiche.",
      ],
      installLabels: { cursor: "Zu Cursor hinzufügen" },
      note: "Entfernte HTTP-Server unterstützen OAuth. Melde dich an, bevor du ihre Tools nutzt.",
    },
    vscode: {
      steps: [
        "Klicke auf Zu VS Code hinzufügen und dann auf der Serverseite, die VS Code öffnet, auf Install.",
        "Ohne die Schaltfläche führst du MCP: Add Server in der Befehlspalette aus, wählst HTTP und fügst die MCP-URL ein.",
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
      note: "Führe dann codex mcp login {serverId} aus und melde dich bei Agent-Native an. CLI und Desktop-App teilen die MCP-Konfiguration.",
    },
    grok: {
      steps: [
        "Öffne grok.com/connectors und wähle New Connector → Custom.",
        "Füge die MCP-URL ein und schließe die angeforderte Authentifizierung ab.",
        "Aktiviere den Connector in einem Chat, nachdem Grok die Tools erkannt hat.",
      ],
      actionLabel: "Grok → Connectors öffnen",
      note: "Grok benötigt einen öffentlich erreichbaren MCP-Server. Verfügbarkeit und Authentifizierung hängen von deinem Tarif und den Richtlinien deines Arbeitsbereichs ab.",
    },
    other: {
      intro:
        "Dieses JSON konfiguriert einen entfernten HTTP-Server für Clients mit mcpServers. Schließe OAuth im Client ab. Ohne OAuth verwende die Option für statische Tokens auf der Verbindungsseite und konfiguriere den Bearer-Header gemäß deinem Client.",
      actionLabel: "Konfiguration kopieren",
    },
  },
  "pt-BR": {
    claude: {
      steps: [
        "No Claude, acesse Customize → Connectors.",
        "Escolha + Add → Add custom connector. Insira estes dados e selecione Add.",
        "Entre no Agent-Native e autorize o acesso. Em uma nova conversa no Claude, ative {appName} e envie:",
      ],
      actionLabel: "Abrir Claude → Connectors",
      note: "Em Team e Enterprise, um proprietário deve adicionar o conector primeiro em Organization settings → Connectors.",
    },
    chatgpt: {
      steps: [
        "Abra Plugins no ChatGPT web. Escolha + → Add custom MCP server.",
        "Nomeie o servidor, cole a URL MCP, escolha OAuth e selecione Create as a plugin.",
        "Entre no Agent-Native, revise as ferramentas, instale o plugin e selecione-o com @ em uma nova conversa.",
      ],
      actionLabel: "Abrir ChatGPT",
      note: "As políticas da conta e do espaço de trabalho controlam o acesso a MCP personalizado. Após alterar as ferramentas, abra a conexão em Plugins e selecione Refresh.",
    },
    cursor: {
      steps: [
        "Clique em Adicionar ao Cursor e depois em Install quando o Cursor pedir.",
        "Para configurar manualmente, adicione um servidor com esta URL em mcp.json e gerencie-o em Customize → MCP.",
        "Quando solicitado, entre com sua conta Agent-Native e aprove os escopos MCP.",
      ],
      installLabels: { cursor: "Adicionar ao Cursor" },
      note: "Servidores HTTP remotos aceitam OAuth. Entre antes de usar suas ferramentas.",
    },
    vscode: {
      steps: [
        "Clique em Adicionar ao VS Code e depois em Install na página do servidor que o VS Code abrir.",
        "Sem o botão, execute MCP: Add Server na paleta de comandos, escolha HTTP e cole a URL MCP.",
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
      note: "Depois execute codex mcp login {serverId} e entre no Agent-Native. A CLI e o app de desktop compartilham a configuração MCP.",
    },
    grok: {
      steps: [
        "Abra grok.com/connectors e escolha New Connector → Custom.",
        "Cole a URL MCP e conclua a autenticação solicitada.",
        "Ative o conector em um chat depois que o Grok descobrir as ferramentas.",
      ],
      actionLabel: "Abrir Grok → Connectors",
      note: "O Grok exige um servidor MCP acessível publicamente. A disponibilidade e a autenticação dependem do seu plano e da política do espaço de trabalho.",
    },
    other: {
      intro:
        "Este JSON configura um servidor HTTP remoto para clientes que usam mcpServers. Conclua o OAuth no cliente. Sem OAuth, use a opção de token estático na página de conexão e configure o cabeçalho bearer conforme seu cliente.",
      actionLabel: "Copiar configuração",
    },
  },
  "zh-CN": {
    claude: {
      steps: [
        "在 Claude 中，前往 Customize → Connectors。",
        "选择 + Add → Add custom connector。输入以下信息，然后选择 Add。",
        "登录 Agent-Native 并批准访问。在新的 Claude 对话中启用 {appName}，然后发送：",
      ],
      actionLabel: "打开 Claude → Connectors",
      note: "Team 和 Enterprise 的所有者须先在 Organization settings → Connectors 中添加连接器。",
    },
    chatgpt: {
      steps: [
        "在 ChatGPT 网页版中打开 Plugins，选择 + → Add custom MCP server。",
        "为服务器命名，粘贴MCP URL，选择 OAuth，然后选择 Create as a plugin。",
        "登录 Agent-Native，检查发现的工具，安装插件，然后在新对话中用 @ 选择它。",
      ],
      actionLabel: "打开 ChatGPT",
      note: "自定义 MCP 访问受账户和工作区策略控制。工具更改后，在 Plugins 中打开连接并选择 Refresh。",
    },
    cursor: {
      steps: [
        "点击“添加到 Cursor”，然后在 Cursor 询问时点击 Install。",
        "手动设置时，在 mcp.json 中添加使用此 URL 的服务器，然后在 Customize → MCP 中管理。",
        "出现提示时，使用 Agent-Native 账户登录并批准 MCP 权限范围。",
      ],
      installLabels: { cursor: "添加到 Cursor" },
      note: "远程 HTTP 服务器支持 OAuth。使用工具前请先登录。",
    },
    vscode: {
      steps: [
        "点击“添加到 VS Code”，然后在 VS Code 打开的服务器页面上点击 Install。",
        "如果没有该按钮，请在命令面板中运行 MCP: Add Server，选择 HTTP，然后粘贴MCP URL。",
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
      note: "然后运行 codex mcp login {serverId} 并登录 Agent-Native。CLI 和桌面应用共享 MCP 配置。",
    },
    grok: {
      steps: [
        "打开 grok.com/connectors，然后选择 New Connector → Custom。",
        "粘贴MCP URL，并完成要求的身份验证。",
        "Grok 发现工具后，在聊天中启用该连接器。",
      ],
      actionLabel: "打开 Grok → Connectors",
      note: "Grok 需要可公开访问的 MCP 服务器。连接器可用性和身份验证选项取决于你的套餐和工作区策略。",
    },
    other: {
      intro:
        "此 JSON 为使用 mcpServers 的客户端配置远程 HTTP 服务器。请在客户端完成 OAuth。不支持 OAuth 时，请使用连接页面的静态令牌选项，并按客户端要求配置 bearer 请求头。",
      actionLabel: "复制配置",
    },
  },
  "zh-TW": {
    claude: {
      steps: [
        "在 Claude 中，前往 Customize → Connectors。",
        "選取 + Add → Add custom connector。輸入以下資訊，然後選取 Add。",
        "登入 Agent-Native 並核准存取。在新的 Claude 對話中啟用 {appName}，然後傳送：",
      ],
      actionLabel: "開啟 Claude → Connectors",
      note: "Team 和 Enterprise 的擁有者須先在 Organization settings → Connectors 中新增連接器。",
    },
    chatgpt: {
      steps: [
        "在 ChatGPT 網頁版中開啟 Plugins，選擇 + → Add custom MCP server。",
        "為伺服器命名，貼上MCP URL，選擇 OAuth，再選擇 Create as a plugin。",
        "登入 Agent-Native，檢查探索到的工具，安裝外掛，然後在新對話中用 @ 選擇它。",
      ],
      actionLabel: "開啟 ChatGPT",
      note: "自訂 MCP 存取受帳戶和工作區政策控制。工具變更後，在 Plugins 中開啟連線並選擇 Refresh。",
    },
    cursor: {
      steps: [
        "按一下「新增至 Cursor」，然後在 Cursor 詢問時按一下 Install。",
        "手動設定時，在 mcp.json 中新增使用此 URL 的伺服器，再於 Customize → MCP 中管理。",
        "出現提示時，使用 Agent-Native 帳戶登入並核准 MCP 權限範圍。",
      ],
      installLabels: { cursor: "新增至 Cursor" },
      note: "遠端 HTTP 伺服器支援 OAuth。使用工具前請先登入。",
    },
    vscode: {
      steps: [
        "按一下「新增至 VS Code」，然後在 VS Code 開啟的伺服器頁面上按一下 Install。",
        "如果沒有這個按鈕，請在命令選擇區執行 MCP: Add Server，選擇 HTTP，然後貼上MCP URL。",
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
      note: "接著執行 codex mcp login {serverId} 並登入 Agent-Native。CLI 和桌面應用程式共用 MCP 設定。",
    },
    grok: {
      steps: [
        "開啟 grok.com/connectors，然後選擇 New Connector → Custom。",
        "貼上MCP URL，並完成要求的驗證。",
        "Grok 探索工具後，在聊天中啟用連接器。",
      ],
      actionLabel: "開啟 Grok → Connectors",
      note: "Grok 需要可公開連線的 MCP 伺服器。連接器可用性和驗證選項取決於你的方案和工作區政策。",
    },
    other: {
      intro:
        "此 JSON 為使用 mcpServers 的用戶端設定遠端 HTTP 伺服器。請在用戶端完成 OAuth。不支援 OAuth 時，請使用連線頁面的靜態權杖選項，並依用戶端要求設定 bearer 標頭。",
      actionLabel: "複製設定",
    },
  },
  "ja-JP": {
    claude: {
      steps: [
        "ClaudeでCustomize → Connectorsを開きます。",
        "+ Add → Add custom connectorを選びます。以下の情報を入力し、Addを選択します。",
        "Agent-Nativeにサインインしてアクセスを許可します。Claudeの新しい会話で{appName}を有効にし、次を送信します：",
      ],
      actionLabel: "Claude → Connectors を開く",
      note: "Team と Enterprise では、所有者が先に Organization settings → Connectors で接続を追加する必要があります。",
    },
    chatgpt: {
      steps: [
        "ChatGPT のウェブ版で Plugins を開き、+ → Add custom MCP server を選びます。",
        "サーバー名を入力し、MCP URL を貼り付け、OAuth、Create as a plugin の順に選びます。",
        "Agent-Native にログインし、検出されたツールを確認してプラグインをインストールし、新しい会話で @ を使って選びます。",
      ],
      actionLabel: "ChatGPT を開く",
      note: "カスタム MCP へのアクセスはアカウントとワークスペースのポリシーに従います。ツールの変更後は Plugins で接続を開き、Refresh を選びます。",
    },
    cursor: {
      steps: [
        "「Cursor に追加」をクリックし、Cursor で確認されたら Install をクリックします。",
        "手動設定では、この URL のサーバーを mcp.json に追加し、Customize → MCP で管理します。",
        "求められたら Agent-Native アカウントでサインインし、MCP スコープを承認します。",
      ],
      installLabels: { cursor: "Cursor に追加" },
      note: "リモート HTTP サーバーは OAuth に対応しています。ツールの使用前にログインしてください。",
    },
    vscode: {
      steps: [
        "「VS Code に追加」をクリックし、VS Code が開くサーバー ページで Install をクリックします。",
        "ボタンを使わない場合は、コマンド パレットで MCP: Add Server を実行し、HTTP を選んでMCP URL を貼り付けます。",
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
      note: "次に codex mcp login {serverId} を実行し、Agent-Native にログインします。CLI とデスクトップアプリは MCP 設定を共有します。",
    },
    grok: {
      steps: [
        "grok.com/connectors を開き、New Connector → Custom を選びます。",
        "MCP URL を貼り付け、要求された認証を完了します。",
        "Grok がツールを検出したら、チャットでコネクタを有効にします。",
      ],
      actionLabel: "Grok → Connectors を開く",
      note: "Grok には公開アクセス可能な MCP サーバーが必要です。コネクタの利用可否と認証方法はプランとワークスペースポリシーによります。",
    },
    other: {
      intro:
        "この JSON は mcpServers を使用するクライアントのリモート HTTP サーバーを設定します。クライアントで OAuth を完了してください。OAuth 非対応の場合は接続ページの静的トークンを使い、クライアントの仕様に従って bearer ヘッダーを設定してください。",
      actionLabel: "設定をコピー",
    },
  },
  "ko-KR": {
    claude: {
      steps: [
        "Claude에서 Customize → Connectors로 이동하세요.",
        "+ Add → Add custom connector를 선택하세요. 아래 정보를 입력하고 Add를 선택하세요.",
        "Agent-Native에 로그인하고 접근을 승인하세요. 새 Claude 대화에서 {appName}을 활성화하고 다음을 보내세요:",
      ],
      actionLabel: "Claude → Connectors 열기",
      note: "Team 및 Enterprise에서는 소유자가 먼저 Organization settings → Connectors에서 커넥터를 추가해야 합니다.",
    },
    chatgpt: {
      steps: [
        "ChatGPT 웹에서 Plugins를 열고 + → Add custom MCP server를 선택합니다.",
        "서버 이름을 입력하고 MCP URL을 붙여 넣은 뒤 OAuth와 Create as a plugin을 선택합니다.",
        "Agent-Native에 로그인하고 검색된 도구를 검토한 뒤 플러그인을 설치하고 새 대화에서 @로 선택합니다.",
      ],
      actionLabel: "ChatGPT 열기",
      note: "사용자 지정 MCP 접근은 계정 및 워크스페이스 정책에 따릅니다. 도구가 변경되면 Plugins에서 연결을 열고 Refresh를 선택합니다.",
    },
    cursor: {
      steps: [
        "Cursor에 추가를 클릭한 다음 Cursor에서 묻는 경우 Install을 클릭합니다.",
        "수동 설정은 mcp.json에 이 URL을 사용하는 서버를 추가한 뒤 Customize → MCP에서 관리합니다.",
        "메시지가 표시되면 Agent-Native 계정으로 로그인하고 MCP 범위를 승인합니다.",
      ],
      installLabels: { cursor: "Cursor에 추가" },
      note: "원격 HTTP 서버는 OAuth를 지원합니다. 도구를 사용하기 전에 로그인하세요.",
    },
    vscode: {
      steps: [
        "VS Code에 추가를 클릭한 다음 VS Code가 여는 서버 페이지에서 Install을 클릭합니다.",
        "버튼이 없다면 명령 팔레트에서 MCP: Add Server를 실행하고 HTTP를 선택한 다음 MCP URL을 붙여 넣습니다.",
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
      note: "그런 다음 codex mcp login {serverId}를 실행하고 Agent-Native에 로그인합니다. CLI와 데스크톱 앱은 MCP 설정을 공유합니다.",
    },
    grok: {
      steps: [
        "grok.com/connectors를 열고 New Connector → Custom을 선택합니다.",
        "MCP URL을 붙여 넣고 요청된 인증을 완료합니다.",
        "Grok이 도구를 검색한 후 채팅에서 커넥터를 활성화합니다.",
      ],
      actionLabel: "Grok → Connectors 열기",
      note: "Grok에는 공개적으로 접근 가능한 MCP 서버가 필요합니다. 커넥터 사용 가능 여부와 인증 옵션은 요금제와 워크스페이스 정책에 따라 달라집니다.",
    },
    other: {
      intro:
        "이 JSON은 mcpServers를 사용하는 클라이언트의 원격 HTTP 서버를 설정합니다. 클라이언트에서 OAuth를 완료하세요. OAuth 미지원 시 연결 페이지의 정적 토큰 옵션을 사용하고 클라이언트에 맞게 bearer 헤더를 설정하세요.",
      actionLabel: "구성 복사",
    },
  },
  "hi-IN": {
    claude: {
      steps: [
        "Claude में Customize → Connectors पर जाएँ।",
        "+ Add → Add custom connector चुनें। यह विवरण दर्ज करें, फिर Add चुनें।",
        "Agent-Native में साइन इन करें और पहुँच की अनुमति दें। नई Claude बातचीत में {appName} चालू करें और भेजें:",
      ],
      actionLabel: "Claude → Connectors खोलें",
      note: "Team और Enterprise में पहले मालिक को Organization settings → Connectors में कनेक्टर जोड़ना होगा।",
    },
    chatgpt: {
      steps: [
        "ChatGPT वेब में Plugins खोलें और + → Add custom MCP server चुनें।",
        "सर्वर का नाम दें, MCP URL पेस्ट करें, OAuth और फिर Create as a plugin चुनें।",
        "Agent-Native में साइन इन करें, मिले टूल देखें, प्लगइन इंस्टॉल करें और नई बातचीत में @ से चुनें।",
      ],
      actionLabel: "ChatGPT खोलें",
      note: "कस्टम MCP एक्सेस खाते और वर्कस्पेस की नीतियों पर निर्भर है। टूल बदलने के बाद Plugins में कनेक्शन खोलें और Refresh चुनें।",
    },
    cursor: {
      steps: [
        "Cursor में जोड़ें पर क्लिक करें, फिर Cursor के पूछने पर Install पर क्लिक करें।",
        "मैन्युअल सेटअप के लिए mcp.json में इस URL वाला सर्वर जोड़ें और Customize → MCP से प्रबंधित करें।",
        "पूछे जाने पर अपने Agent-Native खाते से साइन इन करें और MCP scopes को मंज़ूरी दें।",
      ],
      installLabels: { cursor: "Cursor में जोड़ें" },
      note: "रिमोट HTTP सर्वर OAuth का समर्थन करते हैं। टूल इस्तेमाल करने से पहले साइन इन करें।",
    },
    vscode: {
      steps: [
        "VS Code में जोड़ें पर क्लिक करें, फिर VS Code के खोले गए सर्वर पेज पर Install पर क्लिक करें।",
        "बटन के बिना, Command Palette से MCP: Add Server चलाएँ, HTTP चुनें और MCP URL पेस्ट करें।",
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
      note: "फिर codex mcp login {serverId} चलाएँ और Agent-Native में साइन इन करें। CLI और डेस्कटॉप ऐप की MCP सेटिंग साझा है।",
    },
    grok: {
      steps: [
        "grok.com/connectors खोलें और New Connector → Custom चुनें।",
        "MCP URL पेस्ट करें और मांगा गया authentication पूरा करें।",
        "Grok के tools खोज लेने के बाद chat में connector चालू करें।",
      ],
      actionLabel: "Grok → Connectors खोलें",
      note: "Grok को सार्वजनिक रूप से उपलब्ध MCP server चाहिए। Connector availability और authentication options आपके plan और workspace policy पर निर्भर हैं।",
    },
    other: {
      intro:
        "यह JSON mcpServers वाले क्लाइंट के लिए रिमोट HTTP सर्वर सेट करता है। क्लाइंट में OAuth पूरा करें। OAuth के बिना, कनेक्ट पेज के स्थिर टोकन विकल्प का इस्तेमाल करें और क्लाइंट के अनुसार bearer हेडर सेट करें।",
      actionLabel: "कॉन्फ़िगरेशन कॉपी करें",
    },
  },
  "ar-SA": {
    claude: {
      steps: [
        "في Claude، انتقل إلى Customize → Connectors.",
        "اختر + Add → Add custom connector. أدخل هذه التفاصيل ثم اختر Add.",
        "سجّل الدخول إلى Agent-Native ووافق على الوصول. في محادثة Claude جديدة، فعّل {appName} وأرسل:",
      ],
      actionLabel: "فتح Claude → Connectors",
      note: "في Team وEnterprise، يجب أن يضيف المالك الموصل أولاً من Organization settings → Connectors.",
    },
    chatgpt: {
      steps: [
        "افتح Plugins في ChatGPT على الويب واختر + → Add custom MCP server.",
        "سمِّ الخادم والصق عنوان MCP واختر OAuth ثم Create as a plugin.",
        "سجّل الدخول إلى Agent-Native وراجع الأدوات المكتشفة وثبّت الإضافة ثم اخترها باستخدام @ في محادثة جديدة.",
      ],
      actionLabel: "فتح ChatGPT",
      note: "تتحكم سياسات الحساب ومساحة العمل في الوصول إلى MCP المخصص. بعد تغيير الأدوات، افتح الاتصال في Plugins واختر Refresh.",
    },
    cursor: {
      steps: [
        "انقر على إضافة إلى Cursor، ثم على Install عندما يطلب Cursor ذلك.",
        "للإعداد اليدوي، أضف خادماً بهذا العنوان في mcp.json ثم أدِره من Customize → MCP.",
        "عند الطلب، سجّل الدخول بحساب Agent-Native ووافق على نطاقات MCP.",
      ],
      installLabels: { cursor: "إضافة إلى Cursor" },
      note: "تدعم خوادم HTTP البعيدة OAuth. سجّل الدخول قبل استخدام أدواتها.",
    },
    vscode: {
      steps: [
        "انقر على إضافة إلى VS Code، ثم على Install في صفحة الخادم التي يفتحها VS Code.",
        "من دون الزر، شغّل MCP: Add Server من لوحة الأوامر، واختر HTTP، والصق عنوان MCP.",
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
      note: "ثم شغّل codex mcp login {serverId} وسجّل الدخول إلى Agent-Native. تتشارك واجهة CLI وتطبيق سطح المكتب إعداد MCP.",
    },
    grok: {
      steps: [
        "افتح grok.com/connectors واختر New Connector → Custom.",
        "الصق عنوان MCP وأكمل المصادقة المطلوبة.",
        "فعّل الموصل في محادثة بعد أن يكتشف Grok الأدوات.",
      ],
      actionLabel: "فتح Grok → Connectors",
      note: "يتطلب Grok خادم MCP متاحًا للعامة. يعتمد توفر الموصل وخيارات المصادقة على خطتك وسياسة مساحة العمل.",
    },
    other: {
      intro:
        "يضبط هذا JSON خادم HTTP بعيداً للعملاء الذين يستخدمون mcpServers. أكمل OAuth في عميلك. للعملاء دون OAuth، استخدم خيار الرمز الثابت في صفحة الاتصال واضبط ترويسة bearer وفق تعليمات عميلك.",
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
 * Production keeps the bare name so existing client entries keep working;
 * every other environment puts its own name first. It must be a prefix: as a
 * suffix, beta `mail` and a production app named `mail-beta` both became
 * `agent-native-mail-beta`, and one client entry silently replaced the other.
 * No production name can start with a prefix, because derived names start
 * with `agent-native-` and a configured name may not.
 */
const MCP_ENVIRONMENT_NAME_PREFIX: Readonly<
  Record<McpConnectEnvironment, string>
> = {
  production: "",
  beta: "beta-",
  preview: "preview-",
  local: "local-",
};

function mcpLabelHash(label: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < label.length; index++) {
    const code = label.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(36).padStart(11, "0");
}

/**
 * A name the framework derives from the app id or hostname is its own guess,
 * so it is fitted to the plain shape rather than refused: a 63-character
 * hostname label is valid DNS but pushes `preview-agent-native-<label>` past
 * 64 characters. A label that already fits is used as is. Cleaning or
 * shortening one loses what told it apart (`@acme/notes` and `acme-notes`,
 * two long labels with the same start), so those names end in `__` and a
 * hash of the whole label instead. `__` marks only those names: a label that
 * contains it is fitted too, or `acme-notes__<hash>` could be spelled
 * directly and take the cleaned app's entry. A 32-bit hash was too short:
 * colliding labels could be found by brute force in seconds. A name the
 * developer configures is still refused.
 */
export function derivedMcpServerBaseName(
  label: string,
  environment: McpConnectEnvironment,
): string {
  const room = 64 - MCP_ENVIRONMENT_NAME_PREFIX[environment].length;
  const name = `agent-native-${label}`;
  if (
    label &&
    !label.includes("__") &&
    PLAIN_MCP_SERVER_NAME.test(name) &&
    name.length <= room
  ) {
    return name;
  }
  const hash = mcpLabelHash(label);
  const slug =
    label.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") ||
    "app";
  const head = `agent-native-${slug}`
    .slice(0, room - hash.length - 2)
    .replace(/-+$/, "");
  return `${head}__${hash}`;
}

export function mcpConnectServerName(
  baseName: string,
  environment: McpConnectEnvironment,
): string {
  const reserved = Object.entries(MCP_ENVIRONMENT_NAME_PREFIX).find(
    ([, prefix]) => prefix && baseName.toLowerCase().startsWith(prefix),
  );
  if (reserved) {
    throw new Error(
      `The MCP server name ${JSON.stringify(baseName)} starts with ` +
        `"${reserved[1]}", which only ${reserved[0]} deployments add, ` +
        `so it could take another app's ${reserved[0]} entry. ` +
        `Set mcp.serverName to a name without it.`,
    );
  }
  const name = `${MCP_ENVIRONMENT_NAME_PREFIX[environment]}${baseName}`;
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
