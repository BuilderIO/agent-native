import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  buildResourceSocialMeta,
  buildAgentReadableResourceDiscovery,
  normalizeDocumentTitle,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import { summarizeSlideContent } from "@shared/deck-title";
import { and, eq } from "drizzle-orm";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useLoaderData } from "react-router";

import SharedPresentation from "@/pages/SharedPresentation";

import { getDb, schema } from "../../server/db";
import { toSharedDeck } from "../../server/lib/shared-deck";
import { DECK_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable";

export function headers({ loaderHeaders }: HeadersArgs) {
  const headers = new Headers(loaderHeaders);
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  const basePath = getConfiguredAppBasePath();

  const db = getDb();
  const [deckAccess] = await db
    .select({
      id: schema.decks.id,
      visibility: schema.decks.visibility,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, id))
    .limit(1);

  if (!deckAccess) throw new Response("Not found", { status: 404 });
  if (deckAccess.visibility !== "public") {
    return { deck: null, error: "restricted", restricted: { id, basePath } };
  }

  const [deck] = await db
    .select({ title: schema.decks.title, data: schema.decks.data })
    .from(schema.decks)
    .where(and(eq(schema.decks.id, id), eq(schema.decks.visibility, "public")))
    .limit(1);

  if (!deck) {
    return { deck: null, error: "restricted", restricted: { id, basePath } };
  }
  return {
    deck: toSharedDeck(deck),
    id,
    basePath,
    origin: new URL(request.url).origin,
    isPublic: true,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const socialTitle = loaderData?.deck?.title
    ? normalizeDocumentTitle(loaderData.deck.title, "Shared Presentation")
    : "Shared Presentation";
  const description = summarizeSlideContent(
    loaderData?.deck?.slides[0]?.content,
  );
  return [
    { title: `${socialTitle} — Slides 2` },
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
  const [agentAccess, setAgentAccess] = useState<{
    deckId: string;
    token: string;
  } | null>(null);
  const agentAccessRef = useRef<{ deckId: string; token: string } | null>(null);
  const authorizedAgentAccess =
    restricted && agentAccess && agentAccess.deckId === restricted.id
      ? { ...agentAccess, basePath: restricted.basePath }
      : null;

  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    let token = url.searchParams.get("agent_access");
    if (token !== null) {
      url.searchParams.delete("agent_access");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    if (!restricted) return;
    token ??=
      agentAccessRef.current?.deckId === restricted.id
        ? agentAccessRef.current.token
        : null;
    if (token) {
      agentAccessRef.current = { deckId: restricted.id, token };
      setAgentAccess(agentAccessRef.current);
      return;
    }
    window.location.replace(`${restricted.basePath}/deck/${restricted.id}`);
  }, [restricted]);

  return (
    <>
      {data.deck ? (
        <AgentReadableDeckDiscovery
          id={data.id}
          title={data.deck.title}
          basePath={data.basePath}
        />
      ) : authorizedAgentAccess ? (
        <AgentReadableDeckDiscovery
          id={authorizedAgentAccess.deckId}
          basePath={authorizedAgentAccess.basePath}
          token={authorizedAgentAccess.token}
        />
      ) : null}
      <SharedPresentation
        initialDeck={data.deck}
        sourceDeckId={data.deck ? data.id : undefined}
        initialError={data.deck ? data.error : undefined}
        agentAccessDeckId={restricted?.id}
        agentAccessToken={authorizedAgentAccess?.token ?? null}
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
  token = null,
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
