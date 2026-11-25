import {
  requestAgentChatThreadOpen,
  useAgentEngineConfigured,
} from "@agent-native/core/client/agent-chat";
import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import {
  COLUMN_FILL_INSTRUCTION_MAX_LENGTH,
  COLUMN_FILL_MAX_CELLS,
  isColumnFillActive,
  isColumnFillPropertyType,
  type ColumnFill,
  type ColumnFillCell,
} from "@shared/column-fill";
import { isEmptyPropertyValue } from "@shared/properties";
import {
  IconAlertTriangle,
  IconClock,
  IconMessage,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseQueryFilter,
} from "@/hooks/use-content-database";
import { cn } from "@/lib/utils";

const POLL_MS = 2_000;

interface ColumnFillEntry {
  fill: ColumnFill;
  cells: ReadonlyMap<string, ColumnFillCell>;
}

interface ColumnFillController {
  entry(propertyId: string): ColumnFillEntry | undefined;
  canFill(property: DocumentProperty): boolean;
  openFill(property: DocumentProperty): void;
  stop(fill: ColumnFill): void;
  retry(fill: ColumnFill, documentId: string): void;
}

const ColumnFillContext = createContext<ColumnFillController | null>(null);

export function columnFillTargets(
  items: readonly ContentDatabaseItem[],
  property: DocumentProperty,
  rewrite: boolean,
): string[] {
  const propertyId = property.definition.id;
  const ids: string[] = [];
  for (const item of items) {
    if (item.document.canEdit === false) continue;
    const cell = item.properties.find(
      (candidate) => candidate.definition.id === propertyId,
    );
    if (cell && !cell.editable) continue;
    if (!rewrite && cell && !isEmptyPropertyValue(cell.value)) continue;
    ids.push(item.document.id);
  }
  return ids;
}

function columnFillEntries(fills: readonly ColumnFill[] | undefined) {
  const entries = new Map<string, ColumnFillEntry>();
  for (const fill of fills ?? []) {
    entries.set(fill.propertyId, {
      fill,
      cells: new Map(fill.cells.map((cell) => [cell.documentId, cell])),
    });
  }
  return entries;
}

function openAgentPanel() {
  window.dispatchEvent(
    new CustomEvent("agent-panel:open", { detail: { focus: true } }),
  );
}

