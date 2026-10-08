import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  SSR_QUERY_CACHE_KEY_HEADER,
  buildResourceSocialMeta,
  buildAgentReadableResourceDiscovery,
  normalizeDocumentTitle,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import {
  toSharedDeckSlide,
  type SharedDeckResponse,
  type SharedDeckSlide,
} from "@shared/api";
import { summarizeSlideContent } from "@shared/deck-title";
import { eq } from "drizzle-orm";
import { useEffect } from "react";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useLoaderData } from "react-router";

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
      basePath: string;
      origin: string;
      isPublic: boolean;
      agentAccessToken?: string | null;
    }
  | {
      deck: null;
      error: string;
      restricted?: { id: string; basePath: string };
    };

type DeckData = {
  title?: string;
  slides?: Array<Partial<SharedDeckSlide>>;
  aspectRatio?: SharedDeckResponse["aspectRatio"];
};

const PRIVATE_AGENT_DECK_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
  [SSR_QUERY_CACHE_KEY_HEADER]: "query",
};

function publicDeckLoaderData(payload: LoaderData, privateAgentAccess = false) {
  if (!privateAgentAccess) return payload;
  return data(payload, {
    headers: PRIVATE_AGENT_DECK_HEADERS,
  });
}

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

function toSharedDeck(row: {
  title: string | null;
  data: string;
}): SharedDeckResponse {
  const data = JSON.parse(row.data) as DeckData;
  return {
    title: row.title || data.title || "Untitled",
    slides: Array.isArray(data.slides)
      ? data.slides.map((slide, index) =>
          toSharedDeckSlide(slide, index, { includeNotes: false }),
        )
      : [],
    aspectRatio: data.aspectRatio,
  };
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  const agentAccessToken = new URL(request.url).searchParams.get(
    AGENT_ACCESS_PARAM,
  );
  const basePath = getConfiguredAppBasePath();

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
    return publicDeckLoaderData(
      {
        deck: toSharedDeck(deck),
        id,
        basePath,
        origin: new URL(request.url).origin,
        isPublic: deck.visibility === "public",
        agentAccessToken: tokenAccess ? agentAccessToken : null,
      },
      tokenAccess,
    );
  }
  return publicDeckLoaderData({
    deck: null,
    error: "restricted",
    restricted: { id, basePath },
  });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const socialTitle = loaderData?.deck?.title
    ? normalizeDocumentTitle(loaderData.deck.title, "Shared Presentation")
    : "Shared Presentation";
  const description = summarizeSlideContent(
    loaderData?.deck?.slides[0]?.content,
  );
  return [
    { title: `${socialTitle} — Slides` },
    ...(loaderData?.deck && loaderData.isPublic
      ? buildResourceSocialMeta({
          title: socialTitle,
          description,
          origin: loaderData.origin,
          basePath: loaderData.basePath,
        })
      : []),
  ];
};

export default function PublicDeckRoute() {
  const data = useLoaderData<typeof loader>();
  const restricted = data.deck === null ? data.restricted : undefined;

  useEffect(() => {
    if (restricted) {
      window.location.replace(`${restricted.basePath}/deck/${restricted.id}`);
    }
  }, [restricted]);

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
        basePath={data.basePath}
        token={data.agentAccessToken}
      />
      <SharedPresentation initialDeck={data.deck} initialError={data.error} />
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
