import { useT } from "@agent-native/core/client/i18n";
import {
  estimateTextWidth,
  spanLabelX,
  trimToWholeWords,
} from "@shared/chart-axis-labels";
import {
  dataNotesOnChart,
  dataNoteTone,
  formatDataNoteDates,
  type DataNote,
  type DataNoteBand,
  type DataNoteTone,
} from "@shared/data-notes";
import {
  IconCheck,
  IconEyeOff,
  IconFlagFilled,
  IconPencil,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ReferenceArea, usePlotArea, useXAxisScale } from "recharts";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { isPendingAnnotation } from "./annotation-mutations";
import { useChartHoverCardOpen } from "./chart-hover-card";
import { useDataNoteActions } from "./dashboard-annotations-context";

const TONE_COLORS: Record<DataNoteTone, string> = {
  incident: "hsl(var(--destructive))",
  data: "var(--brand-orange)",
  fixed: "hsl(var(--muted-foreground))",
};

const TONE_ORDER: DataNoteTone[] = ["incident", "data", "fixed"];

export function dataNoteColor(note: Pick<DataNote, "kind" | "status">) {
  return TONE_COLORS[dataNoteTone(note)];
}

/** Below Area series, above the grid. */
const BAND_Z_INDEX = 50;
/** Above series dots, so the label stays hoverable. */
const LABEL_Z_INDEX = 650;
const LABEL_FONT_SIZE = 10;
const LABEL_HEIGHT = 16;
const LABEL_GAP = 2;
const LABEL_PADDING = 6;
const LABEL_INSET = 2;
/** Between the lowest title row and the plot, clear of the top y-axis label. */
const LABEL_CLEARANCE = 8;
/** Recharts' default margin on each side of a chart. */
const CHART_EDGE = 5;

