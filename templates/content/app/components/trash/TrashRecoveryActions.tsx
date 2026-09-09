import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export type TrashRecoveryPlan = {
  documentId: string;
  affectedDocumentIds: string[];
  affectedDatabaseIds: string[];
  detachedDocumentIds?: string[];
  scopeToken: string;
  needsDestination: boolean;
  destinations: { id: string; title: string }[];
  hasMoreDestinations: boolean;
};

type PlannedItem =
  | { item: ContentTrashItem; plan: TrashRecoveryPlan }
  | {
      item: ContentTrashItem;
      legacyRestoreDatabaseId: string;
      plan: Omit<TrashRecoveryPlan, "scopeToken">;
    };
type ItemError = { id: string; title: string; message: string };

export function TrashRecoveryActions({
  items,
  onComplete,
}: {
  items: ContentTrashItem[];
  onComplete: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const initiatingButton = useRef<HTMLButtonElement | null>(null);
  const [mode, setMode] = useState<"restore" | "delete" | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [plans, setPlans] = useState<PlannedItem[]>([]);
  const [errors, setErrors] = useState<ItemError[]>([]);
  const [destinations, setDestinations] = useState<
    Record<string, string | null>
  >({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [openDestinationId, setOpenDestinationId] = useState<string | null>(
    null,
  );

  async function begin(nextMode: "restore" | "delete") {
    setMode(nextMode);
    setPlanning(true);
    setPlans([]);
    setErrors([]);
    setDestinations({});
    setCompleted([]);
    const snapshot = [...items];
    const results = await Promise.allSettled(
      snapshot.map(async (item): Promise<PlannedItem> => {
        if (item.legacyRestoreDatabaseId) {
          if (nextMode !== "restore")
            throw new Error(t("trashRecovery.reviewFailed"));
          return {
            item,
            legacyRestoreDatabaseId: item.legacyRestoreDatabaseId,
            plan: {
              documentId: item.documentId,
              affectedDocumentIds: [item.documentId],
              affectedDatabaseIds: [item.legacyRestoreDatabaseId],
              needsDestination: false,
              destinations: [],
              hasMoreDestinations: false,
            },
          };
        }
        return {
          item,
          plan: (await callAction(
            "plan-content-trash-recovery",
            {
              id: item.documentId,
              operation: nextMode === "restore" ? "restore" : "purge",
            },
            { method: "GET" },
          )) as TrashRecoveryPlan,
        };
      }),
    );
    const nextPlans: PlannedItem[] = [];
    const nextErrors: ItemError[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") nextPlans.push(result.value);
      else
        nextErrors.push({
          id: snapshot[index].documentId,
          title: snapshot[index].title,
          message:
            actionErrorMessage(result.reason) ??
            t("trashRecovery.reviewFailed"),
        });
    });
    const covered = new Set<string>();
    const deduplicated = nextPlans
      .sort(
        (a, b) =>
          b.plan.affectedDocumentIds.length - a.plan.affectedDocumentIds.length,
      )
      .filter(({ item, plan }) => {
        if (covered.has(item.documentId)) return false;
        for (const id of plan.affectedDocumentIds) covered.add(id);
        return true;
      });
    setPlans(deduplicated);
    setErrors(nextErrors);
    setPlanning(false);
  }

  async function apply() {
    setRunning(true);
    const nextErrors: ItemError[] = [];
    const succeeded = [...completed];
    for (const entry of plans) {
      const { item } = entry;
      if (succeeded.includes(item.documentId)) continue;
      try {
        if ("legacyRestoreDatabaseId" in entry) {
          if (mode !== "restore")
            throw new Error(t("trashRecovery.mutationFailed"));
          await callAction("restore-content-database", {
            databaseId: entry.legacyRestoreDatabaseId,
            expectedLegacyDocumentId: item.documentId,
          });
        } else if (mode === "delete") {
          await callAction("permanently-delete-document", {
            id: item.documentId,
            scopeToken: entry.plan.scopeToken,
          });
        } else {
          await callAction("restore-document", {
            id: item.documentId,
            scopeToken: entry.plan.scopeToken,
            ...(Object.prototype.hasOwnProperty.call(
              destinations,
              item.documentId,
            )
              ? { destinationParentId: destinations[item.documentId] }
              : {}),
          });
        }
        succeeded.push(item.documentId);
      } catch (error) {
        nextErrors.push({
          id: item.documentId,
          title: item.title,
          message:
            actionErrorMessage(error) ?? t("trashRecovery.mutationFailed"),
        });
      }
    }
    setCompleted(succeeded);
    setErrors(nextErrors);
    setRunning(false);
    if (succeeded.length) {
      void queryClient
        .invalidateQueries({ queryKey: ["action"] })
        .catch(console.error);
    }
    if (!nextErrors.length) {
      setMode(null);
      onComplete();
    }
  }

  const count = new Set(plans.flatMap(({ plan }) => plan.affectedDocumentIds))
    .size;
  const detachedCount = new Set(
    plans.flatMap(({ plan }) => plan.detachedDocumentIds ?? []),
  ).size;
  const missingDestination =
    mode === "restore" &&
    plans.some(
      ({ item, plan }) =>
        plan.needsDestination &&
        !Object.prototype.hasOwnProperty.call(destinations, item.documentId),
    );
  const busy = planning || running;

  return (
    <>
      {items.length > 0 && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || items.some((item) => !item.canRestore)}
            onClick={(event) => {
              initiatingButton.current = event.currentTarget;
              void begin("restore");
            }}
          >
            {t("trashRecovery.restore")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              busy ||
              items.some(
                (item) =>
                  !!item.legacyRestoreDatabaseId || !item.canPermanentlyDelete,
              )
            }
            onClick={(event) => {
              initiatingButton.current = event.currentTarget;
              void begin("delete");
            }}
          >
            {t("trashRecovery.permanentDelete")}
          </Button>
        </>
      )}
      <AlertDialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            if (openDestinationId !== null) setOpenDestinationId(null);
            else setMode(null);
          }
        }}
      >
        <AlertDialogContent
          className="max-h-[85dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            initiatingButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                mode === "delete"
                  ? "trashRecovery.confirmDelete"
                  : "trashRecovery.restore",
              )}
            </AlertDialogTitle>
            {mode === "delete" && !planning && (
              <AlertDialogDescription>
                {t("trashRecovery.scope", { count })}
                {detachedCount > 0 && (
                  <span className="mt-2 block">
                    {t("trashRecovery.detachedScope", { count: detachedCount })}
                  </span>
                )}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {planning ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {plans.map(({ item, plan }) => (
                <div
                  key={item.documentId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 break-words text-sm">
                    {item.title}
                  </span>
                  {completed.includes(item.documentId) ? (
                    <span className="text-sm text-muted-foreground">
                      {t(
                        mode === "delete"
                          ? "trashRecovery.deleted"
                          : "trashRecovery.restored",
                      )}
                    </span>
                  ) : (
                    mode === "restore" &&
                    !item.legacyRestoreDatabaseId && (
                      <div className="flex min-w-0 flex-col gap-1">
                        <DropdownMenu
                          open={openDestinationId === item.documentId}
                          onOpenChange={(open) =>
                            setOpenDestinationId(open ? item.documentId : null)
                          }
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={t("trashRecovery.destination")}
                              className="max-w-64 truncate"
                            >
                              {destinations[item.documentId] === null
                                ? t("trashRecovery.spaceRoot")
                                : destinations[item.documentId]
                                  ? plan.destinations.find(
                                      (destination) =>
                                        destination.id ===
                                        destinations[item.documentId],
                                    )?.title
                                  : t(
                                      plan.needsDestination
                                        ? "trashRecovery.chooseDestination"
                                        : "trashRecovery.originalLocation",
                                    )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onEscapeKeyDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <DropdownMenuRadioGroup
                              value={
                                destinations[item.documentId] === null
                                  ? "root"
                                  : (destinations[item.documentId] ??
                                    "original")
                              }
                              onValueChange={(value) =>
                                setDestinations((current) => {
                                  const next = { ...current };
                                  if (value === "original")
                                    delete next[item.documentId];
                                  else
                                    next[item.documentId] =
                                      value === "root" ? null : value;
                                  return next;
                                })
                              }
                            >
                              {!plan.needsDestination && (
                                <DropdownMenuRadioItem value="original">
                                  {t("trashRecovery.originalLocation")}
                                </DropdownMenuRadioItem>
                              )}
                              <DropdownMenuRadioItem value="root">
                                {t("trashRecovery.spaceRoot")}
                              </DropdownMenuRadioItem>
                              {plan.destinations.map((destination) => (
                                <DropdownMenuRadioItem
                                  key={destination.id}
                                  value={destination.id}
                                >
                                  {destination.title}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {plan.needsDestination &&
                          !Object.prototype.hasOwnProperty.call(
                            destinations,
                            item.documentId,
                          ) && (
                            <span className="max-w-64 text-sm text-muted-foreground">
                              {t("trashRecovery.requiresDestination")}
                            </span>
                          )}
                        {plan.hasMoreDestinations && (
                          <span className="text-xs text-muted-foreground">
                            {t("trashRecovery.moreDestinations")}
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
              ))}
              {errors.map((error) => (
                <p
                  role="alert"
                  key={error.id}
                  className="break-words text-sm text-destructive"
                >
                  {error.title}: {error.message}
                </p>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("trashRecovery.cancel")}
            </AlertDialogCancel>
            <Button
              variant={mode === "delete" ? "destructive" : "default"}
              disabled={
                busy || !plans.length || errors.length > 0 || missingDestination
              }
              onClick={() => void apply()}
            >
              {t(
                running
                  ? mode === "delete"
                    ? "trashRecovery.deleting"
                    : "trashRecovery.restoring"
                  : mode === "delete"
                    ? "trashRecovery.permanentDelete"
                    : "trashRecovery.restore",
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
