import {
  type GetResourceVersionResult,
  type ListResourceVersionsResult,
  useDeleteResourceVersion,
  useResourceVersions,
} from "@agent-native/core/client/history";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconLoader2, IconX } from "@tabler/icons-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
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

import {
  automationPromptPreview,
  parseFactoryAutomationVersionSnapshot,
  type FactoryAutomationVersionSnapshot,
} from "./factory-automation-form";

type VersionRow = ListResourceVersionsResult["versions"][number];

function formatAutomationDate(value: string | number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function versionRowLabel(
  t: ReturnType<typeof useT>,
  version: VersionRow,
  snapshot: FactoryAutomationVersionSnapshot | undefined,
): string {
  const historySavedAt = snapshot?.configSavedAt
    ? formatAutomationDate(snapshot.configSavedAt)
    : formatAutomationDate(version.createdAt);
  return snapshot
    ? t("factoryRoute.automationVersionRowDetail", {
        promptVersion: snapshot.promptVersion,
        savedAt: historySavedAt,
      })
    : t("factoryRoute.automationVersionHistoryRowDetail", {
        savedAt: historySavedAt,
        summary: version.summary ?? "",
      });
}

async function fetchAutomationVersionSnapshot(
  resourceId: string,
  versionNumber: number,
): Promise<FactoryAutomationVersionSnapshot | null> {
  const result = await callAction<GetResourceVersionResult>(
    "get-resource-version",
    {
      resourceType: "factory-automation",
      resourceId,
      versionNumber,
    },
    { method: "GET" },
  );
  return parseFactoryAutomationVersionSnapshot(result.version.snapshot);
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
  const [selectingVersion, setSelectingVersion] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VersionRow | null>(null);
  const pendingDeleteVersionRef = useRef<VersionRow | null>(null);
  const deleteMutation = useDeleteResourceVersion();
  const versionsQuery = useResourceVersions(
    { resourceType: "factory-automation", resourceId, limit: 50 },
    { enabled: Boolean(resourceId) },
  );
  const versionRows = versionsQuery.data?.versions ?? [];
  const snapshotQueries = useQueries({
    queries: versionRows.map((version) => ({
      queryKey: [
        "action",
        "get-resource-version",
        {
          resourceType: "factory-automation",
          resourceId,
          versionNumber: version.versionNumber,
        },
      ] as const,
      queryFn: () =>
        fetchAutomationVersionSnapshot(resourceId, version.versionNumber),
      enabled: menuOpen && Boolean(resourceId),
      staleTime: 60_000,
    })),
  });
  const snapshotsByVersion = useMemo(() => {
    const map = new Map<number, FactoryAutomationVersionSnapshot>();
    for (const [index, version] of versionRows.entries()) {
      const snapshot = snapshotQueries[index]?.data;
      if (snapshot) {
        map.set(version.versionNumber, snapshot);
      }
    }
    return map;
  }, [snapshotQueries, versionRows]);
  const hasHistoryRows = versionRows.length > 0;
  const hasSavedState = savedConfigSavedAt != null || savedPromptVersion > 0;
  const canOpen = hasHistoryRows || hasSavedState;
  const loadingSnapshots =
    menuOpen && snapshotQueries.some((query) => query.isLoading);
  const snapshotLoadFailed =
    menuOpen &&
    snapshotQueries.some((query) => query.isError) &&
    snapshotsByVersion.size === 0;
  const savedAtLabel = savedConfigSavedAt
    ? formatAutomationDate(savedConfigSavedAt)
    : null;

  const selectHistoryVersion = useCallback(
    async (version: VersionRow) => {
      const cached = snapshotsByVersion.get(version.versionNumber);
      if (cached) {
        onSelectSnapshot(cached);
        return;
      }
      setSelectingVersion(version.versionNumber);
      try {
        const snapshot = await fetchAutomationVersionSnapshot(
          resourceId,
          version.versionNumber,
        );
        if (!snapshot) {
          toast.error(t("factoryRoute.automationVersionLoadFailed"));
          return;
        }
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
    [onSelectSnapshot, resourceId, snapshotsByVersion, t],
  );

  const requestDeleteVersion = useCallback((version: VersionRow) => {
    // Defer actually opening the AlertDialog until the dropdown has fully
    // closed (see the onCloseAutoFocus handler below) — opening a second
    // Radix dismissable layer in the same tick this one closes can leave
    // `pointer-events: none` stuck on <body>, freezing the whole page.
    pendingDeleteVersionRef.current = version;
    setMenuOpen(false);
  }, []);

  const confirmDeleteVersion = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({
        resourceType: "factory-automation",
        resourceId,
        versionNumber: deleteTarget.versionNumber,
      });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-resource-versions"],
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

  const deleteTargetSnapshot = deleteTarget
    ? snapshotsByVersion.get(deleteTarget.versionNumber)
    : undefined;

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
            // Promote the pending target only once this menu has actually
            // finished closing (see requestDeleteVersion above).
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
          {loadingSnapshots ? (
            <DropdownMenuItem disabled>
              <span className="text-xs text-muted-foreground">
                {t("factoryRoute.automationVersionsLoading")}
              </span>
            </DropdownMenuItem>
          ) : null}
          {snapshotLoadFailed ? (
            <DropdownMenuItem disabled>
              <span className="text-xs text-destructive">
                {t("factoryRoute.automationVersionsLoadFailed")}
              </span>
            </DropdownMenuItem>
          ) : null}
          {versionRows.map((version) => {
            const snapshot = snapshotsByVersion.get(version.versionNumber);
            const selecting = selectingVersion === version.versionNumber;
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
                      {versionRowLabel(t, version, snapshot)}
                    </p>
                    {snapshot?.userPrompt ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {automationPromptPreview(snapshot.userPrompt)}
                      </p>
                    ) : version.summary ? (
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
              label: deleteTarget
                ? versionRowLabel(t, deleteTarget, deleteTargetSnapshot)
                : "",
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