export function ColumnFillProvider({
  databaseId,
  databaseDocumentId,
  items,
  moreRows,
  properties,
  enabled,
  children,
}: {
  databaseId: string;
  databaseDocumentId: string;
  items: readonly ContentDatabaseItem[];
  moreRows: boolean;
  properties: readonly DocumentProperty[];
  enabled: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useActionQuery<{ fills?: ColumnFill[] }>(
    "list-column-fills",
    { databaseId },
    {
      enabled,
      refetchInterval: (state) =>
        state.state.data?.fills?.some((fill) => isColumnFillActive(fill.status))
          ? POLL_MS
          : false,
    },
  );
  const fills = query.data?.fills;
  const entries = useMemo(() => columnFillEntries(fills), [fills]);
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const tRef = useRef(t);
  tRef.current = t;
  const [dialogPropertyId, setDialogPropertyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const propertyName = useCallback(
    (propertyId: string) =>
      properties.find((property) => property.definition.id === propertyId)
        ?.definition.name ?? "",
    [properties],
  );

  const seenRef = useRef(new Map<string, { status: string; filled: number }>());
  useEffect(() => {
    if (!fills) return;
    let filledMore = false;
    for (const fill of fills) {
      const filled = fill.cells.filter(
        (cell) => cell.status === "filled",
      ).length;
      const seen = seenRef.current.get(fill.id);
      if (seen && filled > seen.filled) filledMore = true;
      if (
        seen &&
        isColumnFillActive(seen.status as ColumnFill["status"]) &&
        !isColumnFillActive(fill.status)
      ) {
        const failed = fill.cells.filter(
          (cell) => cell.status === "failed",
        ).length;
        const name = propertyName(fill.propertyId);
        setAnnouncement(
          fill.status === "stopped"
            ? t("database.fillStoppedAnnouncement", { name })
            : failed
              ? t("database.fillFinishedWithFailures", { name, count: failed })
              : t("database.fillFinished", { name }),
        );
      }
      seenRef.current.set(fill.id, { status: fill.status, filled });
    }
    if (filledMore) {
      void queryClient.invalidateQueries(
        contentDatabaseQueryFilter(databaseDocumentId),
      );
      void queryClient.invalidateQueries(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
      );
    }
  }, [fills, databaseDocumentId, propertyName, queryClient, t]);

  const controller = useMemo<ColumnFillController>(
    () => ({
      entry: (propertyId) => entries.get(propertyId),
      canFill: (property) =>
        enabled &&
        !property.definition.systemRole &&
        isColumnFillPropertyType(property.definition.type),
      openFill: (property) => setDialogPropertyId(property.definition.id),
      stop: (fill) => {
        void callAction("stop-column-fill", { fillId: fill.id })
          .then(() => refetchRef.current())
          .catch((error) =>
            toast.error(tRef.current("database.fillStopFailed"), {
              description: actionErrorMessage(error),
            }),
          );
      },
      retry: (fill, documentId) => {
        void callAction("retry-column-fill-cell", {
          fillId: fill.id,
          documentId,
        })
          .then(() => refetchRef.current())
          .catch((error) =>
            toast.error(tRef.current("database.fillRetryFailed"), {
              description: actionErrorMessage(error),
            }),
          );
      },
    }),
    [enabled, entries],
  );

  const dialogProperty = dialogPropertyId
    ? properties.find((property) => property.definition.id === dialogPropertyId)
    : undefined;

  return (
    <ColumnFillContext.Provider value={controller}>
      {children}
      {dialogProperty ? (
        <FillWithAiDialog
          databaseId={databaseId}
          property={dialogProperty}
          items={items}
          moreRows={moreRows}
          running={isColumnFillActive(
            entries.get(dialogProperty.definition.id)?.fill.status,
          )}
          onClose={() => setDialogPropertyId(null)}
          onStarted={(fill) => {
            setDialogPropertyId(null);
            setAnnouncement(
              t("database.fillStarted", {
                name: dialogProperty.definition.name,
                count: fill.total,
              }),
            );
            seenRef.current.set(fill.id, { status: fill.status, filled: 0 });
            queryClient.setQueryData<{ fills?: ColumnFill[] }>(
              ["action", "list-column-fills", { databaseId }],
              (current) => ({
                fills: [
                  fill,
                  ...(current?.fills ?? []).filter(
                    (other) => other.propertyId !== fill.propertyId,
                  ),
                ],
              }),
            );
            void refetchRef.current();
          }}
        />
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </ColumnFillContext.Provider>
  );
}

function FillWithAiDialog({
  databaseId,
  property,
  items,
  moreRows,
  running,
  onClose,
  onStarted,
}: {
  databaseId: string;
  property: DocumentProperty;
  items: readonly ContentDatabaseItem[];
  moreRows: boolean;
  running: boolean;
  onClose: () => void;
  onStarted: (fill: ColumnFill) => void;
}) {
  const t = useT();
  const instructionId = useId();
  const [instruction, setInstruction] = useState("");
  const [rewrite, setRewrite] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentEngine = useAgentEngineConfigured();
  const [setupRefused, setSetupRefused] = useState(false);

  const targets = useMemo(
    () => columnFillTargets(items, property, rewrite),
    [items, property, rewrite],
  );
  const count = targets.length;
  const tooMany = count > COLUMN_FILL_MAX_CELLS;
  const isSelect =
    property.definition.type === "select" ||
    property.definition.type === "multi_select";
  const name = property.definition.name;
  const needsSetup = agentEngine.missing || setupRefused;
  const canStart =
    !running &&
    !needsSetup &&
    agentEngine.state !== "unknown" &&
    !starting &&
    count > 0 &&
    !tooMany &&
    instruction.trim().length > 0;

  const countText =
    count === 0
      ? rewrite
        ? t("database.fillWithAiNoRows")
        : t("database.fillWithAiNothingEmpty")
      : tooMany
        ? t("database.fillWithAiTooMany", { max: COLUMN_FILL_MAX_CELLS })
        : rewrite
          ? t("database.fillWithAiRewriteCount", { count })
          : t("database.fillWithAiCount", { count });

  async function start() {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      const fill = await callAction<ColumnFill>("start-column-fill", {
        databaseId,
        propertyId: property.definition.id,
        instruction: instruction.trim(),
        rewrite,
        documentIds: targets,
      });
      onStarted(fill);
    } catch (caught) {
      if (actionErrorCode(caught) === "AI_SETUP_REQUIRED") {
        setSetupRefused(true);
      } else {
        setError(
          actionErrorMessage(caught) ?? t("database.fillWithAiStartFailed"),
        );
      }
      setStarting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !starting) onClose();
      }}
    >
      <DialogContent className="gap-4 sm:max-w-md" data-column-fill-dialog>
        <DialogHeader>
          <DialogTitle>{t("database.fillWithAiTitle", { name })}</DialogTitle>
          <DialogDescription>
            {isSelect
              ? t("database.fillWithAiDescriptionOptions")
              : t("database.fillWithAiDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <label htmlFor={instructionId} className="text-sm font-medium">
            {t("database.fillWithAiInstructionLabel")}
          </label>
          <Textarea
            id={instructionId}
            autoFocus
            rows={3}
            value={instruction}
            maxLength={COLUMN_FILL_INSTRUCTION_MAX_LENGTH}
            placeholder={t("database.fillWithAiInstructionPlaceholder")}
            disabled={starting}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void start();
              }
            }}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={rewrite}
              disabled={starting}
              onCheckedChange={(value) => setRewrite(value === true)}
            />
            {t("database.fillWithAiRewrite")}
          </label>
          <p
            className="text-sm text-muted-foreground"
            data-column-fill-count={count}
            aria-live="polite"
          >
            {running ? t("database.fillWithAiAlreadyRunning") : countText}
          </p>
          {moreRows && !running ? (
            <p
              className="text-sm text-muted-foreground"
              data-column-fill-more-rows=""
            >
              {t("database.fillWithAiLoadedOnly")}
            </p>
          ) : null}
          {needsSetup ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <span>{t("database.fillWithAiNeedsSetup")}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onClose();
                  openAgentPanel();
                }}
              >
                {t("database.fillWithAiSetUp")}
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={starting}
              onClick={onClose}
            >
              {t("database.cancel")}
            </Button>
            <Button type="submit" disabled={!canStart}>
              {starting ? <Spinner className="me-2 size-4" /> : null}
              {t("database.fillWithAiStart")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useColumnFillMenu(property: DocumentProperty) {
  const controller = useContext(ColumnFillContext);
  if (!controller?.canFill(property)) return undefined;
  return () => controller.openFill(property);
}

const COMPACT_FILL_STATUS_WIDTH = 260;

export function ColumnFillHeaderStatus({
  property,
  width,
  narrow,
}: {
  property: DocumentProperty;
  width: number;
  narrow: boolean;
}) {
  const t = useT();
  const controller = useContext(ColumnFillContext);
  const fill = controller?.entry(property.definition.id)?.fill;
  if (!controller || !fill || !isColumnFillActive(fill.status)) return null;
  const name = property.definition.name;
  const label =
    fill.status === "stopping"
      ? t("database.fillStopping")
      : t("database.fillProgress", { done: fill.settled, total: fill.total });
  const compact =
    !narrow && fill.status === "running" && width < COMPACT_FILL_STATUS_WIDTH;
  return (
    <span
      className="flex shrink-0 items-center gap-1 ps-1 text-xs text-muted-foreground"
      data-column-fill-status={fill.status}
    >
      <Spinner className="size-3" aria-hidden="true" />
      {compact ? (
        <span
          className="whitespace-nowrap tabular-nums"
          aria-hidden="true"
          data-column-fill-compact=""
        >
          {`${fill.settled}/${fill.total}`}
        </span>
      ) : null}
      <span
        className={cn("whitespace-nowrap", (narrow || compact) && "sr-only")}
      >
        {label}
      </span>
      {fill.status === "running" ? (
        <button
          type="button"
          className="rounded px-1 py-0.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("database.fillStopLabel", { name })}
          data-column-fill-stop
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            controller.stop(fill);
          }}
        >
          {t("database.fillStop")}
        </button>
      ) : null}
    </span>
  );
}

