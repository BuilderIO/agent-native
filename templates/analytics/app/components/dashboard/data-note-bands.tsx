import { useT } from "@agent-native/core/client/i18n";
import { estimateTextWidth, trimToWidth } from "@shared/chart-axis-labels";
import {
  dataNoteIsRecent,
  dataNoteTone,
  formatDataNoteDates,
  resolveDataNoteBand,
  xValuesAreDates,
  type DataNote,
  type DataNoteBand,
  type DataNoteTone,
} from "@shared/data-notes";
import { IconFlagFilled } from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { ReferenceArea, usePlotArea, useXAxisScale } from "recharts";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

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
const LABEL_MIN_WIDTH = 72;

function DataNoteDetails({ note }: { note: DataNote }) {
  const t = useT();
  const dates = formatDataNoteDates(note);
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
          t("dataNotes.addedBy", { email: note.addedBy }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}

function DataNoteHoverCard({
  notes,
  children,
  onHoverChange,
}: {
  notes: readonly DataNote[];
  children: ReactNode;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onHoverChange?.(value);
  };
  return (
    // Portaled, so the card is never clipped by the chart or the card edge.
    <HoverCard open={open} onOpenChange={setOpen} openDelay={0} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        collisionPadding={8}
        className="w-80 max-w-[calc(100vw-1rem)] space-y-3 divide-y divide-border p-3 text-xs [&>*+*]:pt-3"
      >
        {notes.map((note) => (
          <DataNoteDetails key={note.id} note={note} />
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

export interface PlacedDataNoteBand {
  note: DataNote;
  band: DataNoteBand;
  /** Label row, so overlapping notes stack instead of covering each other. */
  row: number;
}

/**
 * Where each note falls on a chart's x values. When the x axis is not
 * dates, no note can be placed, so recent ones are listed under the chart.
 */
export function useDataNoteLayout(
  notes: readonly DataNote[],
  rows: readonly Record<string, unknown>[],
  xKey: string,
): { bands: PlacedDataNoteBand[]; unplaced: DataNote[] } {
  return useMemo(() => {
    if (notes.length === 0) return { bands: [], unplaced: [] };
    const xValues = rows.map((row) => row[xKey]);
    if (!xValuesAreDates(xValues)) {
      return {
        bands: [],
        unplaced: notes.filter((note) => dataNoteIsRecent(note)),
      };
    }
    const bands: PlacedDataNoteBand[] = [];
    for (const note of notes) {
      const band = resolveDataNoteBand(note, xValues);
      if (!band) continue;
      const taken = new Set(
        bands
          .filter(
            (other) =>
              band.endIndex >= other.band.startIndex &&
              other.band.endIndex >= band.startIndex,
          )
          .map((other) => other.row),
      );
      let row = 0;
      while (taken.has(row)) row++;
      bands.push({ note, band, row });
    }
    return { bands, unplaced: [] };
  }, [notes, rows, xKey]);
}

interface AreaShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** A point axis maps a value to a line, so pad half a step to cover the day. */
function useBandEdges(
  shape: AreaShapeProps,
  x1: unknown,
  stepValues: readonly unknown[],
): { left: number; right: number; top: number; bottom: number } | null {
  const scale = useXAxisScale();
  const plot = usePlotArea();
  if (shape.x == null || shape.width == null || !plot) return null;
  let pad = 0;
  if (
    scale &&
    stepValues.length === 2 &&
    scale(x1, { position: "start" }) === scale(x1, { position: "end" })
  ) {
    const a = scale(stepValues[0]);
    const b = scale(stepValues[1]);
    if (a != null && b != null) pad = Math.abs(b - a) / 2;
  }
  return {
    left: Math.max(plot.x, shape.x - pad),
    right: Math.min(plot.x + plot.width, shape.x + shape.width + pad),
    top: plot.y,
    bottom: plot.y + plot.height,
  };
}

function BandShape({
  x1,
  stepValues,
  color,
  band,
  ...shape
}: AreaShapeProps & {
  x1: unknown;
  stepValues: readonly unknown[];
  color: string;
  band: DataNoteBand;
}) {
  const edges = useBandEdges(shape, x1, stepValues);
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

function BandLabel({
  x1,
  stepValues,
  color,
  placed,
  onHoverChange,
  ...shape
}: AreaShapeProps & {
  x1: unknown;
  stepValues: readonly unknown[];
  color: string;
  placed: PlacedDataNoteBand;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const edges = useBandEdges(shape, x1, stepValues);
  if (!edges) return null;
  const maxWidth = Math.max(LABEL_MIN_WIDTH, edges.right - edges.left - 4);
  const text = trimToWidth(placed.note.title, LABEL_FONT_SIZE, maxWidth - 12);
  const width = Math.min(
    maxWidth,
    estimateTextWidth(text, LABEL_FONT_SIZE) + 12,
  );
  const x = Math.min(edges.left + 2, edges.right - 2 - width);
  const y = edges.top + 2 + placed.row * (LABEL_HEIGHT + LABEL_GAP);
  return (
    <DataNoteHoverCard notes={[placed.note]} onHoverChange={onHoverChange}>
      <g
        data-data-note-label=""
        style={{ cursor: "default" }}
        onMouseMove={(e) => e.stopPropagation()}
      >
        <rect
          x={Math.max(x, 0)}
          y={y}
          width={width}
          height={LABEL_HEIGHT}
          rx={4}
          fill="hsl(var(--background))"
          stroke={color}
          strokeOpacity={0.7}
        />
        <text
          x={Math.max(x, 0) + 6}
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
}

export function renderDataNoteBands(
  bands: readonly PlacedDataNoteBand[],
  rows: readonly Record<string, unknown>[],
  xKey: string,
  yAxisId?: string,
  onHoverChange?: (hovered: boolean) => void,
): ReactNode[] {
  if (bands.length === 0) return [];
  const stepValues = rows.slice(0, 2).map((row) => row[xKey]);
  return bands.flatMap((placed) => {
    const color = dataNoteColor(placed.note);
    const x1 = rows[placed.band.startIndex][xKey] as string | number;
    const x2 = rows[placed.band.endIndex][xKey] as string | number;
    const shared = { x1, x2, yAxisId, ifOverflow: "visible" as const };
    return [
      <ReferenceArea
        key={`data-note-${placed.note.id}`}
        {...shared}
        zIndex={BAND_Z_INDEX}
        shape={
          <BandShape
            x1={x1}
            stepValues={stepValues}
            color={color}
            band={placed.band}
          />
        }
      />,
      <ReferenceArea
        key={`data-note-label-${placed.note.id}`}
        {...shared}
        zIndex={LABEL_Z_INDEX}
        shape={
          <BandLabel
            x1={x1}
            stepValues={stepValues}
            color={color}
            placed={placed}
            onHoverChange={onHoverChange}
          />
        }
      />,
    ];
  });
}

const MAX_LINES = 2;

/** One line per note under a chart that can't place notes on a date axis. */
export function DataNoteLines({ notes }: { notes: readonly DataNote[] }) {
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
            <DataNoteHoverCard notes={[note]}>
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
          <DataNoteHoverCard notes={rest}>
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
export function DataNoteFlag({ notes }: { notes: readonly DataNote[] }) {
  const t = useT();
  if (notes.length === 0) return null;
  const tone = TONE_ORDER.find((candidate) =>
    notes.some((note) => dataNoteTone(note) === candidate),
  )!;
  return (
    <DataNoteHoverCard notes={notes}>
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
