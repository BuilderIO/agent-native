import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentLandingResult } from "@shared/content-landing";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";

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

function DocumentSkeleton() {
  return (
    <div className="flex-1 flex items-start justify-center bg-background overflow-hidden">
      <div className="w-full max-w-3xl px-12 pt-24 space-y-6">
        <Skeleton className="h-10 w-2/3" />
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

export default function IndexRoute() {
  const t = useT();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const resolveLanding = useActionMutation<
    ContentLandingResult,
    Record<string, never>
  >("resolve-content-landing");

  const openLanding = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const result = await resolveLanding.mutateAsync({});
      if (result.fallbackReason === "saved-document-unavailable") {
        toast.info(t("landing.previousPageUnavailable"));
      }
      navigate(`/page/${result.documentId}`, { replace: true });
    } catch (error) {
      // Keep the typed mutation error available to QueryErrorState. Retrying
      // starts a fresh resolver attempt rather than pretending arrival worked.
      console.error("Failed to resolve the Content landing page", error);
    }
  }, [navigate, resolveLanding, t]);

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
  return <DocumentSkeleton />;
}
