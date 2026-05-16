import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionCapability,
  type WorkspaceConnectionCredentialKey,
  type WorkspaceConnectionProviderId,
} from "./catalog.js";

export type ProviderReaderOperation = "search" | "get" | "listRecent";

export type ProviderReaderImplementationStatus =
  | "metadata-only"
  | "template-owned"
  | "shared";

export interface ProviderReaderCapability {
  capability: WorkspaceConnectionCapability;
  label: string;
  description: string;
}

export interface ProviderReaderOperationParameter {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  required?: boolean;
  description: string;
}

export interface ProviderReaderOperationDescriptor {
  operation: ProviderReaderOperation;
  label: string;
  description: string;
  implementationStatus: ProviderReaderImplementationStatus;
  parameters: readonly ProviderReaderOperationParameter[];
}

export interface ProviderReaderDefinition {
  providerId: WorkspaceConnectionProviderId;
  label: string;
  description: string;
  implementationStatus: ProviderReaderImplementationStatus;
  credentialKeys: readonly WorkspaceConnectionCredentialKey[];
  requiredCredentialKeys: readonly string[];
  capabilities: readonly ProviderReaderCapability[];
  operations: readonly ProviderReaderOperationDescriptor[];
  notes?: string;
}

export interface ListProviderReadersOptions {
  providerId?: WorkspaceConnectionProviderId;
  capability?: WorkspaceConnectionCapability;
  operation?: ProviderReaderOperation;
  implementationStatus?: ProviderReaderImplementationStatus;
}

export function defineProviderReader<const T extends ProviderReaderDefinition>(
  reader: T,
): T {
  return reader;
}

const searchParameters = [
  {
    name: "query",
    type: "string",
    required: true,
    description: "Provider-native search text.",
  },
  {
    name: "limit",
    type: "number",
    description: "Maximum normalized results to return.",
  },
] as const satisfies readonly ProviderReaderOperationParameter[];

const getParameters = [
  {
    name: "id",
    type: "string",
    required: true,
    description: "Provider-native object identifier.",
  },
] as const satisfies readonly ProviderReaderOperationParameter[];

const listRecentParameters = [
  {
    name: "limit",
    type: "number",
    description: "Maximum recent objects to return.",
  },
] as const satisfies readonly ProviderReaderOperationParameter[];

function operation(
  operationName: ProviderReaderOperation,
  label: string,
  description: string,
  implementationStatus: ProviderReaderImplementationStatus,
  parameters: readonly ProviderReaderOperationParameter[],
): ProviderReaderOperationDescriptor {
  return {
    operation: operationName,
    label,
    description,
    implementationStatus,
    parameters,
  };
}

function providerCredentialKeys(
  providerId: WorkspaceConnectionProviderId,
): readonly WorkspaceConnectionCredentialKey[] {
  return getWorkspaceConnectionProvider(providerId)?.credentialKeys ?? [];
}

function requiredCredentialKeys(
  providerId: WorkspaceConnectionProviderId,
): readonly string[] {
  return providerCredentialKeys(providerId)
    .filter((credential) => credential.required !== false)
    .map((credential) => credential.key);
}

