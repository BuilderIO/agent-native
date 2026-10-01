import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentLandingResult,
  ContentSpaceLandingResult,
} from "@shared/content-landing";
import { contentRecentHref } from "@shared/content-personal-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Link,
  PrefetchPageLinks,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { Header } from "@/components/layout/Header";
import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { invalidateContentDatabaseNavigationQueries } from "@/hooks/use-content-database";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import {
  LIST_DOCUMENTS_QUERY_KEY,
  startPageOpenDocumentReads,
} from "@/hooks/use-documents";
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

// The landing draws the page placeholder, so a page that opens here keeps its
// title and body where they were. Anything else gets the app header back.
function HomeMessage({ children }: { children: ReactNode }) {
  const sidebarTrigger = useSidebarTrigger();
  return (
    <>
      <Header sidebarTrigger={sidebarTrigger} />
      {children}
    </>
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
  const queryClient = useQueryClient();
  // The personal landing restores the last page visited, which the hint
  // already names, so that page's reads start while the landing validates it.
  const likelyDocumentId =
    !spaceId && !recoveredDocumentId
      ? (lastLocationHint?.documentId ?? null)
      : null;
  useEffect(() => {
    if (!likelyDocumentId) return;
    const search = new URLSearchParams(location.search);
    startPageOpenDocumentReads(queryClient, likelyDocumentId, {
      databaseId: search.get("databaseId"),
      databaseDocumentId: search.get("databaseDocumentId"),
    });
  }, [likelyDocumentId, location.search, queryClient]);
  const resolveLanding = useActionMutation<
    ContentLandingResult | ContentSpaceLandingResult,
    { spaceId?: string }
  >("resolve-content-landing", {
    // Refreshing every read here aborts and restarts the startup reads; only
    // a newly created Welcome page changes what other queries show.
    skipActionQueryInvalidation: true,
    onSuccess: (result) => {
      if (!("welcomeCreated" in result) || !result.welcomeCreated) return;
      invalidateContentDatabaseNavigationQueries(queryClient, {
        parentId: null,
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-recent"],
      });
      void queryClient.invalidateQueries({
        queryKey: LIST_DOCUMENTS_QUERY_KEY,
      });
    },
  });

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
      <HomeMessage>
        <QueryErrorState
          onRetry={() => {
            resolveLanding.reset();
            startedFor.current = null;
            void openLanding();
          }}
          retrying={resolveLanding.isPending}
        />
      </HomeMessage>
    );
  }
  if (
    spaceId &&
    resolveLanding.data &&
    "target" in resolveLanding.data &&
    resolveLanding.data.resolution === "welcome-unavailable"
  ) {
    return (
      <HomeMessage>
        <WorkspaceWelcomeUnavailable spaceId={spaceId} />
      </HomeMessage>
    );
  }
  return (
    <>
      <PrefetchPageLinks page={`/page/${likelyDocumentId ?? "home"}`} />
      <DocumentEditorSkeleton
        title={
          lastLocationHint === undefined
            ? undefined
            : landingOptimisticTitle(null, lastLocationHint)
        }
      />
    </>
  );
}
