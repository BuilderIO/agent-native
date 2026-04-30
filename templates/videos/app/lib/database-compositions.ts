import { BlankComposition } from "@/remotion/compositions/BlankComposition";
import { createStandardTracks, type CompositionEntry } from "@/remotion/registry";
import type { AnimationTrack } from "@/types";

export type DatabaseCompositionRow = {
  id: string;
  title: string;
  type: string;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromData(
  data: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function propsFromData(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data.defaultProps) ? data.defaultProps : {};
}

function tracksFromData(
  data: Record<string, unknown>,
  durationInFrames: number,
): AnimationTrack[] {
  return Array.isArray(data.tracks)
    ? (data.tracks as AnimationTrack[])
    : createStandardTracks(durationInFrames);
}

export function databaseRowToComposition(
  row: DatabaseCompositionRow,
): CompositionEntry {
  const data = isRecord(row.data) ? row.data : {};
  const durationInFrames = numberFromData(data, "durationInFrames", 240);
  const fps = numberFromData(data, "fps", 30);
  const width = numberFromData(data, "width", 1920);
  const height = numberFromData(data, "height", 1080);

  return {
    id: row.id,
    title: row.title,
    description:
      typeof data.description === "string"
        ? data.description
        : "Blank composition",
    component: BlankComposition,
    durationInFrames,
    fps,
    width,
    height,
    defaultProps: propsFromData(data),
    tracks: tracksFromData(data, durationInFrames),
    version: numberFromData(data, "version", 1),
  };
}