export function useColumnFillCell(propertyId: string, documentId: string) {
  const controller = useContext(ColumnFillContext);
  const entry = controller?.entry(propertyId);
  const cell = entry?.cells.get(documentId);
  if (!controller || !entry || !cell) return null;
  return { controller, fill: entry.fill, cell };
}

export function ColumnFillCellBadge({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const t = useT();
  const state = useColumnFillCell(propertyId, documentId);
  const status = state?.cell.status;
  if (status !== "waiting" && status !== "running" && status !== "failed") {
    return null;
  }
  const Icon =
    status === "waiting"
      ? IconClock
      : status === "failed"
        ? IconAlertTriangle
        : null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 start-2 end-2 flex items-center"
      data-column-fill-cell={status}
    >
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate rounded-sm border bg-background px-1.5 py-px text-[11px] leading-4",
          status === "failed"
            ? "border-destructive/30 text-destructive"
            : "border-border text-muted-foreground",
        )}
      >
        {Icon ? (
          <Icon className="size-3 shrink-0" />
        ) : (
          <Spinner className="size-3 shrink-0" />
        )}
        <span className="truncate">{columnFillCellLabel(t, status)}</span>
      </span>
    </span>
  );
}

export function columnFillCellLabel(
  t: ReturnType<typeof useT>,
  status: ColumnFillCell["status"],
): string | null {
  if (status === "waiting") return t("database.fillCellWaiting");
  if (status === "running") return t("database.fillCellRunning");
  if (status === "failed") return t("database.fillCellFailed");
  return null;
}