export const PROVIDER_READERS = [
  defineProviderReader({
    providerId: "slack",
    label: "Slack reader",
    description:
      "Normalized metadata for reading Slack messages and channel history through template-owned Slack implementations.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("slack"),
    requiredCredentialKeys: requiredCredentialKeys("slack"),
    capabilities: [
      {
        capability: "search",
        label: "Message search",
        description:
          "Search conversation history using Slack's message search semantics.",
      },
      {
        capability: "messages",
        label: "Message retrieval",
        description:
          "Read individual messages or recent channel activity when a template owns the Slack client.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search Slack messages",
        "Find Slack messages matching text and optional channel filters.",
        "template-owned",
        [
          ...searchParameters,
          {
            name: "channelId",
            type: "string",
            description: "Optional Slack channel id to narrow the search.",
          },
        ],
      ),
      operation(
        "get",
        "Get Slack message",
        "Load one Slack message by channel and timestamp/id.",
        "template-owned",
        [
          ...getParameters,
          {
            name: "channelId",
            type: "string",
            required: true,
            description: "Slack channel id containing the message.",
          },
        ],
      ),
      operation(
        "listRecent",
        "List recent Slack messages",
        "List recent messages from channels visible to the connected Slack app.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "Core only exposes the contract; templates still own Slack API calls and provider-specific pagination.",
  }),
  defineProviderReader({
    providerId: "github",
    label: "GitHub reader",
    description:
      "Normalized metadata for reading repositories, issues, pull requests, and code search results.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("github"),
    requiredCredentialKeys: requiredCredentialKeys("github"),
    capabilities: [
      {
        capability: "search",
        label: "Repository search",
        description:
          "Search GitHub issues, pull requests, repositories, code, or docs using template-owned clients.",
      },
      {
        capability: "code",
        label: "Code context",
        description:
          "Read code-oriented objects such as repositories, files, issues, and pull requests.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search GitHub",
        "Find repositories, issues, pull requests, code, or documentation matching a query.",
        "template-owned",
        [
          ...searchParameters,
          {
            name: "owner",
            type: "string",
            description: "Optional repository owner or organization filter.",
          },
          {
            name: "repo",
            type: "string",
            description: "Optional repository filter.",
          },
        ],
      ),
      operation(
        "get",
        "Get GitHub object",
        "Load one repository, issue, pull request, or file by provider-native id or URL.",
        "template-owned",
        getParameters,
      ),
      operation(
        "listRecent",
        "List recent GitHub activity",
        "List recent issues, pull requests, or repository activity visible to the connection.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "No shared Octokit client is exported from core in this spike; templates remain responsible for API calls.",
  }),
  defineProviderReader({
    providerId: "notion",
    label: "Notion reader",
    description:
      "Normalized metadata for reading Notion pages, databases, and workspace docs.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("notion"),
    requiredCredentialKeys: requiredCredentialKeys("notion"),
    capabilities: [
      {
        capability: "search",
        label: "Page search",
        description:
          "Search pages and databases shared with the Notion integration.",
      },
      {
        capability: "docs",
        label: "Document retrieval",
        description:
          "Read Notion page or database metadata through template-owned clients.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search Notion",
        "Find Notion pages or databases matching text and optional object type filters.",
        "template-owned",
        searchParameters,
      ),
      operation(
        "get",
        "Get Notion object",
        "Load one Notion page or database by id.",
        "template-owned",
        getParameters,
      ),
      operation(
        "listRecent",
        "List recent Notion objects",
        "List recently edited pages or databases visible to the integration.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "Core does not traverse Notion blocks yet; templates own page hydration and rate-limit behavior.",
  }),
  defineProviderReader({
    providerId: "hubspot",
    label: "HubSpot reader",
    description:
      "Normalized metadata for CRM object lookup through template-owned HubSpot integrations.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("hubspot"),
    requiredCredentialKeys: requiredCredentialKeys("hubspot"),
    capabilities: [
      {
        capability: "search",
        label: "CRM search",
        description:
          "Search CRM contacts, companies, deals, tickets, and engagements.",
      },
      {
        capability: "crm",
        label: "CRM retrieval",
        description:
          "Read CRM objects when a template owns HubSpot object mapping.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search HubSpot CRM",
        "Find CRM records matching text or provider-native filters.",
        "template-owned",
        [
          ...searchParameters,
          {
            name: "objectType",
            type: "string",
            description:
              "Optional HubSpot object type such as contact, company, deal, or ticket.",
          },
        ],
      ),
      operation(
        "get",
        "Get HubSpot CRM object",
        "Load one CRM record by object type and id.",
        "template-owned",
        [
          ...getParameters,
          {
            name: "objectType",
            type: "string",
            required: true,
            description:
              "HubSpot object type such as contact, company, deal, or ticket.",
          },
        ],
      ),
      operation(
        "listRecent",
        "List recent HubSpot CRM objects",
        "List recently updated CRM records visible to the private app token.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "Templates define object allow-lists and property projections; core only documents the reader shape.",
  }),
  defineProviderReader({
    providerId: "gmail",
    label: "Gmail reader",
    description:
      "Normalized metadata for mailbox search and thread/message reads through app-owned Google OAuth flows.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("gmail"),
    requiredCredentialKeys: requiredCredentialKeys("gmail"),
    capabilities: [
      {
        capability: "search",
        label: "Mailbox search",
        description: "Search Gmail messages and threads.",
      },
      {
        capability: "messages",
        label: "Mail retrieval",
        description:
          "Read Gmail messages and threads when a template owns OAuth token handling.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search Gmail",
        "Find Gmail messages or threads matching a query.",
        "template-owned",
        searchParameters,
      ),
      operation(
        "get",
        "Get Gmail message or thread",
        "Load one Gmail message or thread by provider-native id.",
        "template-owned",
        getParameters,
      ),
      operation(
        "listRecent",
        "List recent Gmail messages",
        "List recent mailbox messages visible to the connected Google account.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "This is metadata for templates with Google OAuth; core does not expose a shared Gmail network client here.",
  }),
  defineProviderReader({
    providerId: "google_drive",
    label: "Google Drive reader",
    description:
      "Normalized metadata for Drive file search and document lookup through app-owned Google OAuth flows.",
    implementationStatus: "template-owned",
    credentialKeys: providerCredentialKeys("google_drive"),
    requiredCredentialKeys: requiredCredentialKeys("google_drive"),
    capabilities: [
      {
        capability: "search",
        label: "Drive search",
        description: "Search files visible to the connected Google account.",
      },
      {
        capability: "docs",
        label: "Drive document retrieval",
        description:
          "Read file metadata or exported document content through template-owned Google clients.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search Google Drive",
        "Find Drive files matching text, MIME type, or folder filters.",
        "template-owned",
        [
          ...searchParameters,
          {
            name: "mimeType",
            type: "string",
            description: "Optional MIME type filter.",
          },
        ],
      ),
      operation(
        "get",
        "Get Google Drive file",
        "Load one Drive file by id.",
        "template-owned",
        getParameters,
      ),
      operation(
        "listRecent",
        "List recent Google Drive files",
        "List recently modified files visible to the connected Google account.",
        "template-owned",
        listRecentParameters,
      ),
    ],
    notes:
      "Templates still own file export formats, Docs/Sheets/Slides handling, and OAuth token refresh.",
  }),
  defineProviderReader({
    providerId: "generic",
    label: "Generic metadata reader",
    description:
      "Placeholder reader metadata for custom sources that expose searchable documents through a template-specific adapter.",
    implementationStatus: "metadata-only",
    credentialKeys: providerCredentialKeys("generic"),
    requiredCredentialKeys: requiredCredentialKeys("generic"),
    capabilities: [
      {
        capability: "search",
        label: "Custom search",
        description:
          "Describe a template-specific search interface for one-off sources.",
      },
      {
        capability: "docs",
        label: "Custom document retrieval",
        description:
          "Describe a template-specific document retrieval interface.",
      },
    ],
    operations: [
      operation(
        "search",
        "Search custom source",
        "Metadata-only descriptor for searching a custom source.",
        "metadata-only",
        searchParameters,
      ),
      operation(
        "get",
        "Get custom source object",
        "Metadata-only descriptor for loading one custom source object by id.",
        "metadata-only",
        getParameters,
      ),
    ],
    notes:
      "Use this only to document a template-owned adapter; core cannot execute generic provider reads.",
  }),
] as const satisfies readonly ProviderReaderDefinition[];

const READERS_BY_PROVIDER_ID = new Map<
  WorkspaceConnectionProviderId,
  ProviderReaderDefinition
>(PROVIDER_READERS.map((reader) => [reader.providerId, reader]));

export function listProviderReaders(
  options: ListProviderReadersOptions = {},
): ProviderReaderDefinition[] {
  return PROVIDER_READERS.filter((reader) => {
    if (options.providerId && reader.providerId !== options.providerId) {
      return false;
    }
    if (
      options.capability &&
      !reader.capabilities.some(
        (capability) => capability.capability === options.capability,
      )
    ) {
      return false;
    }
    if (
      options.operation &&
      !reader.operations.some(
        (operation) => operation.operation === options.operation,
      )
    ) {
      return false;
    }
    if (
      options.implementationStatus &&
      reader.implementationStatus !== options.implementationStatus
    ) {
      return false;
    }
    return true;
  }).map(cloneProviderReader);
}

export function getProviderReader(
  providerId: string,
): ProviderReaderDefinition | undefined {
  const reader = READERS_BY_PROVIDER_ID.get(
    providerId as WorkspaceConnectionProviderId,
  );
  return reader ? cloneProviderReader(reader) : undefined;
}

export function providerReaderSupports(
  providerOrReader: ProviderReaderDefinition | WorkspaceConnectionProviderId,
  operationName: ProviderReaderOperation,
): boolean {
  const reader =
    typeof providerOrReader === "string"
      ? getProviderReader(providerOrReader)
      : providerOrReader;
  return (
    reader?.operations.some(
      (operation) => operation.operation === operationName,
    ) ?? false
  );
}

function cloneProviderReader(
  reader: ProviderReaderDefinition,
): ProviderReaderDefinition {
  return {
    ...reader,
    credentialKeys: reader.credentialKeys.map((credential) => ({
      ...credential,
    })),
    requiredCredentialKeys: [...reader.requiredCredentialKeys],
    capabilities: reader.capabilities.map((capability) => ({
      ...capability,
    })),
    operations: reader.operations.map((operation) => ({
      ...operation,
      parameters: operation.parameters.map((parameter) => ({
        ...parameter,
      })),
    })),
  };
}
