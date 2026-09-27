import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentLandingResult,
  ContentSpaceLandingResult,
} from "@shared/content-landing";
import { contentRecentHref } from "@shared/content-personal-navigation";
import { useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useLastLocationTitleHint } from "@/hooks/use-optimistic-document-title";
import { readContentLandingRecovery } from "@/lib/content-landing";
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

function WorkspaceWelcomeUnavailable({ spaceId }: { spaceId: string }) {
  const t = useT();
  const spaces = useContentSpaces();

  if (spaces.isError) {
    return (
      <QueryErrorState
        onRetry={() => void spaces.refetch()}
        retrying={spaces.isFetching}
      />
    );
  }

  const space = spaces.data?.spaces.find(
    (candidate) => candidate.id === spaceId,
  );
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-medium">
          {t("landing.workspaceWelcomeUnavailableTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("landing.workspaceWelcomeUnavailableDescription")}
        </p>
        {space ? (
          <Button asChild variant="outline" className="mt-5">
            <Link to={`/page/${space.filesDocumentId}`}>
              {t("sidebar.seeAllFiles")}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function HomeRoute() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const spaceId = searchParams.get("spaceId");
  const startedFor = useRef<string | null>(null);
  const landingRequestIdRef = useRef(0);
  const lastLocationHint = useLastLocationTitleHint();
  const lastLocationHintRef = useRef(lastLocationHint);
  lastLocationHintRef.current = lastLocationHint;
  const recoveredDocumentId =
    readContentLandingRecovery(location.state)?.unavailableDocumentId ?? null;
  const resolveLanding = useActionMutation<
    ContentLandingResult | ContentSpaceLandingResult,
    { spaceId?: string }
  >("resolve-content-landing");

  const openLanding = useCallback(async () => {
    const requestKey = spaceId ?? "personal";
    if (startedFor.current === requestKey) return;
    startedFor.current = requestKey;
    const requestId = ++landingRequestIdRef.current;
    try {
      const result = await resolveLanding.mutateAsync(
        spaceId ? { spaceId } : {},
      );
      if (requestId !== landingRequestIdRef.current) return;
      if ("target" in result) {
        if (!result.target) return;
        if (result.fallbackReason === "saved-document-unavailable") {
          toast.info(t("landing.previousPageUnavailable"));
        }
        void navigate(contentRecentHref(result.target), { replace: true });
        return;
      }
      if (recoveredDocumentId) {
        toast.info(t("landing.requestedPageUnavailable"));
      } else if (result.fallbackReason === "saved-document-unavailable") {
        toast.info(t("landing.previousPageUnavailable"));
      }
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
      console.error("Failed to resolve the Content landing page", error);
    }
  }, [
    location.hash,
    location.search,
    navigate,
    recoveredDocumentId,
    resolveLanding,
    spaceId,
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
          startedFor.current = null;
          void openLanding();
        }}
        retrying={resolveLanding.isPending}
      />
    );
  }
  if (
    spaceId &&
    resolveLanding.data &&
    "target" in resolveLanding.data &&
    resolveLanding.data.resolution === "welcome-unavailable"
  ) {
    return <WorkspaceWelcomeUnavailable spaceId={spaceId} />;
  }
  return (
    <DocumentSkeleton title={landingOptimisticTitle(null, lastLocationHint)} />
  );
}
