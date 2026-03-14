import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, History, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth-fetch";
import { HistoryDiffView } from "./HistoryDiffView";
import { HistorySlider } from "./HistorySlider";
import {
  getProjectRouteSlug,
  useFileContent,
  useFileTree,
  useProjects,
  useVersionContent,
  useVersionHistory,
  workspaceUrl,
} from "@/hooks/use-projects";

interface ProjectHistoryViewProps {
  projectSlug: string;
  filePath: string;
  embedded?: boolean;
  onClose?: () => void;
  onSelectVersionContent?: (content: string) => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProjectHistoryView({
  projectSlug,
  filePath,
  embedded = false,
  onClose,
  onSelectVersionContent,
}: ProjectHistoryViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: fileData } = useFileContent(projectSlug, filePath);
  const { data: fileTreeData } = useFileTree(projectSlug);
  const { data: projectsData } = useProjects();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const pendingEditorVersionIdRef = useRef<string | null>(null);

  const activeDraftPath = fileTreeData?.activeDraftPath || "draft.md";
  const historyEnabled = filePath === activeDraftPath;
  const { data: versionHistory, isLoading: isVersionHistoryLoading } =
    useVersionHistory(projectSlug, filePath, historyEnabled);
  const versions = versionHistory?.versions || [];
  const latestVersionId = versions[versions.length - 1]?.id || null;
  const latestVersionIdRef = useRef<string | null>(null);
  const selectedVersionIndex = useMemo(
    () => versions.findIndex((version) => version.id === selectedVersionId),
    [versions, selectedVersionId],
  );
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [versions, selectedVersionId],
  );
  const previousVersionId =
    selectedVersionIndex > 0
      ? versions[selectedVersionIndex - 1]?.id || null
      : null;
  const { data: currentVersion, isLoading: isCurrentVersionLoading } =
    useVersionContent(
      projectSlug,
      filePath,
      selectedVersionId,
      historyEnabled && !!selectedVersionId,
    );
  const { data: previousVersion, isLoading: isPreviousVersionLoading } =
    useVersionContent(
      projectSlug,
      filePath,
      previousVersionId,
      historyEnabled && !!previousVersionId,
    );

  useEffect(() => {
    setSelectedVersionId(null);
    pendingEditorVersionIdRef.current = null;
  }, [projectSlug, filePath]);

  useEffect(() => {
    if (!historyEnabled) return;
    if (!versions.length) {
      setSelectedVersionId(null);
      latestVersionIdRef.current = null;
      return;
    }

    const previousLatestVersionId = latestVersionIdRef.current;
    const isSelectedVersionMissing =
      !selectedVersionId ||
      !versions.some((version) => version.id === selectedVersionId);
    const wasFollowingLatest =
      !!previousLatestVersionId &&
      selectedVersionId === previousLatestVersionId;

    if (
      isSelectedVersionMissing ||
      (wasFollowingLatest && latestVersionId !== previousLatestVersionId)
    ) {
      setSelectedVersionId(latestVersionId);
    }

    latestVersionIdRef.current = latestVersionId;
  }, [historyEnabled, latestVersionId, selectedVersionId, versions]);

  const handleSelectVersion = (versionId: string) => {
    pendingEditorVersionIdRef.current = versionId;
    setSelectedVersionId(versionId);

    if (!onSelectVersionContent) return;

    queryClient
      .fetchQuery({
        queryKey: ["versionContent", projectSlug, filePath, versionId],
        queryFn: async () => {
          const res = await authFetch(
            `/api/projects/${projectSlug}/version-history/${versionId}?path=${encodeURIComponent(filePath)}`,
          );
          if (!res.ok) throw new Error("Failed to fetch version");
          return res.json() as Promise<{ content: string }>;
        },
      })
      .then((version) => {
        if (pendingEditorVersionIdRef.current !== versionId) return;
        onSelectVersionContent(version.content);
        pendingEditorVersionIdRef.current = null;
      })
      .catch(() => {
        if (pendingEditorVersionIdRef.current === versionId) {
          pendingEditorVersionIdRef.current = null;
        }
      });
  };

  const handleBack = () => {
    if (onClose) {
      onClose();
      return;
    }

    const project = projectsData?.projects.find(
      (entry) => entry.slug === projectSlug,
    );
    const routeSlug = project ? getProjectRouteSlug(project) : projectSlug;
    const workspace = routeSlug.includes("/")
      ? routeSlug.split("/")[0]
      : routeSlug;
    const prefixed = !!projectsData?.groupMeta?.[workspace]?.prefixed;
    navigate(workspaceUrl(routeSlug, prefixed));
  };

  const actorLabel =
    selectedVersion?.actorDisplayName ||
    (selectedVersion?.actorType === "user" ? "Builder User" : "Agent");

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {!embedded && (
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
                Back to editor
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <History className="h-4 w-4" />
                  <span>Version history</span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {fileData?.title || filePath}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden px-4 py-6 sm:px-6">
          {historyEnabled ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="sticky top-0 z-20 shrink-0 border-b bg-card/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/90 sm:px-5">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-foreground">
                        <History className="h-4 w-4" />
                        <h3 className="text-sm font-semibold">
                          Article history
                        </h3>
                        <Badge variant="secondary">
                          {versions.length} changes
                        </Badge>
                      </div>

                      {selectedVersion ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="font-normal">
                            {dateTimeFormatter.format(
                              new Date(selectedVersion.timestamp),
                            )}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="gap-1 font-normal"
                          >
                            {selectedVersion.actorType === "user" ? (
                              <User className="h-3 w-3" />
                            ) : (
                              <Bot className="h-3 w-3" />
                            )}
                            {actorLabel}
                          </Badge>
                          {currentVersion?.source ? (
                            <Badge
                              variant="outline"
                              className="font-normal capitalize"
                            >
                              {currentVersion.source}
                            </Badge>
                          ) : null}
                          <span>
                            +{selectedVersion.wordsAdded} / -
                            {selectedVersion.wordsRemoved}
                          </span>
                          {currentVersion?.linesChanged ? (
                            <span>
                              {currentVersion.linesChanged} changed lines
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Select a saved version to inspect what changed.
                        </p>
                      )}
                    </div>
                  </div>

                  <HistorySlider
                    versions={versions}
                    selectedVersionId={selectedVersionId}
                    onSelectVersion={handleSelectVersion}
                    isLoading={isVersionHistoryLoading}
                  />
                </div>
              </div>

              <HistoryDiffView
                currentVersion={currentVersion}
                previousVersion={previousVersion}
                isLoading={isCurrentVersionLoading || isPreviousVersionLoading}
              />
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              Article history is only available for the active draft.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
