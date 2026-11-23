import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  IconAlertTriangle,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconChevronDown,
  IconCpu,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type {
  CellRunReceipt,
  RunReceipt,
  RunRequest,
} from "../../../shared/notebook-execution";

export type CellRunMode = Exclude<
  RunRequest["mode"],
  "run-all" | "run-section"
>;

export type CellRunOptions = {
  bypassCache?: boolean;
  selection?: { from: number; to: number };
};

const cellModes = {
  auto: {
    labelKey: "notebook.runModeAutoLabel",
    descriptionKey: "notebook.runModeAutoDescription",
    key: "A",
    icon: IconPlayerPlayFilled,
  },
  upstream: {
    labelKey: "notebook.runModeUpstreamLabel",
    descriptionKey: "notebook.runModeUpstreamDescription",
    key: "S",
    icon: IconArrowBarToUp,
  },
  "cell-only": {
    labelKey: "notebook.runModeCellOnlyLabel",
    descriptionKey: "notebook.runModeCellOnlyDescription",
    key: "D",
    icon: IconPlayerPlayFilled,
  },
  downstream: {
    labelKey: "notebook.runModeDownstreamLabel",
    descriptionKey: "notebook.runModeDownstreamDescription",
    key: undefined,
    icon: IconArrowBarToDown,
  },
} satisfies Record<
  CellRunMode,
  {
    labelKey: string;
    descriptionKey: string;
    key: string | undefined;
    icon: typeof IconPlayerPlayFilled;
  }
>;

const menuModes: readonly CellRunMode[] = [
  "auto",
  "upstream",
  "cell-only",
  "downstream",
];

export function getCellRunShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): CellRunMode | undefined {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey)
    return undefined;
  return menuModes.find(
    (mode) => cellModes[mode].key === event.key.toUpperCase(),
  );
}

function isMac() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  );
}

export function cellRunShortcutLabel(mode: CellRunMode): string | undefined {
  const { key } = cellModes[mode];
  if (key === undefined) return undefined;
  return isMac() ? `⌘⇧${key}` : `Ctrl+Shift+${key}`;
}

export function useLastRunLabel(ranAt: string | undefined) {
  const t = useT();
  const { formatNumber, formatRelativeTime } = useFormatters();
  const time = ranAt ? Date.parse(ranAt) : Number.NaN;
  if (!Number.isFinite(time)) return undefined;
  const elapsed = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (elapsed < 1) return t("notebook.justNow");
  if (elapsed < 60)
    return t("notebook.runMinutesAgo", { count: formatNumber(elapsed) });
  if (elapsed < 1_440)
    return formatRelativeTime(-Math.floor(elapsed / 60), "hour");
  return formatRelativeTime(-Math.floor(elapsed / 1_440), "day");
}

