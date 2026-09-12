import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentLandingResult } from "@shared/content-landing";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { readContentLandingRecovery } from "@/lib/content-landing";
import { useLastLocationTitleHint } from "@/hooks/use-optimistic-document-title";
import {
  landingOptimisticTitle,
  stashLandingTitleHint,
} from "@/lib/document-title-hint";

const SEO_TITLE = "Content - Open Source, agent-friendly Obsidian alternative";
const SEO_DESCRIPTION =
  "Open Source MDX editor for local docs, knowledge bases, and content systems, with custom blocks and agent-assisted editing.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

function DocumentSkeleton({ title }: { title?: string | null }) {
  return (
    <div className="flex-1 flex items-start justify-center bg-background overflow-hidden">
      <div className="w-full max-w-3xl px-12 pt-24 space-y-6">
        {title ? (
          <div className="block w-full break-words bg-transparent p-0 font-bold leading-tight text-foreground text-3xl md:text-4xl">
            {title}
          </div>
        ) : (
          <Skeleton className="h-10 w-2/3" />
        )}
        <div className="space-y-3 pt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="space-y-3 pt-6">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </div>
  );
}

export default function HomeRoute() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const lastLocationHint = useLastLocationTitleHint();
  const lastLocationHintRef = useRef(lastLocationHint);
  lastLocationHintRef.current = lastLocationHint;
  const recoveredDocumentId =
    readContentLandingRecovery(location.state)?.unavailableDocumentId ?? null;
  const resolveLanding = useActionMutation<
    ContentLandingResult,
    Record<string, never>
  >("resolve-content-landing");

  const openLanding = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const result = await resolveLanding.mutateAsync({});
      if (recoveredDocumentId) {
        toast.info(t("landing.requestedPageUnavailable"));
      } else if (result.fallbackReason === "saved-document-unavailable") {
        toast.info(t("landing.previousPageUnavailable"));
      }
      // Hand the known title to the editor skeleton only when the resolver
      // confirmed it for this exact page; a fallback keeps the title hidden.
      const hint = lastLocationHintRef.current;
      stashLandingTitleHint(
        hint && hint.documentId === result.documentId ? hint : null,
      );
      void navigate(
        {
          pathname: `/page/${result.documentId}`,
          search: location.search,
          hash: location.hash,
        },
        { replace: true },
      );
    } catch (error) {
      // Keep the typed mutation error available to QueryErrorState. Retrying
      // starts a fresh resolver attempt rather than pretending arrival worked.
      console.error("Failed to resolve the Content landing page", error);
    }
  }, [
    location.hash,
    location.search,
    navigate,
    recoveredDocumentId,
    resolveLanding,
    t,
  ]);

  useEffect(() => {
    void openLanding();
  }, [openLanding]);

  if (resolveLanding.isError) {
    return (
      <QueryErrorState
        onRetry={() => {
          resolveLanding.reset();
          startedRef.current = false;
          void openLanding();
        }}
        retrying={resolveLanding.isPending}
      />
    );
  }
  return (
    <DocumentSkeleton title={landingOptimisticTitle(null, lastLocationHint)} />
  );
}
