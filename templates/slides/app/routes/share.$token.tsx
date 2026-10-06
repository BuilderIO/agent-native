import {
  AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  buildResourceSocialMeta,
  normalizeDocumentTitle,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import type { SharedDeckResponse } from "@shared/api";
import { summarizeSlideContent } from "@shared/deck-title";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";

import messages from "@/i18n/en-US";
import SharedPresentation from "@/pages/SharedPresentation";

type LoaderData =
  | {
      deck: SharedDeckResponse;
      error?: undefined;
      basePath: string;
      origin: string;
    }
  | { deck: null; error: string };

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appBasePathForRequest(): string {
  return normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

export async function loader({
  params,
  url: requestUrl,
}: LoaderFunctionArgs): Promise<LoaderData> {
  if (!params.token) {
    return { deck: null, error: "Token is required" };
  }

  const basePath = appBasePathForRequest();
  const url = new URL(`${basePath}/api/share/${params.token}`, requestUrl);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return {
      deck: null,
      error: data?.error || "Failed to load presentation",
    };
  }

  return {
    deck: data as SharedDeckResponse,
    basePath,
    origin: new URL(requestUrl).origin,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.deck?.title
    ? normalizeDocumentTitle(
        loaderData.deck.title,
        messages.raw.routeSharedTitle,
      )
    : messages.raw.routeSharedTitle;
  const description = summarizeSlideContent(
    loaderData?.deck?.slides[0]?.content,
  );
  return [
    { title: `${title} — Slides` },
    ...(loaderData?.deck
      ? buildResourceSocialMeta({
          title,
          description,
          origin: loaderData.origin,
          basePath: loaderData.basePath,
        })
      : []),
  ];
};

export default function SharedPresentationRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      {data.deck ? (
        <SnapshotDiscovery deck={data.deck} basePath={data.basePath} />
      ) : null}
      <SharedPresentation initialDeck={data.deck} initialError={data.error} />
    </>
  );
}

export function buildSnapshotDiscovery({
  deck,
  token,
  basePath,
}: {
  deck: SharedDeckResponse;
  token: string;
  basePath?: string;
}) {
  const normalizedBasePath = normalizeBasePath(basePath);
  return {
    type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
    resourceType: "deck-snapshot",
    resourceId: token,
    title: deck.title,
    contextUrl: `${normalizedBasePath}/api/share/${encodeURIComponent(token)}`,
    instructions:
      "Use contextUrl to read this shared Slides snapshot as JSON. This snapshot link is independent of live deck visibility.",
  };
}

function SnapshotDiscovery({
  deck,
  basePath,
}: {
  deck: SharedDeckResponse;
  basePath: string;
}) {
  const { token } = useParams<{ token: string }>();
  if (!token) return null;
  const discovery = buildSnapshotDiscovery({ deck, token, basePath });
  return (
    <script
      type={AGENT_READABLE_RESOURCE_SCRIPT_TYPE}
      dangerouslySetInnerHTML={{ __html: safeJsonForHtml(discovery) }}
    />
  );
}
