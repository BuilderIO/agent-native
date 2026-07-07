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
        label: "Slack bot token",
        description:
          "Bot token with the smallest channel and history scopes needed by the template.",
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
    id: "notion",
    label: "Notion",
    description:
      "Workspace docs, wikis, pages, and databases for knowledge capture and search.",
    credentialKeys: [
      {
        key: "NOTION_API_KEY",
        label: "Notion API key",
        description:
          "Integration secret with access to the pages or databases shared with the integration.",
        required: true,
      },
    ],
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
