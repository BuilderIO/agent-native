import type { SharedDeckResponse } from "@shared/api";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import messages from "@/i18n/en-US";
import SharedPresentation from "@/pages/SharedPresentation";

type LoaderData =
  | { deck: SharedDeckResponse; error?: undefined }
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

  const url = new URL(
    `${appBasePathForRequest()}/api/share/${params.token}`,
    requestUrl,
  );
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return {
      deck: null,
      error: data?.error || "Failed to load presentation",
    };
  }

  return { deck: data as SharedDeckResponse };
}

export function meta() {
  return [{ title: messages.raw.routeSharedTitle }];
}

export default function SharedPresentationRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <SharedPresentation initialDeck={data.deck} initialError={data.error} />
  );
}
