import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentSpaceLandingResult } from "@shared/content-landing";
import { contentRecentHref } from "@shared/content-personal-navigation";
import { useCallback, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentSpaces } from "@/hooks/use-content-spaces";

export default function ContentSpaceLandingRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { spaceId } = useParams<{ spaceId: string }>();
  const spaces = useContentSpaces();
  const resolveLanding = useActionMutation<
    ContentSpaceLandingResult,
    { spaceId: string }
  >("resolve-content-landing");
  const startedFor = useRef<string | null>(null);
  const openLanding = useCallback(async () => {
    if (!spaceId || startedFor.current === spaceId) return;
    startedFor.current = spaceId;
    try {
      const result = await resolveLanding.mutateAsync({ spaceId });
      if (!result.target) return;
      if (result.fallbackReason === "saved-document-unavailable") {
        toast.info(t("landing.previousPageUnavailable"));
      }
      void navigate(contentRecentHref(result.target), { replace: true });
    } catch (error) {
      console.error("Failed to resolve the Content space landing page", error);
    }
  }, [navigate, resolveLanding, spaceId, t]);

  useEffect(() => {
    void openLanding();
  }, [openLanding]);

  if (resolveLanding.isError || spaces.isError) {
    return (
      <QueryErrorState
        onRetry={() => {
          resolveLanding.reset();
          startedFor.current = null;
          void spaces.refetch();
          void openLanding();
        }}
        retrying={resolveLanding.isPending || spaces.isFetching}
      />
    );
  }

  if (resolveLanding.data?.resolution === "welcome-unavailable" && spaceId) {
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

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center px-6 pt-24">
      <div className="w-full max-w-2xl space-y-4">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
