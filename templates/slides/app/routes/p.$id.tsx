import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  buildAgentReadableResourceDiscovery,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import {
  toSharedDeckSlide,
  type SharedDeckResponse,
  type SharedDeckSlide,
} from "@shared/api";
import { eq } from "drizzle-orm";
import { useEffect } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import SharedPresentation from "@/pages/SharedPresentation";

import { getDb, schema } from "../../server/db";
import {
  DECK_AGENT_CONTEXT_ENDPOINT,
  DECK_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable";

type LoaderData =
  | {
      deck: SharedDeckResponse;
      error?: undefined;
      id: string;
      agentAccessToken?: string | null;
    }
  | {
      deck: null;
      error: string;
      restricted?: { id: string; basePath: string };
    };

/**
 * Loose shape of the persisted deck JSON. Each slide is `Partial` because
 * decks created across many template versions may be missing newer fields
 * (\`transition\`, \`animations\`, \`splitByParagraph\`) and older decks may also
 * lack \`id\` / \`content\`. \`toSharedDeckSlide\` validates and fills in
 * defaults at runtime; the type just documents what consumers can expect.
 */
type DeckData = {
  title?: string;
  slides?: Array<Partial<SharedDeckSlide>>;
  aspectRatio?: SharedDeckResponse["aspectRatio"];
};

function toSharedDeck(row: {
  title: string | null;
  data: string;
}): SharedDeckResponse {
  const data = JSON.parse(row.data) as DeckData;
  return {
    title: row.title || data.title || "Untitled",
    slides: Array.isArray(data.slides)
      ? data.slides.map((slide, index) => toSharedDeckSlide(slide, index))
      : [],
    aspectRatio: data.aspectRatio,
  };
}

export async function loader({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  const agentAccessToken = new URL(request.url).searchParams.get(
    AGENT_ACCESS_PARAM,
  );

  // Access is checked on the deck, not the URL shape: `/p/<id>` (presentation)
  // and `/deck/<id>` (editor) share the same rules. SSR renders impersonally (no
  // session is read server-side, so this public page can be CDN-cached for
  // everyone), so we serve only PUBLIC decks here and resolve restricted access
  // on the client. Querying by id alone distinguishes "deck does not exist"
  // (real 404) from "deck exists but isn't public" — for the latter we route the
  // viewer to the auth-guarded `/deck/<id>` editor, where the real per-user
  // access check runs (viewer-with-access sees it; everyone else gets the
  // standard sign-in / no-access handling). This never loops: `/deck` is
  // protected and never bounces back to `/p`.
  const db = getDb();
  const [deck] = await db
    .select({
      title: schema.decks.title,
      data: schema.decks.data,
      visibility: schema.decks.visibility,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, id))
    .limit(1);

  if (!deck) throw new Response("Not found", { status: 404 });
  const tokenAccess = agentAccessToken
    ? verifyScopedAgentAccessToken(agentAccessToken, {
        resourceKind: DECK_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (deck.visibility === "public" || tokenAccess) {
    return {
      deck: toSharedDeck(deck),
      id,
      agentAccessToken: tokenAccess ? agentAccessToken : null,
    };
  }
  return {
    deck: null,
    error: "restricted",
    restricted: { id, basePath: getConfiguredAppBasePath() },
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.deck?.title ?? "Shared Presentation";
  return [{ title }];
};

export default function PublicDeckRoute() {
  const data = useLoaderData<typeof loader>();
  const restricted = data.deck === null ? data.restricted : undefined;

  useEffect(() => {
    if (restricted) {
      window.location.replace(`${restricted.basePath}/deck/${restricted.id}`);
    }
  }, [restricted]);

  // Redirecting to the guarded editor to resolve per-user access client-side.
  if (restricted) return null;
  if (data.deck === null) {
    return (
      <SharedPresentation initialDeck={data.deck} initialError={data.error} />
    );
  }

  return (
    <>
      <AgentReadableDeckDiscovery
        id={data.id}
        title={data.deck.title}
        token={data.agentAccessToken}
      />
      <SharedPresentation initialDeck={data.deck} initialError={data.error} />
    </>
  );
}

function AgentReadableDeckDiscovery({
  id,
  title,
  token,
}: {
  id: string;
  title?: string;
  token?: string | null;
}) {
  const discovery = buildAgentReadableResourceDiscovery({
    resourceType: "deck",
    resourceId: id,
    title,
    path: `/p/${id}`,
    contextEndpoint: DECK_AGENT_CONTEXT_ENDPOINT,
    token,
    instructions:
      "Use contextUrl to read this shared Slides deck as JSON. Slide numbers are 1-based for users.",
  });
  return (
    <script
      type={AGENT_READABLE_RESOURCE_SCRIPT_TYPE}
      dangerouslySetInnerHTML={{ __html: safeJsonForHtml(discovery) }}
    />
  );
}
