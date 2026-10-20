import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconLoader2, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { type FactoryAutomationVersionSnapshot } from "./factory-automation-form";

type VersionRow = {
  id: string;
  automationId: string;
  factoryId: string;
  version: number;
  displayName: string | null;
  source: string;
  summary: string;
  createdAt: string;
  createdBy: string;
  isCurrent: boolean;
};

type ListFactoryAutomationVersionsResult = {
  automationId: string;
  factoryId: string;
  currentVersion: number | null;
  hasMore: boolean;
  nextBeforeVersion: number | null;
  versions: VersionRow[];
};

type GetFactoryAutomationVersionResult = FactoryAutomationVersionSnapshot & {
  id: string;
  automationId: string;
  factoryId: string;
  version: number;
  rawContent: string;
  source: string;
  summary: string;
  createdAt: string;
  createdBy: string;
  isCurrent: boolean;
};

type DeleteFactoryAutomationVersionResult = {
  ok: true;
  automationId: string;
  versionId: string;
  version: number;
};

function formatAutomationDate(value: string | number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function versionRowLabel(
  t: ReturnType<typeof useT>,
  version: VersionRow,
): string {
  return t("factoryRoute.automationVersionRowDetail", {
    promptVersion: version.version,
    savedAt: formatAutomationDate(version.createdAt),
  });
}

async function fetchAutomationVersionSnapshot(
  automationId: string,
  versionId: string,
): Promise<FactoryAutomationVersionSnapshot> {
  const result = await callAction<GetFactoryAutomationVersionResult>(
    "get-factory-automation-version",
    { automationId, versionId },
    { method: "GET" },
  );
  return {
    userPrompt: result.userPrompt,
    displayName: result.displayName,
    config: result.config,
    promptVersion: result.promptVersion,
    configSavedAt: result.configSavedAt,
  };
}

export function FactoryAutomationVersionPicker({
  resourceId,
  savedPromptVersion,
  savedConfigSavedAt,
  disabled = false,
  onSelectSnapshot,
  onSelectCurrentSaved,
}: {
  resourceId: string;
  savedPromptVersion: number;
  savedConfigSavedAt?: string | null;
  disabled?: boolean;
  onSelectSnapshot: (snapshot: FactoryAutomationVersionSnapshot) => void;
  onSelectCurrentSaved: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectingVersion, setSelectingVersion] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VersionRow | null>(null);
  const pendingDeleteVersionRef = useRef<VersionRow | null>(null);
  const deleteMutation = useActionMutation<
    DeleteFactoryAutomationVersionResult,
    { automationId: string; versionId: string }
  >("delete-factory-automation-version");
  const versionsQuery = useActionQuery<ListFactoryAutomationVersionsResult>(
    "list-factory-automation-versions",
    { automationId: resourceId, limit: 50 },
    { enabled: Boolean(resourceId) },
  );
  const versionRows = versionsQuery.data?.versions ?? [];
  const hasHistoryRows = versionRows.length > 0;
  const hasSavedState = savedConfigSavedAt != null || savedPromptVersion > 0;
  const canOpen = hasHistoryRows || hasSavedState;
  const savedAtLabel = savedConfigSavedAt
    ? formatAutomationDate(savedConfigSavedAt)
    : null;

  const selectHistoryVersion = useCallback(
    async (version: VersionRow) => {
      setSelectingVersion(version.id);
      try {
        const snapshot = await fetchAutomationVersionSnapshot(
          resourceId,
          version.id,
        );
        onSelectSnapshot(snapshot);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("factoryRoute.automationVersionLoadFailed"),
        );
      } finally {
        setSelectingVersion(null);
      }
    },
    [onSelectSnapshot, resourceId, t],
  );

  const requestDeleteVersion = useCallback((version: VersionRow) => {
    pendingDeleteVersionRef.current = version;
    setMenuOpen(false);
  }, []);

  const confirmDeleteVersion = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({
        automationId: resourceId,
        versionId: deleteTarget.id,
      });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-factory-automation-versions"],
      });
      toast.success(t("factoryRoute.automationVersionDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.automationVersionDeleteFailed"),
      );
    }
  }, [deleteMutation, deleteTarget, queryClient, resourceId, t]);

  return (
    <AlertDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => {
        if (!open && !deleteMutation.isPending) setDeleteTarget(null);
      }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !canOpen || versionsQuery.isLoading}
            className="shrink-0 gap-1"
            aria-label={t("factoryRoute.automationVersionPickerLabel")}
          >
            {hasSavedState
              ? t("factoryRoute.automationCurrentSavedShort", {
                  version: savedPromptVersion,
                })
              : hasHistoryRows
                ? t("factoryRoute.automationVersionPickerLabel")
                : t("factoryRoute.automationNoSavedVersions")}
            <IconChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-80"
          onCloseAutoFocus={(event) => {
            if (pendingDeleteVersionRef.current) {
              event.preventDefault();
              setDeleteTarget(pendingDeleteVersionRef.current);
              pendingDeleteVersionRef.current = null;
            }
          }}
        >
          <DropdownMenuLabel>
            {t("factoryRoute.automationVersionPickerLabel")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSelectCurrentSaved}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {t("factoryRoute.automationCurrentSaved")}
              </p>
              <p className="text-xs text-muted-foreground">
                {savedAtLabel
                  ? t("factoryRoute.automationVersionRowDetail", {
                      promptVersion: savedPromptVersion,
                      savedAt: savedAtLabel,
                    })
                  : t("factoryRoute.automationSavedVersion", {
                      version: savedPromptVersion,
                    })}
              </p>
            </div>
          </DropdownMenuItem>
          {versionsQuery.isLoading ? (
            <DropdownMenuItem disabled>
              <span className="text-xs text-muted-foreground">
                {t("factoryRoute.automationVersionsLoading")}
              </span>
            </DropdownMenuItem>
          ) : null}
          {versionsQuery.isError ? (
            <DropdownMenuItem disabled>
              <span className="text-xs text-destructive">
                {t("factoryRoute.automationVersionsLoadFailed")}
              </span>
            </DropdownMenuItem>
          ) : null}
          {versionRows.map((version) => {
            const selecting = selectingVersion === version.id;
            return (
              <DropdownMenuItem
                key={version.id}
                disabled={selecting}
                onSelect={() => void selectHistoryVersion(version)}
              >
                <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* Leads with version + save time, not the automation's
                        displayName: that's constant across every row and reads
                        as duplicate rows when it's the only bold text. */}
                    <p className="truncate text-sm font-medium">
                      {versionRowLabel(t, version)}
                    </p>
                    {version.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {version.summary}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("factoryRoute.automationVersionDeleteLabel")}
                    title={t("factoryRoute.automationVersionDeleteLabel")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      requestDeleteVersion(version);
                    }}
                  >
                    <IconX className="size-3.5" />
                  </Button>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("factoryRoute.automationVersionDeleteTitle", {
              label: deleteTarget ? versionRowLabel(t, deleteTarget) : "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("factoryRoute.automationVersionDeleteWarning")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            {t("factoryRoute.automationVersionDeleteCancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleteMutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              void confirmDeleteVersion();
            }}
          >
            {deleteMutation.isPending && (
              <IconLoader2 className="size-4 animate-spin" />
            )}
            {t("factoryRoute.automationVersionDeleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
