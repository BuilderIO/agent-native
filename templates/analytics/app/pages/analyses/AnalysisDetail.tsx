import { useEffect } from "react";
import { useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { incrementItemView } from "@/lib/item-popularity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/components/ui/alert-dialog";
import {
  IconRefresh,
  IconTrash,
  IconClock,
  IconArrowLeft,
  IconDatabase,
} from "@tabler/icons-react";
import { Link, useNavigate } from "react-router";
import { ShareButton } from "@agent-native/core/client";
import { getIdToken } from "@/lib/auth";
import { useSendToAgentChat } from "@agent-native/core/client";
import Markdown from "@/components/Markdown";
import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";

interface Analysis {
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
}

async function fetchAnalysis(id: string): Promise<Analysis | null> {
  const token = await getIdToken();
  const res = await fetch(`/api/analyses/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return res.json();
}

async function deleteAnalysis(id: string): Promise<void> {
  const token = await getIdToken();
  await fetch(`/api/analyses/${id}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["analysis-detail", id],
    queryFn: () => fetchAnalysis(id!),
    enabled: !!id,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (analysis?.id) incrementItemView("analysis", analysis.id);
  }, [analysis?.id]);

  const handleRerun = () => {
    if (!analysis) return;
    send({
      message: `Re-run the analysis "${analysis.name}" with the latest data and update the saved results.`,
      context:
        `This is a re-run of a saved ad-hoc analysis. Use these instructions to reproduce it:\n\n` +
        `Analysis ID: ${analysis.id}\n` +
        `Original question: ${analysis.question}\n\n` +
        `Instructions:\n${analysis.instructions}\n\n` +
        `After gathering the data, call save-analysis with id="${analysis.id}" to update the results.`,
      submit: true,
    });
  };

  const handleDelete = async () => {
    if (!id) return;
    await deleteAnalysis(id);
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
        <Button
          variant="default"
          size="sm"
          onClick={handleRerun}
          disabled={isGenerating}
        >
          <IconRefresh className="h-4 w-4 mr-1.5" />
          Re-run
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <IconTrash className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete analysis?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{analysis.name}" and its results.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
        <h3 className="text-lg font-semibold mb-2">Analysis not found</h3>
        <p className="text-sm text-muted-foreground mb-4">
          This analysis may have been deleted.
        </p>
        <Link to="/analyses" className="text-sm text-primary hover:underline">
          Back to analyses
        </Link>
      </div>
    );
  }

  return (
    <>
      {codeRequiredDialog}
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div>
          <Link
            to="/analyses"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
          >
            <IconArrowLeft className="h-3 w-3" />
            All analyses
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
              Updated {formatDate(analysis.updatedAt)}
            </span>
            {analysis.createdAt !== analysis.updatedAt && (
              <span>Created {formatDate(analysis.createdAt)}</span>
            )}
            {analysis.author && <span>by {analysis.author}</span>}
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
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Markdown content={analysis.resultMarkdown} />
        </div>
      </div>
    </>
  );
}
