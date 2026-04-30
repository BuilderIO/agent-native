import SharedPresentation from "@/pages/SharedPresentation";
import { Spinner } from "@/components/ui/spinner";
import type { SharedDeckResponse } from "@shared/api";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

type LoaderData =
  | { deck: SharedDeckResponse; error?: undefined }
  | { deck: null; error: string };

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appBasePathForRequest(request: Request): string {
  return normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

export async function loader({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> {
  if (!params.token) {
    return { deck: null, error: "Token is required" };
  }

  const url = new URL(
    `${appBasePathForRequest(request)}/api/share/${params.token}`,
    request.url,
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
  return [{ title: "Shared Presentation" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

export default function SharedPresentationRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <SharedPresentation initialDeck={data.deck} initialError={data.error} />
  );
}
