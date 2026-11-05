import type { OperationDefinitionInput } from "../operations.js";

// Providers with a provider-API runtime and a connection check in Factory. A
// provider outside this list would read as "not connected" for ever.
const PROVIDERS = [
  "slack",
  "github",
  "hubspot",
  "gong",
  "pylon",
  "stripe",
  "posthog",
  "bigquery",
  "jira",
  "notion",
  "sentry",
] as const;

// Names core fills from the provider's connection, which a typed path may keep
// as a whole segment. generic.spec.ts checks them against core's catalog.
const CONNECTION_PLACEHOLDERS: Readonly<
  Partial<Record<string, readonly string[]>>
> = {
  posthog: ["projectId"],
  bigquery: ["projectId"],
  sentry: ["orgSlug"],
};

const DESCRIPTION =
  "Reads any endpoint of a connected provider with a GET, for when no other step covers it. Type the path on the provider's own API, such as repos/acme/web/issues, with optional query parameters and headers. It only reads: no body, no writes, and a full URL is refused because the host comes from the connection. Find a path with provider-api-docs or the examples from provider-api-catalog. The answer is the provider's own JSON. Past about 33,000 characters it is cut and says so first: truncated: true and cuts (each list shortened, kept of of; a cut list arrives as {truncated, count, totalAvailable, cuts, value}). One step may hand on about 64 KB across all its items, earlier answers included, so for lists or big objects set Fields to keep; paths that match nothing are named in fieldsMissing. A model is never given this step as an AI tool.";

function apiRequest(provider: string): OperationDefinitionInput {
  const placeholders = CONNECTION_PLACEHOLDERS[provider];
  return {
    id: `${provider}.apiRequest`,
    provider,
    label: "API request",
    description: DESCRIPTION,
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      {
        name: "path",
        type: "string",
        required: true,
        label: "Path",
        description: `Endpoint path below the provider's base URL (provider-api-catalog shows it), such as repos/acme/web/issues. No host, no ? or # (use query).${placeholders ? ` {${placeholders.join("} and {")}} is filled from the connection.` : ""}`,
      },
      {
        name: "query",
        type: "json",
        label: "Query parameters",
        description:
          'Object of name to text, number, true/false or a list (repeats the name), such as {"state": "open", "per_page": 50}.',
      },
      {
        name: "headers",
        type: "json",
        label: "Headers",
        description:
          'Object of header name to text, such as {"X-Request-Id": "nightly"}. Authorization, cookies and token, secret or api-key headers are refused: the connection signs the request.',
      },
      {
        name: "authentication",
        type: "enum",
        enum: ["provider", "none"],
        default: "provider",
        label: "Authentication",
        description:
          "provider sends the connected credential; none sends none, for a public endpoint.",
      },
      {
        name: "timeoutSeconds",
        type: "number",
        label: "Timeout (seconds)",
        description: "Give up after 1 to 60 seconds. Default 60.",
      },
      {
        name: "pagination",
        type: "json",
        label: "Pagination",
        description:
          "Follow a cursor: {cursorPath (next cursor in the response), cursorParam (query name that sends it back), itemsPath?, maxPages? 1-5, default 3}. Answers {items, pagesRead, moreAvailable, nextCursor}.",
      },
      {
        name: "includeStatus",
        type: "boolean",
        default: false,
        label: "Include status and headers",
        description:
          "true answers {status, headers, body}; headers are content-type, link, etag, date, retry-after, x-ratelimit-*. Not with pagination.",
      },
      {
        name: "fieldsToKeep",
        type: "json",
        label: "Fields to keep",
        description:
          'Dotted paths to pass on, for lists or big answers, such as ["number", "title", "user.login"].',
      },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/{path}",
      freeForm: {
        path: "path",
        query: "query",
        headers: "headers",
        auth: "authentication",
        timeoutSeconds: "timeoutSeconds",
        pagination: "pagination",
        includeStatus: "includeStatus",
        fieldsToKeep: "fieldsToKeep",
        ...(placeholders ? { placeholders: [...placeholders] } : {}),
      },
    },
    credential: { provider },
  };
}

export const genericOperations: OperationDefinitionInput[] =
  PROVIDERS.map(apiRequest);