function DataNoteDetails({
  note,
  panelId,
  onAction,
}: {
  note: DataNote;
  panelId?: string;
  onAction: () => void;
}) {
  const t = useT();
  const actions = useDataNoteActions();
  const dates = formatDataNoteDates(note);
  const pending = isPendingAnnotation(note.id);
  const act = (run: () => void) => () => {
    onAction();
    run();
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: dataNoteColor(note) }}
        />
        <span className="font-medium text-popover-foreground">
          {note.title}
        </span>
      </div>
      {dates ? (
        <div className="text-[11px] text-muted-foreground">
          {dates.kind === "since"
            ? t("dataNotes.since", { date: dates.text })
            : dates.kind === "until"
              ? t("dataNotes.until", { date: dates.text })
              : dates.text}
        </div>
      ) : null}
      <p className="whitespace-pre-line text-popover-foreground">{note.note}</p>
      {note.status === "fixed" && note.fix ? (
        <p className="text-popover-foreground">
          {t("dataNotes.fix", { fix: note.fix })}
        </p>
      ) : null}
      <div className="text-[11px] text-muted-foreground">
        {[
          note.kind === "incident"
            ? t("dataNotes.incident")
            : t("dataNotes.dataProblem"),
          note.status === "fixed" ? t("dataNotes.fixed") : null,
          note.addedBy ? t("dataNotes.addedBy", { email: note.addedBy }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {actions?.edit || actions?.hide ? (
        <div className="-mx-2 flex flex-wrap gap-0.5">
          {actions.edit ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={act(() => actions.edit?.(note))}
            >
              <IconPencil className="size-3.5" />
              {t("annotations.edit")}
            </Button>
          ) : null}
          {note.status === "open" && actions.markFixed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={act(() => actions.markFixed?.(note))}
            >
              <IconCheck className="size-3.5" />
              {t("annotations.markFixed")}
            </Button>
          ) : null}
          {panelId && actions.hide ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={act(() => actions.hide?.(note.id, panelId))}
            >
              <IconEyeOff className="size-3.5" />
              {t("annotations.hideHere")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The card is portaled out of the chart's DOM but not out of its React tree,
 * so its focus and key events would reach the chart as the chart's own:
 * clicking a card button would pin the chart's tooltip at its first point.
 */
const keepFromChart = (event: SyntheticEvent) => event.stopPropagation();

function DataNoteHoverCard({
  notes,
  panelId,
  side,
  children,
  onHoverChange,
}: {
  notes: readonly DataNote[];
  panelId?: string;
  /** Toward the chart, so a card by its top edge doesn't cover the header. */
  side: "top" | "bottom";
  children: ReactNode;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const [open, setOpen] = useChartHoverCardOpen(onHoverChange);
  return (
    // Portaled, so the card is never clipped by the chart or the card edge.
    <HoverCard open={open} onOpenChange={setOpen} openDelay={0} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side={side}
        collisionPadding={8}
        onFocus={keepFromChart}
        onBlur={keepFromChart}
        onKeyDown={keepFromChart}
        className="w-80 max-w-[calc(100vw-1rem)] space-y-3 divide-y divide-border p-3 text-xs [&>*+*]:pt-3"
      >
        {notes.map((note) => (
          <DataNoteDetails
            key={note.id}
            note={note}
            panelId={panelId}
            onAction={() => setOpen(false)}
          />
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

export interface ShadedDataNote {
  note: DataNote;
  /** In row order; more than one when the rows are not in date order. */
  bands: DataNoteBand[];
}

const UnplacedDataNotesContext = createContext<
  ((notes: readonly DataNote[]) => void) | null
>(null);

/** Hears which notes a time chart writes under its plot, so its card can flag them by the title. */
export const UnplacedDataNotesListener = UnplacedDataNotesContext.Provider;

/**
 * Where each note falls on a chart's x values: bands over the dates it
 * covers, or a line under the chart when it can't be placed on them.
 */
export function useDataNoteLayout(
  notes: readonly DataNote[],
  rows: readonly Record<string, unknown>[],
  xKey: string,
): { shaded: ShadedDataNote[]; unplaced: DataNote[] } {
  const layout = useMemo(() => {
    if (notes.length === 0) return { shaded: [], unplaced: [] };
    const shown = dataNotesOnChart(
      notes,
      rows.map((row) => row[xKey]),
      { xKey },
    );
    return {
      shaded: shown.filter(({ bands }) => bands.length > 0),
      unplaced: shown.flatMap(({ note, bands }) =>
        bands.length > 0 ? [] : [note],
      ),
    };
  }, [notes, rows, xKey]);
  const listen = useContext(UnplacedDataNotesContext);
  useEffect(() => {
    if (!listen) return;
    listen(layout.unplaced);
    return () => listen([]);
  }, [listen, layout.unplaced]);
  return layout;
}

type XAxisScale = NonNullable<ReturnType<typeof useXAxisScale>>;
type PlotArea = NonNullable<ReturnType<typeof usePlotArea>>;

/**
 * A point axis maps a value to a line, so pad half a step, between the first
 * two values it places, to cover the day. With fewer than two placed values
 * (one row, or one beside a null bucket) there is no step, and the day is the
 * whole plot.
 */
function bandEdges(
  scale: XAxisScale,
  plot: PlotArea,
  x1: unknown,
  x2: unknown,
  xValues: readonly unknown[],
): { left: number; right: number; top: number; bottom: number } | null {
  const start = scale(x1, { position: "start" });
  const end = scale(x2, { position: "end" });
  if (start == null || end == null) return null;
  let pad = 0;
  if (start === scale(x1, { position: "end" })) {
    const placed: number[] = [];
    for (const value of xValues) {
      const at = value == null ? null : scale(value);
      if (at != null && placed.push(at) === 2) break;
    }
    pad = placed.length < 2 ? plot.width : Math.abs(placed[1] - placed[0]) / 2;
  }
  return {
    left: Math.max(plot.x, Math.min(start, end) - pad),
    right: Math.min(plot.x + plot.width, Math.max(start, end) + pad),
    top: plot.y,
    bottom: plot.y + plot.height,
  };
}

function BandShape({
  x1,
  x2,
  xValues,
  color,
  band,
}: {
  x1: unknown;
  x2: unknown;
  xValues: readonly unknown[];
  color: string;
  band: DataNoteBand;
}) {
  const scale = useXAxisScale();
  const plot = usePlotArea();
  const edges = scale && plot ? bandEdges(scale, plot, x1, x2, xValues) : null;
  if (!edges) return null;
  const { left, right, top, bottom } = edges;
  return (
    <g data-data-note-band="" pointerEvents="none">
      <rect
        x={left}
        y={top}
        width={Math.max(1, right - left)}
        height={bottom - top}
        fill={color}
        fillOpacity={0.1}
      />
      {band.startEdge ? (
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={bottom}
          stroke={color}
          strokeOpacity={0.55}
        />
      ) : null}
      {band.endEdge ? (
        <line
          x1={right}
          x2={right}
          y1={top}
          y2={bottom}
          stroke={color}
          strokeOpacity={0.55}
        />
      ) : null}
    </g>
  );
}

export interface DataNoteLabelSlot {
  text: string;
  x: number;
  width: number;
  /** Rows stack labels that would otherwise cover each other. */
  row: number;
}

/**
 * Title pills for bands spanning [left, right]. A pill keeps its whole title
 * and runs past a narrow band, ending at the band's right edge instead when it
 * would leave the plot. Only a title wider than the plot is shortened, at a
 * word; the hover card still shows it whole.
 */
export function layoutDataNoteLabels(
  spans: readonly { left: number; right: number; title: string }[],
  plotLeft: number,
  plotRight: number,
): DataNoteLabelSlot[] {
  const rows: Array<Array<[number, number]>> = [];
  const maxTextWidth =
    plotRight - plotLeft - 2 * LABEL_INSET - 2 * LABEL_PADDING;
  return spans.map(({ left, right, title }) => {
    const text = trimToWholeWords(title, LABEL_FONT_SIZE, maxTextWidth);
    const width = estimateTextWidth(text, LABEL_FONT_SIZE) + 2 * LABEL_PADDING;
    const x = spanLabelX(left, right, width, plotLeft, plotRight, LABEL_INSET);
    let row = rows.findIndex((taken) =>
      taken.every(
        ([start, end]) =>
          start - LABEL_GAP >= x + width || x - LABEL_GAP >= end,
      ),
    );
    if (row === -1) row = rows.length;
    (rows[row] ??= []).push([x, x + width]);
    return { text, x, width, row };
  });
}

/**
 * The chart margin that holds the band titles' rows above the plot. One row
 * is reserved until the titles are laid out, since most charts need just one.
 */
export function useDataNoteChartMargin(shaded: readonly ShadedDataNote[]) {
  const [rows, setRows] = useState(1);
  const labelRows = shaded.length > 0 ? rows : 0;
  const margin = useMemo(
    () => ({
      top:
        CHART_EDGE +
        (labelRows > 0
          ? LABEL_CLEARANCE + labelRows * (LABEL_HEIGHT + LABEL_GAP)
          : 0),
      right: CHART_EDGE,
      bottom: CHART_EDGE,
      left: CHART_EDGE,
    }),
    [labelRows],
  );
  return { margin, onLabelRows: setRows };
}

/**
 * One title per note, at its first band, in rows above the plot. Up there a
 * title covers no data, axis label or key-date line, and rows keep titles
 * off each other.
 */
function BandLabels({
  shaded,
  rows,
  xKey,
  xValues,
  panelId,
  onHoverChange,
  onLabelRows,
}: {
  shaded: readonly ShadedDataNote[];
  rows: readonly Record<string, unknown>[];
  xKey: string;
  xValues: readonly unknown[];
  panelId?: string;
  onHoverChange?: (hovered: boolean) => void;
  onLabelRows?: (rows: number) => void;
}) {
  const scale = useXAxisScale();
  const plot = usePlotArea();
  const placed =
    scale && plot
      ? shaded.flatMap((entry) => {
          const edges = bandEdges(
            scale,
            plot,
            rows[entry.bands[0].startIndex][xKey],
            rows[entry.bands[0].endIndex][xKey],
            xValues,
          );
          return edges ? [{ entry, edges }] : [];
        })
      : null;
  const slots =
    placed && plot
      ? layoutDataNoteLabels(
          placed.map(({ entry, edges }) => ({
            left: edges.left,
            right: edges.right,
            title: entry.note.title,
          })),
          plot.x,
          plot.x + plot.width,
        )
      : null;
  const rowCount = slots
    ? slots.reduce((count, slot) => Math.max(count, slot.row + 1), 0)
    : null;
  useLayoutEffect(() => {
    if (rowCount !== null) onLabelRows?.(rowCount);
  }, [onLabelRows, rowCount]);
  if (!placed || !slots || !plot) return null;
  return (
    <>
      {placed.map(({ entry }, index) => {
        const { text, x, width, row } = slots[index];
        const y =
          plot.y -
          LABEL_CLEARANCE -
          LABEL_HEIGHT -
          row * (LABEL_HEIGHT + LABEL_GAP);
        return (
          <DataNoteHoverCard
            key={entry.note.id}
            notes={[entry.note]}
            panelId={panelId}
            side="bottom"
            onHoverChange={onHoverChange}
          >
            <g
              data-data-note-label=""
              style={{ cursor: "default" }}
              onMouseMove={(e) => e.stopPropagation()}
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={LABEL_HEIGHT}
                rx={4}
                fill="hsl(var(--background))"
                stroke={dataNoteColor(entry.note)}
                strokeOpacity={0.7}
              />
              <text
                x={x + LABEL_PADDING}
                y={y + LABEL_HEIGHT / 2}
                dominantBaseline="central"
                fontSize={LABEL_FONT_SIZE}
                fill="hsl(var(--foreground))"
              >
                {text}
              </text>
            </g>
          </DataNoteHoverCard>
        );
      })}
    </>
  );
}

export function renderDataNoteBands(
  shaded: readonly ShadedDataNote[],
  {
    rows,
    xKey,
    yAxisId,
    panelId,
    onHoverChange,
    onLabelRows,
  }: {
    rows: readonly Record<string, unknown>[];
    xKey: string;
    yAxisId?: string;
    panelId: string;
    onHoverChange?: (hovered: boolean) => void;
    /** Hears how many title rows sit above the plot; see `useDataNoteChartMargin`. */
    onLabelRows?: (rows: number) => void;
  },
): ReactNode[] {
  if (shaded.length === 0) return [];
  const xValues = rows.map((row) => row[xKey]);
  const xValue = (index: number) => rows[index][xKey] as string | number;
  return [
    ...shaded.flatMap(({ note, bands }) =>
      bands.map((band) => {
        const x1 = xValue(band.startIndex);
        const x2 = xValue(band.endIndex);
        return (
          <ReferenceArea
            key={`data-note-${note.id}-${band.startIndex}`}
            x1={x1}
            x2={x2}
            yAxisId={yAxisId}
            ifOverflow="visible"
            zIndex={BAND_Z_INDEX}
            shape={
              <BandShape
                x1={x1}
                x2={x2}
                xValues={xValues}
                color={dataNoteColor(note)}
                band={band}
              />
            }
          />
        );
      }),
    ),
    // One layer for every title, so each pill is placed knowing where the others are.
    <ReferenceArea
      key="data-note-labels"
      x1={xValue(0)}
      x2={xValue(rows.length - 1)}
      yAxisId={yAxisId}
      ifOverflow="visible"
      zIndex={LABEL_Z_INDEX}
      shape={
        <BandLabels
          shaded={shaded}
          rows={rows}
          xKey={xKey}
          xValues={xValues}
          panelId={panelId}
          onHoverChange={onHoverChange}
          onLabelRows={onLabelRows}
        />
      }
    />,
  ];
}

const MAX_LINES = 2;

/** One line per note under a chart that can't place it on its dates. */
export function DataNoteLines({
  notes,
  panelId,
}: {
  notes: readonly DataNote[];
  panelId: string;
}) {
  const t = useT();
  if (notes.length === 0) return null;
  const shown = notes.slice(0, MAX_LINES);
  const rest = notes.slice(MAX_LINES);
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs" data-data-note-lines="">
      {shown.map((note) => {
        const dates = formatDataNoteDates(note);
        return (
          <li key={note.id} className="min-w-0">
            <DataNoteHoverCard notes={[note]} panelId={panelId} side="top">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 rounded text-left text-muted-foreground hover:text-foreground"
              >
                <IconFlagFilled
                  className="size-3 shrink-0"
                  style={{ color: dataNoteColor(note) }}
                />
                <span className="truncate">{note.title}</span>
                {dates ? (
                  <span className="shrink-0 tabular-nums">{dates.text}</span>
                ) : null}
              </button>
            </DataNoteHoverCard>
          </li>
        );
      })}
      {rest.length > 0 ? (
        <li>
          <DataNoteHoverCard notes={rest} panelId={panelId} side="top">
            <button
              type="button"
              className="rounded text-muted-foreground hover:text-foreground"
            >
              {t("dataNotes.more", { count: rest.length })}
            </button>
          </DataNoteHoverCard>
        </li>
      ) : null}
    </ul>
  );
}

/** A flag by a chart's title, in the color of its most serious note. */
export function DataNoteFlag({
  notes,
  panelId,
}: {
  notes: readonly DataNote[];
  panelId: string;
}) {
  const t = useT();
  if (notes.length === 0) return null;
  const tone = TONE_ORDER.find((candidate) =>
    notes.some((note) => dataNoteTone(note) === candidate),
  )!;
  return (
    <DataNoteHoverCard notes={notes} panelId={panelId} side="bottom">
      <button
        type="button"
        className="shrink-0 rounded p-0.5"
        aria-label={t("dataNotes.flagLabel")}
        data-data-note-flag=""
      >
        <IconFlagFilled
          className="size-3.5"
          style={{ color: TONE_COLORS[tone] }}
        />
      </button>
    </DataNoteHoverCard>
  );
}
