export type WorkspaceConnectionCapability =
  | "search"
  | "import"
  | "messages"
  | "meetings"
  | "crm"
  | "code"
  | "docs";

export type WorkspaceConnectionTemplateUse =
  | "analytics"
  | "brain"
  | "calendar"
  | "clips"
  | "content"
  | "design"
  | "dispatch"
  | "forms"
  | "mail"
  | "slides";

export type WorkspaceConnectionProviderId =
  | "slack"
  | "github"
  | "figma"
  | "notion"
  | "gmail"
  | "google_drive"
  | "hubspot"
  | "granola"
  | "clips"
  | "generic";

export interface WorkspaceConnectionCredentialKey {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface WorkspaceConnectionProvider {
  id: WorkspaceConnectionProviderId;
  label: string;
  description: string;
  credentialKeys: readonly WorkspaceConnectionCredentialKey[];
  capabilities: readonly WorkspaceConnectionCapability[];
  recommendedTemplateUses: readonly WorkspaceConnectionTemplateUse[];
  oauth?: {
    provider: string;
    authorizationUrl: string;
    tokenUrl: string;
    refreshUrl?: string;
    scopes: readonly string[];
  };
}

export interface ListWorkspaceConnectionProvidersOptions {
  capability?: WorkspaceConnectionCapability;
  templateUse?: WorkspaceConnectionTemplateUse;
}

export function defineWorkspaceConnectionProvider<
  const T extends WorkspaceConnectionProvider,
>(provider: T): T {
  return provider;
}

export const WORKSPACE_CONNECTION_PROVIDERS = [
  defineWorkspaceConnectionProvider({
    id: "slack",
    label: "Slack",
    description:
      "Workspace conversations and channel history for company memory, support workflows, and messaging automations.",
    credentialKeys: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Slack bot token (legacy)",
        description:
          "Legacy single-workspace fallback. For new messaging automations, connect Slack from Settings → Messaging instead.",
        required: true,
      },
    ],
    capabilities: ["search", "import", "messages"],
    recommendedTemplateUses: ["brain", "dispatch", "analytics"],
  }),
  defineWorkspaceConnectionProvider({
    id: "github",
    label: "GitHub",
    description:
      "Repository, issue, pull request, and code context for product memory, engineering workflows, and analytics.",
    credentialKeys: [
      {
        key: "GITHUB_TOKEN",
        label: "GitHub token",
        description:
          "Fine-grained token or app credential scoped to the repositories the workspace should access.",
        required: true,
      },
    ],
    capabilities: ["search", "import", "code", "docs"],
    recommendedTemplateUses: ["brain", "analytics", "dispatch"],
  }),
  defineWorkspaceConnectionProvider({
    id: "figma",
    label: "Figma",
    description:
      "Design files, frames, components, rendered previews, and library context for creative workflows.",
    credentialKeys: [
      {
        key: "FIGMA_ACCESS_TOKEN",
        label: "Figma personal access token (fallback)",
        description:
          "Optional fallback for local or individual use. Workspace OAuth is preferred.",
        required: false,
      },
    ],
    oauth: {
      provider: "figma",
      authorizationUrl: "https://www.figma.com/oauth",
      tokenUrl: "https://api.figma.com/v1/oauth/token",
      refreshUrl: "https://api.figma.com/v1/oauth/token",
      scopes: [
        "current_user:read",
        "file_content:read",
        "file_metadata:read",
        "projects:read",
      ],
    },
    capabilities: ["search", "import", "docs"],
    recommendedTemplateUses: ["brain", "design", "slides", "content"],
  }),
  defineWorkspaceConnectionProvider({
    id: "notion",
    label: "Notion",
    description:
      "Workspace docs, wikis, pages, and databases for knowledge capture and search.",
    credentialKeys: [],
    oauth: {
      provider: "notion",
      authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      refreshUrl: "https://api.notion.com/v1/oauth/token",
      scopes: [],
    },
    capabilities: ["search", "import", "docs"],
    recommendedTemplateUses: ["brain", "content", "dispatch"],
  }),
  defineWorkspaceConnectionProvider({
    id: "gmail",
    label: "Gmail",
    description:
      "Mailbox messages and threads for search, triage, customer context, and agent replies.",
    credentialKeys: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "Google OAuth client ID",
        required: true,
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "Google OAuth client secret",
        required: true,
      },
    ],
    capabilities: ["search", "import", "messages"],
    recommendedTemplateUses: ["mail", "brain", "dispatch"],
  }),
  defineWorkspaceConnectionProvider({
    id: "google_drive",
    label: "Google Drive",
    description:
      "Drive files, Docs, Sheets, and Slides for document search and import workflows.",
    credentialKeys: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "Google OAuth client ID",
        required: true,
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "Google OAuth client secret",
        required: true,
      },
    ],
    capabilities: ["search", "import", "docs"],
    recommendedTemplateUses: ["brain", "content", "slides", "dispatch"],
    oauth: {
      provider: "google",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    },
  }),
  defineWorkspaceConnectionProvider({
    id: "hubspot",
    label: "HubSpot",
    description:
      "CRM records, companies, contacts, deals, and engagement history for customer-aware apps.",
    credentialKeys: [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        description:
          "Private app token scoped to the CRM objects the workspace needs.",
        required: true,
      },
    ],
    capabilities: ["search", "import", "crm"],
    recommendedTemplateUses: ["analytics", "brain", "mail", "dispatch"],
  }),
  defineWorkspaceConnectionProvider({
    id: "granola",
    label: "Granola",
    description:
      "Meeting notes and transcripts for company memory and follow-up workflows.",
    credentialKeys: [
      {
        key: "GRANOLA_API_KEY",
        label: "Granola API key",
        description:
          "API key for accessible team notes; templates should respect Granola's workspace visibility.",
        required: true,
      },
    ],
    capabilities: ["search", "import", "meetings", "docs"],
    recommendedTemplateUses: ["brain", "calendar", "dispatch"],
  }),
  defineWorkspaceConnectionProvider({
    id: "clips",
    label: "Clips",
    description:
      "Agent-native Clips exports and recordings for transcript import and searchable meeting context.",
    credentialKeys: [],
    capabilities: ["search", "import", "meetings"],
    recommendedTemplateUses: ["brain", "clips"],
  }),
  defineWorkspaceConnectionProvider({
    id: "generic",
    label: "Generic",
    description:
      "Custom webhooks, CSV exports, transcript drops, and one-off sources that do not need a first-class provider yet.",
    credentialKeys: [],
    capabilities: ["search", "import", "docs"],
    recommendedTemplateUses: [
      "brain",
      "analytics",
      "content",
      "dispatch",
      "forms",
    ],
  }),
] as const satisfies readonly WorkspaceConnectionProvider[];