export function CellRunButton({
  title,
  mode,
  stale,
  blocked,
  failed,
  disabledReason,
  disabled,
  busy,
  onRun,
}: {
  title: string;
  mode: CellRunMode;
  stale: boolean;
  blocked: boolean;
  failed: boolean;
  disabledReason: string | undefined;
  disabled: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  const t = useT();
  const runDescription = t(cellModes[mode].descriptionKey);
  const showFailedHint =
    disabledReason === undefined && failed && !stale && !blocked;
  const description =
    disabledReason ??
    (blocked
      ? t("notebook.cancelledUpstream")
      : showFailedHint
        ? t("notebook.runEncounteredError")
        : runDescription);
  const staleLabel = t("notebook.staleOutput");
  const runLabel = t("notebook.runNamedCell", { title });
  return (
    <Tooltip
      content={
        <>
          {stale && !blocked && <strong className="block">{staleLabel}</strong>}
          <span>{description}</span>
          {showFailedHint && <span className="block">{runDescription}</span>}
          {!blocked && (!failed || stale) && (
            <kbd className="ms-2">{isMac() ? "⌘Enter" : "Ctrl+Enter"}</kbd>
          )}
        </>
      }
      trigger={
        <button
          type="button"
          className="nb-icon-button nb-run-button"
          data-rid="notebook.cell.run"
          data-part="notebook.cell.action"
          data-stale={stale && !blocked ? "" : undefined}
          data-blocked={blocked ? "" : undefined}
          data-failed={failed && !stale && !blocked ? "" : undefined}
          aria-label={
            stale && !blocked ? `${runLabel} · ${staleLabel}` : runLabel
          }
          aria-description={description}
          aria-busy={busy}
          disabled={disabled}
          onClick={onRun}
        >
          {busy ? (
            <span className="nb-spinner" aria-hidden="true" />
          ) : blocked ? (
            <IconAlertTriangle size={14} aria-hidden="true" />
          ) : (
            <IconPlayerPlayFilled size={14} aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}

export function CellRunActions({
  disabled,
  ranAt,
  durationMs,
  onRun,
}: {
  disabled: boolean;
  ranAt: string | undefined;
  durationMs: number | null | undefined;
  onRun: (mode: CellRunMode) => void;
}) {
  const t = useT();
  const { formatDate, formatNumber } = useFormatters();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const lastRun = useLastRunLabel(ranAt);
  const duration =
    durationMs == null
      ? null
      : t("notebook.runModeDuration", {
          seconds: formatNumber(durationMs / 1_000, {
            maximumFractionDigits: 2,
          }),
        });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="nb-icon-button"
            aria-label={t("notebook.runModeMenuLabel")}
            disabled={disabled}
          >
            <IconChevronDown size={12} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="nb-cell-run-menu">
          {menuModes.map((item) => {
            const { icon: Icon, labelKey, descriptionKey } = cellModes[item];
            const shortcut = cellRunShortcutLabel(item);
            return (
              <DropdownMenuItem
                key={item}
                className="items-start"
                aria-label={t(labelKey)}
                aria-description={t(descriptionKey)}
                onSelect={() => onRun(item)}
              >
                <Icon size={12} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block">{t(labelKey)}</span>
                  <span className="text-muted-foreground block text-xs">
                    {t(descriptionKey)}
                  </span>
                </span>
                {shortcut && (
                  <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between gap-2">
            <DropdownMenuLabel>{t("notebook.runModeStats")}</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={lastRun === undefined}
              onSelect={() => setDetailsOpen(true)}
            >
              {t("notebook.runModeViewMore")}
            </DropdownMenuItem>
          </div>
          <div className="text-muted-foreground space-y-1 px-1.5 py-1 text-xs">
            <div className="flex justify-between gap-3">
              <span>{t("notebook.runModeLastRun")}</span>
              <span>{lastRun ?? "–"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("notebook.runModeRuntime")}</span>
              <span>{duration ?? "–"}</span>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {ranAt && lastRun && (
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent>
            <DialogTitle>{t("notebook.runModeStats")}</DialogTitle>
            <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm">
              <dt>{t("notebook.runModeLastRun")}</dt>
              <dd>
                {formatDate(ranAt, { dateStyle: "medium", timeStyle: "long" })}
              </dd>
              <dt>{t("notebook.runModeRuntime")}</dt>
              <dd>{duration ?? "–"}</dd>
            </dl>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const runStateLabels = {
  queued: "notebook.runQueued",
  running: "notebook.running",
  cancelled: "notebook.runInterrupted",
  complete: "notebook.runComplete",
  failed: "notebook.runCellFailed",
  blocked: "notebook.cancelledUpstream",
} satisfies Record<CellRunReceipt["state"]["status"], string>;

const rejectionLabels = {
  parse_error: "notebook.runParseError",
  missing_prerequisite: "notebook.runPrerequisite",
  incompatible_prerequisite: "notebook.runPrerequisite",
} satisfies Record<
  RunReceipt["plan"]["rejectedCells"][number]["reason"],
  string
>;

function NotebookRunProgress({
  run,
  states,
  cellTitles,
}: {
  run: RunReceipt;
  states: ReadonlyMap<string, CellRunReceipt["state"]["status"]>;
  cellTitles?: ReadonlyMap<string, string> | undefined;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const admitted = run.plan.admittedCellIds;
  const done = admitted.filter((id) => {
    const status = states.get(id);
    return status !== undefined && status !== "running" && status !== "queued";
  }).length;
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(run.startedAt)) / 1_000),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="nb-run-progress">
          <span className="nb-spinner" aria-hidden="true" />
          <span role="status" className="nb-run-progress-title">
            {t("notebook.runProgress", {
              seconds: formatNumber(seconds),
              done: formatNumber(done),
              total: formatNumber(admitted.length),
            })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="nb-popover">
        <div className="nb-run-progress-rows">
          {admitted.map((id) => (
            <div className="nb-run-progress-row" key={id}>
              <span className="nb-run-progress-label">
                {cellTitles?.get(id) ?? id}
              </span>
              <span className="nb-run-progress-status">
                {t(runStateLabels[states.get(id) ?? "queued"])}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type KernelStatus = {
  phase: "idle" | "starting" | "running" | "ready" | "error";
  runtime: "Pyodide" | "Python";
  cells: number;
  editedAt: string;
  lastRunAt?: string | undefined;
  durations: ReadonlyArray<{ label: string; milliseconds: number }>;
};

function KernelStatusPopover({ status }: { status: KernelStatus }) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const edited = useLastRunLabel(status.editedAt);
  const lastRun = useLastRunLabel(status.lastRunAt);
  const label = t(
    {
      idle: "notebookKernel.notStarted",
      starting: "notebook.runRestarting",
      running: "notebook.running",
      ready: "notebookKernel.idle",
      error: "notebookKernel.unavailable",
    }[status.phase],
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nb-button nb-kernel-trigger"
          aria-label={t("notebookKernel.title")}
          title={t("notebookKernel.title")}
        >
          <IconCpu size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nb-popover nb-kernel-status"
        aria-label={t("notebookKernel.title")}
      >
        <strong>{label}</strong>
        <span>{status.runtime}</span>
        <span>{t("notebookKernel.memoryUnavailable")}</span>
        <span>
          {t("notebookKernel.cells", { count: formatNumber(status.cells) })}
        </span>
        {lastRun && (
          <span>{t("notebook.lastRunTooltip", { when: lastRun })}</span>
        )}
        {edited && <span>{t("notebookKernel.edited", { when: edited })}</span>}
        {status.durations.length > 0 && (
          <details>
            <summary>{t("notebookKernel.performance")}</summary>
            {status.durations.map(({ label, milliseconds }, index) => (
              <div className="nb-run-progress-row" key={index}>
                <span>{label}</span>
                <span>
                  {t("notebook.runModeDuration", {
                    seconds: formatNumber(milliseconds / 1_000, {
                      maximumFractionDigits: 2,
                    }),
                  })}
                </span>
              </div>
            ))}
          </details>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function NotebookRunControls({
  canRun,
  showRunAll = true,
  busy,
  run,
  saving,
  pending,
  restarting,
  stopping,
  browserRunning,
  kernelStatus,
  defaultMode,
  autoRerun,
  cellTitles,
  onRunAll,
  onInterrupt,
  onClearOutputs,
  onDefaultModeChange,
  onAutoRerunChange,
  onRestart,
  onStop,
  onConfigureEnvironment,
}: {
  canRun: boolean;
  showRunAll?: boolean;
  busy: boolean;
  run: RunReceipt | null;
  saving?: boolean;
  pending: boolean;
  restarting?: boolean | undefined;
  stopping: boolean;
  browserRunning?: boolean | undefined;
  kernelStatus?: KernelStatus | undefined;
  defaultMode: CellRunMode;
  autoRerun?: boolean;
  cellTitles?: ReadonlyMap<string, string>;
  onRunAll: (options: { restart?: boolean; bypassCache?: boolean }) => void;
  onInterrupt: () => void;
  onClearOutputs: () => void;
  onDefaultModeChange: (mode: CellRunMode) => void;
  onAutoRerunChange?: ((value: boolean) => void) | undefined;
  onRestart?: (() => void) | undefined;
  onStop?: (() => void) | undefined;
  onConfigureEnvironment?: (() => void) | undefined;
}) {
  const t = useT();
  const active =
    run?.attempts.some(
      ({ state }) => state.status === "running" || state.status === "queued",
    ) ?? false;
  const states = new Map(
    run?.attempts.map(({ attempt, state }) => [attempt.cellId, state.status]),
  );
  const admitted = run?.plan.admittedCellIds ?? [];
  const rejected = run?.plan.rejectedCells ?? [];
  const completed =
    run != null &&
    admitted.length > 0 &&
    rejected.length === 0 &&
    admitted.every((id) => states.get(id) === "complete");

  return (
    <div className="nb-run-all-bar">
      {restarting ? (
        <span role="status" className="nb-run-progress-title">
          {t("notebook.runRestarting")}
        </span>
      ) : pending ? (
        <span role="status" className="nb-run-progress-title">
          {t("notebook.runSavingChanges")}
        </span>
      ) : saving ? (
        <span role="status" className="nb-run-progress-title">
          {t("notebook.saving")}
        </span>
      ) : completed ? (
        <span className="sr-only" role="status">
          {t("notebook.runComplete")}
        </span>
      ) : null}
      {rejected.length > 0 && (
        <div className="nb-run-rejections" role="status">
          {rejected.map(({ cellId, reason }) => (
            <span key={cellId}>
              {t("notebook.runRejectedCell", {
                title: cellTitles?.get(cellId) ?? cellId,
                reason: t(rejectionLabels[reason]),
              })}
            </span>
          ))}
        </div>
      )}
      {(active || browserRunning) && (
        <Tooltip
          content={t(
            browserRunning
              ? "notebook.runInterruptBrowserTooltip"
              : "notebook.runInterruptTooltip",
          )}
          className="max-w-xs"
          trigger={
            <button
              type="button"
              className="nb-button"
              disabled={stopping}
              onClick={() => onInterrupt()}
            >
              {t(
                stopping ? "notebook.runInterrupting" : "notebook.runInterrupt",
              )}
            </button>
          }
        />
      )}
      {active && run && (
        <NotebookRunProgress
          key={run.runId}
          run={run}
          states={states}
          cellTitles={cellTitles}
        />
      )}
      {kernelStatus && <KernelStatusPopover status={kernelStatus} />}
      <div className="nb-run-split">
        {showRunAll && (
          <button
            type="button"
            className="nb-button"
            disabled={!canRun || busy}
            aria-busy={busy}
            title={t(
              canRun
                ? "notebook.inlineInsert.addCell"
                : "notebook.runAllUnavailable",
            )}
            onClick={() => onRunAll({})}
          >
            {t("notebook.runAll")}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="nb-button nb-run-menu-trigger"
              aria-label={t("notebook.runAllMenuLabel")}
            >
              <IconChevronDown size={12} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRestart && (
              <DropdownMenuItem disabled={busy} onSelect={onRestart}>
                {t("notebook.runRestart")}
              </DropdownMenuItem>
            )}
            {onStop && (
              <DropdownMenuItem onSelect={() => onStop()} disabled={stopping}>
                {t("notebook.runStop")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!canRun || busy}
              aria-label={t("notebook.runRestartAndRunAll")}
              aria-keyshortcuts="Alt+R"
              onSelect={() => onRunAll({ restart: true })}
            >
              {t("notebook.runRestartAndRunAll")}
              <DropdownMenuShortcut>
                {isMac() ? "⌥R" : "Alt+R"}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canRun || busy}
              onSelect={() => onRunAll({ bypassCache: true })}
            >
              {t("notebook.runAllWithoutCachedResults")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClearOutputs}>
              {t("notebook.runClearOutputs")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>{t("notebook.runModeMenuLabel")}</span>
                <span className="ml-auto pl-3 text-xs text-muted-foreground">
                  {t(cellModes[defaultMode].labelKey)}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={defaultMode}>
                  {menuModes.map((mode) => (
                    <DropdownMenuRadioItem
                      key={mode}
                      value={mode}
                      onSelect={() => onDefaultModeChange(mode)}
                    >
                      {t(cellModes[mode].labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {onAutoRerunChange && (
              <DropdownMenuCheckboxItem
                checked={autoRerun ?? true}
                onCheckedChange={onAutoRerunChange}
              >
                {t("notebook.runAutoRerun")}
              </DropdownMenuCheckboxItem>
            )}
            {onConfigureEnvironment && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onConfigureEnvironment}>
                  {t("notebook.runConfigureEnvironment")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
