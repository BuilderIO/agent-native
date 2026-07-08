/**
 * Public, unauthenticated uptime status page: `/status/<slug>`.
 *
 * SSR-first: the loader resolves the sanitized, PUBLISHED-only status view on
 * the server so crawlers and first-time visitors get real markup (framework
 * rule: public/SEO pages SSR real content). The client then lightly
 * auto-refreshes via the same `get-public-status-page` action (whitelisted in
 * server/plugins/auth.ts). Unknown or unpublished slugs render a branded 404.
 *
 * This route is rendered without the authenticated app chrome — see the
 * `/status/` public branch in app/root.tsx.
 */
import { useActionQuery } from "@agent-native/core/client";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";
import { data, useLoaderData, useParams } from "react-router";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";

import { getPublicStatusPage } from "../../server/lib/status-pages";
import type { PublicStatusPage } from "../../server/lib/status-pages";
import { PublicStatusView } from "../components/monitoring/PublicStatusView";

interface StatusLoaderData {
  slug: string;
  page: PublicStatusPage | null;
}

const FOUND_CACHE = {
  "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
};
const MISSING_CACHE = { "Cache-Control": "public, max-age=15, s-maxage=15" };

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug ?? "";
  const page = await getPublicStatusPage(slug);
  return data<StatusLoaderData>(
    { slug, page },
    { status: page ? 200 : 404, headers: page ? FOUND_CACHE : MISSING_CACHE },
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const page = loaderData?.page;
  if (!page) {
    return [
      { title: "Status page not found" }, // i18n-ignore public status page meta copy
      { name: "robots", content: "noindex" },
    ];
  }
  const description =
    page.description ||
    (page.overall === "operational"
      ? "All systems operational."
      : "Current service status.");
  return [
    { title: `${page.title} · Status` },
    { name: "description", content: description },
    { property: "og:title", content: `${page.title} · Status` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
  ];
};

function StatusNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <IconActivity className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Status page not found{/* i18n-ignore public status page fixed copy */}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This status page doesn&rsquo;t exist or hasn&rsquo;t been published
          yet.
        </p>
      </div>
    </main>
  );
}

export default function PublicStatusRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const params = useParams();
  const slug = loaderData.slug || params.slug || "";

  // SSR gives us the initial page; the client lightly polls the same public
  // action to keep the banner/uptime fresh without a manual reload.
  const query = useActionQuery<PublicStatusPage>(
    "get-public-status-page",
    { slug },
    {
      initialData: loaderData.page ?? undefined,
      enabled: Boolean(loaderData.page),
      refetchInterval: 60_000,
      staleTime: 30_000,
      retry: false,
    },
  );

  const page = useMemo(
    () => query.data ?? loaderData.page,
    [query.data, loaderData.page],
  );

  if (!page) return <StatusNotFound />;

  return <PublicStatusView page={page} refreshing={query.isFetching} />;
}
