import {
  ShareButton,
  callAction,
  useActionMutation,
  useChangeVersions,
  useT,
} from "@agent-native/core/client";
import { useSendToAgentChat } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconRefresh,
  IconTrash,
  IconClock,
  IconArrowLeft,
  IconBuilding,
  IconDatabase,
  IconLock,
  IconWorld,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams } from "react-router";
import { Link, useNavigate } from "react-router";

import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";
import Markdown from "@/components/Markdown";
import { incrementItemView } from "@/lib/item-popularity";
import {
  analysisDetailPrefetchKey,
  type PrefetchSnapshot,
} from "@/lib/prefetch-keys";
import {
  resourceCanEdit,
  resourceCanManage,
  type ResourceAccess,
} from "@/lib/resource-access";
import { cn } from "@/lib/utils";

import LegacyFusionAnalysis, {
  isLegacyFusionAnalysis,
} from "./LegacyFusionAnalysis";

interface Analysis extends ResourceAccess {
  id: string;
  name: string;
  description: string;
  question: string;
  instructions: string;
  dataSources: string[];
  resultMarkdown: string;
  resultData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  author: string;
  visibility: "private" | "org" | "public";
}

async function fetchAnalysis(id: string): Promise<Analysis | null> {
  try {
    const data = await callAction("get-analysis", { id }, { method: "GET" });
    if (!data || typeof data !== "object") return null;
    const a = data as Record<string, unknown>;
    if (a.error) return null;
    return a as unknown as Analysis;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AnalysisDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();

  const analysesSync = useChangeVersions(["analyses", "action"]);
  const { data: analysis, isLoading } = useQuery({
    queryKey: ["analysis-detail", id, analysesSync],
    queryFn: () => fetchAnalysis(id!),
    enabled: !!id,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    initialData: () => {
      if (!id) return undefined;
      const snapshot = queryClient.getQueryData<
        PrefetchSnapshot<Analysis | null>
      >(analysisDetailPrefetchKey(id));
      if (snapshot?.data === null && snapshot.syncVersion !== analysesSync) {
        return undefined;
      }
      return snapshot?.data;
    },
    initialDataUpdatedAt: () => {
      if (!id) return undefined;
      const queryKey = analysisDetailPrefetchKey(id);
      const snapshot =
        queryClient.getQueryData<PrefetchSnapshot<Analysis | null>>(queryKey);
      if (!snapshot) return undefined;
      if (snapshot.syncVersion !== analysesSync) return 0;
      return queryClient.getQueryState(queryKey)?.dataUpdatedAt;
    },
  });
  const canEdit = resourceCanEdit(analysis);
  const canManage = resourceCanManage(analysis);
  const { mutateAsync: deleteAnalysis } = useActionMutation("delete-analysis", {
    method: "DELETE",
  });

  useEffect(() => {
    if (analysis?.id) incrementItemView("analysis", analysis.id);
  }, [analysis?.id]);

  const handleRerun = () => {
    if (!analysis || !canEdit) return;
    send({
      message: t("analyses.rerunMessage", { name: analysis.name }),
      context:
        `This is a re-run of a saved ad-hoc analysis. REAL_DATA_REQUIRED: run at least one real data-source query action before saving or answering; data-source-status, generate-chart, and save-analysis do not count as data queries. If no source can answer, report the exact unavailable/error result instead of saving guessed results.\n\n` +
        `Use these instructions to reproduce it:\n\n` +
        `Analysis ID: ${analysis.id}\n` +
        `Original question: ${analysis.question}\n\n` +
        `Instructions:\n${analysis.instructions}\n\n` +
        `After gathering the data, call save-analysis with id="${analysis.id}" to update the results.`,
      submit: true,
    });
  };

  const handleDelete = async () => {
    if (!id || !canManage) return;
    await deleteAnalysis({ id });
    queryClient.removeQueries({ queryKey: analysisDetailPrefetchKey(id) });
    queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
    navigate("/analyses");
  };

  useSetPageTitle(
    analysis ? (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {analysis.name}
      </h1>
    ) : null,
  );

  useSetHeaderActions(
    analysis ? (
      <>
        <ShareButton
          resourceType="analysis"
          resourceId={analysis.id}
          resourceTitle={analysis.name}
          variant="compact"
        />
        {canEdit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                onClick={handleRerun}
                disabled={isGenerating}
              >
                <IconRefresh className="h-4 w-4" />
                {t("analyses.rerun")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("analyses.rerunTooltip")}</TooltipContent>
          </Tooltip>
        ) : null}
        {canManage ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <IconTrash className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("analyses.deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("analyses.deleteDescription", { name: analysis.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  {t("sidebar.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </>
    ) : null,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h3 className="text-lg font-semibold mb-2">{t("analyses.notFound")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t("analyses.mayHaveBeenDeleted")}
        </p>
        <Link to="/analyses" className="text-sm text-primary hover:underline">
          {t("analyses.backToAnalyses")}
        </Link>
      </div>
    );
  }

  const showLegacyFusionDashboard = isLegacyFusionAnalysis(analysis.id);

  return (
    <>
      {codeRequiredDialog}
      <div
        className={cn(
          "space-y-6",
          showLegacyFusionDashboard ? "max-w-6xl" : "max-w-4xl",
        )}
      >
        {/* Header */}
        <div>
          <Link
            to="/analyses"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
          >
            <IconArrowLeft className="h-3 w-3" />
            {t("analyses.allAnalyses")}
          </Link>
          {analysis.description && (
            <p className="text-sm text-muted-foreground">
              {analysis.description}
            </p>
          )}

          {/* Metadata bar */}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconClock className="h-3 w-3" />
              {t("analyses.updated", { date: formatDate(analysis.updatedAt) })}
            </span>
            {analysis.createdAt !== analysis.updatedAt && (
              <span>
                {t("analyses.created", {
                  date: formatDate(analysis.createdAt),
                })}
              </span>
            )}
            {analysis.author && (
              <span>{t("analyses.byAuthor", { author: analysis.author })}</span>
            )}
            <span className="flex items-center gap-1.5">
              {analysis.visibility === "public" ? (
                <IconWorld className="h-3 w-3" />
              ) : analysis.visibility === "org" ? (
                <IconBuilding className="h-3 w-3" />
              ) : (
                <IconLock className="h-3 w-3" />
              )}
              {analysis.visibility === "public"
                ? t("analyses.public")
                : analysis.visibility === "org"
                  ? t("analyses.sharedWithOrg")
                  : t("analyses.private")}
            </span>
          </div>

          {/* Data source badges */}
          {analysis.dataSources?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {analysis.dataSources.map((ds) => (
                <Badge
                  key={ds}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0"
                >
                  <IconDatabase className="h-2.5 w-2.5 mr-1" />
                  {ds}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        {showLegacyFusionDashboard ? (
          <LegacyFusionAnalysis analysis={analysis} />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown content={analysis.resultMarkdown} />
          </div>
        )}
      </div>
    </>
  );
}