const PROVIDERS_BY_ID = new Map<
  WorkspaceConnectionProviderId,
  WorkspaceConnectionProvider
>(WORKSPACE_CONNECTION_PROVIDERS.map((provider) => [provider.id, provider]));

export function listWorkspaceConnectionProviders(
  options: ListWorkspaceConnectionProvidersOptions = {},
): WorkspaceConnectionProvider[] {
  return WORKSPACE_CONNECTION_PROVIDERS.filter((provider) => {
    if (
      options.capability &&
      !includesWorkspaceConnectionCapability(
        provider.capabilities,
        options.capability,
      )
    ) {
      return false;
    }
    if (
      options.templateUse &&
      !includesWorkspaceConnectionTemplateUse(
        provider.recommendedTemplateUses,
        options.templateUse,
      )
    ) {
      return false;
    }
    return true;
  }).map((provider) => ({ ...provider }));
}

export function getWorkspaceConnectionProvider(
  id: string,
): WorkspaceConnectionProvider | undefined {
  const provider = PROVIDERS_BY_ID.get(id as WorkspaceConnectionProviderId);
  return provider ? { ...provider } : undefined;
}

export function isWorkspaceConnectionProviderId(
  id: string,
): id is WorkspaceConnectionProviderId {
  return PROVIDERS_BY_ID.has(id as WorkspaceConnectionProviderId);
}

export function listWorkspaceConnectionProvidersForTemplate(
  templateUse: WorkspaceConnectionTemplateUse,
): WorkspaceConnectionProvider[] {
  return listWorkspaceConnectionProviders({ templateUse });
}

export function listWorkspaceConnectionProvidersForCapability(
  capability: WorkspaceConnectionCapability,
): WorkspaceConnectionProvider[] {
  return listWorkspaceConnectionProviders({ capability });
}

export function workspaceConnectionProviderSupports(
  providerOrId: WorkspaceConnectionProvider | string,
  capability: WorkspaceConnectionCapability,
): boolean {
  const provider =
    typeof providerOrId === "string"
      ? getWorkspaceConnectionProvider(providerOrId)
      : providerOrId;
  return provider?.capabilities.includes(capability) ?? false;
}

function includesWorkspaceConnectionCapability(
  capabilities: readonly WorkspaceConnectionCapability[],
  capability: WorkspaceConnectionCapability,
): boolean {
  return capabilities.includes(capability);
}

function includesWorkspaceConnectionTemplateUse(
  templateUses: readonly WorkspaceConnectionTemplateUse[],
  templateUse: WorkspaceConnectionTemplateUse,
): boolean {
  return templateUses.includes(templateUse);
}
