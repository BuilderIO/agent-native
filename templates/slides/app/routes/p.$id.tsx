import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
} from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  SSR_QUERY_CACHE_KEY_HEADER,
  buildAgentReadableResourceDiscovery,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useLoaderData } from "react-router";

import messages from "@/i18n/en-US";
import { PresentationLinkDeck } from "@/pages/SharedPresentation";

import { DECK_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable";

// The HTML for /p/:id is one public shell the CDN caches for every visitor:
// it carries no deck content and no access decision, so an edit or a
// visibility change shows on the next load. The page reads the deck through
// `get-presentation-deck` after it loads.
const AGENT_LINK_HEADERS = {
  "Referrer-Policy": "no-referrer",
  [SSR_QUERY_CACHE_KEY_HEADER]: "query",
};

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  // The token is echoed, not verified: the read action checks it. A link
  // that carries one gets its own cache key so it never reaches other URLs.
  const agentAccessToken = new URL(request.url).searchParams.get(
    AGENT_ACCESS_PARAM,
  );
  const payload = {
    id,
    basePath: getConfiguredAppBasePath(),
    agentAccessToken,
  };
  return agentAccessToken
    ? data(payload, { headers: AGENT_LINK_HEADERS })
    : payload;
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: `${messages.raw.routeSharedTitle} — Slides` },
];

export default function PublicDeckRoute() {
  const { id, basePath, agentAccessToken } = useLoaderData<typeof loader>();
  return (
    <>
      <AgentReadableDeckDiscovery
        id={id}
        basePath={basePath}
        token={agentAccessToken}
      />
      <PresentationLinkDeck
        key={id}
        deckId={id}
        agentAccessToken={agentAccessToken}
      />
    </>
  );
}

export function buildDeckDiscovery({
  id,
  title,
  basePath,
  token,
}: {
  id: string;
  title?: string;
  basePath?: string;
  token?: string | null;
}) {
  return buildAgentReadableResourceDiscovery({
    resourceType: "deck",
    resourceId: id,
    title,
    path: `/p/${id}`,
    contextEndpoint: DECK_AGENT_CONTEXT_ENDPOINT,
    basePath,
    token,
    instructions:
      "Use contextUrl to read this shared Slides deck as JSON. Slide numbers are 1-based for users.",
  });
}

function AgentReadableDeckDiscovery({
  id,
  title,
  basePath,
  token,
}: {
  id: string;
  title?: string;
  basePath?: string;
  token?: string | null;
}) {
  const discovery = buildDeckDiscovery({ id, title, basePath, token });
  return (
    <script
      type={AGENT_READABLE_RESOURCE_SCRIPT_TYPE}
      dangerouslySetInnerHTML={{ __html: safeJsonForHtml(discovery) }}
    />
  );
}