export function ColumnFillCellActions({
  propertyId,
  documentId,
  onDone,
}: {
  propertyId: string;
  documentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const state = useColumnFillCell(propertyId, documentId);
  if (!state) return null;
  const { controller, fill, cell } = state;
  const openChat = () => {
    onDone();
    if (cell.agentThreadId) {
      requestAgentChatThreadOpen({ threadId: cell.agentThreadId });
    } else {
      openAgentPanel();
    }
  };
  if (cell.status === "filled" && cell.agentThreadId) {
    return (
      <div className="mt-2 border-t pt-2" data-column-fill-actions="filled">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={openChat}
        >
          <IconSparkles className="size-4" aria-hidden="true" />
          {t("database.fillEditInChat")}
        </Button>
      </div>
    );
  }
  if (cell.status !== "failed") return null;
  return (
    <div
      className="mt-2 grid gap-2 border-t pt-2"
      data-column-fill-actions="failed"
    >
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <IconAlertTriangle
          className="mt-px size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span>{cell.error || t("database.fillCellFailed")}</span>
      </p>
      <div className="flex gap-2">
        {fill.status === "stopping" ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              onDone();
              controller.retry(fill, documentId);
            }}
          >
            <IconRefresh className="size-3.5" aria-hidden="true" />
            {t("database.fillTryAgain")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={openChat}
        >
          <IconMessage className="size-3.5" aria-hidden="true" />
          {t("database.fillOpenChat")}
        </Button>
      </div>
    </div>
  );
}
