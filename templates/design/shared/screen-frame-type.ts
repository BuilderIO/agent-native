import {
  HUBSPOT_EMAIL_FRAME_TYPE,
  isHubSpotEmailHtml,
} from "./hubspot-email.js";

export type ScreenFrameType = typeof HUBSPOT_EMAIL_FRAME_TYPE;

// "web" records that a screen was switched back from an email. Without it, a
// legacy screen whose HTML still carries the email meta marker would read as
// an email again.
export type StoredScreenFrameType = ScreenFrameType | "web";

export const STORED_SCREEN_FRAME_TYPES = [
  HUBSPOT_EMAIL_FRAME_TYPE,
  "web",
] as const satisfies readonly StoredScreenFrameType[];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The frame type stored in design data, or undefined when none is stored. */
export function storedScreenFrameType(
  designData: unknown,
  fileId: string,
): StoredScreenFrameType | undefined {
  const value = record(
    record(record(designData)?.screenMetadata)?.[fileId],
  )?.frameType;
  return value === HUBSPOT_EMAIL_FRAME_TYPE || value === "web"
    ? value
    : undefined;
}

export function frameTypeFromStored(
  stored: StoredScreenFrameType,
): ScreenFrameType | null {
  return stored === HUBSPOT_EMAIL_FRAME_TYPE ? stored : null;
}

/**
 * A screen's frame type. Stored metadata wins; a screen with none falls back
 * to the legacy HTML meta marker when its content is at hand.
 */
export function resolveScreenFrameType({
  designData,
  fileId,
  content,
}: {
  designData: unknown;
  fileId: string;
  content?: string | null | undefined;
}): ScreenFrameType | null {
  const stored = storedScreenFrameType(designData, fileId);
  if (stored !== undefined) return frameTypeFromStored(stored);
  return typeof content === "string" && isHubSpotEmailHtml(content)
    ? HUBSPOT_EMAIL_FRAME_TYPE
    : null;
}

/**
 * The frame type a copy of a screen must be created with. A stored "web" is
 * kept: the copied HTML may still carry the legacy email marker, and the copy
 * would read as an email without it.
 */
export function screenFrameTypeForCopy(args: {
  designData: unknown;
  fileId: string;
  content?: string | null | undefined;
}): StoredScreenFrameType | undefined {
  return (
    storedScreenFrameType(args.designData, args.fileId) ??
    resolveScreenFrameType(args) ??
    undefined
  );
}

export function withStoredScreenFrameType<T extends Record<string, unknown>>(
  designData: T,
  fileId: string,
  frameType: StoredScreenFrameType,
): T {
  const screenMetadata = record(designData.screenMetadata) ?? {};
  return {
    ...designData,
    screenMetadata: {
      ...screenMetadata,
      [fileId]: { ...record(screenMetadata[fileId]), frameType },
    },
  };
}

/**
 * Stores an explicit frame type change with the layout that type implies. A
 * screen becoming an email is 600px wide, sized to its content and has no
 * device variants. An email switched back to web drops that empty variant list
 * so the design's breakpoints apply again, and keeps its size. `previous` is
 * the type before the change; a screen that keeps its type keeps its layout.
 */
export function withScreenFrameTypeLayout<T extends Record<string, unknown>>(
  designData: T,
  fileId: string,
  frameType: StoredScreenFrameType,
  previous: ScreenFrameType | null,
): T {
  const typed = withStoredScreenFrameType(designData, fileId, frameType);
  if (frameTypeFromStored(frameType) === previous) return typed;
  const screenMetadata = record(typed.screenMetadata) ?? {};
  const metadata = { ...record(screenMetadata[fileId]) };
  const canvasFrames = record(typed.canvasFrames);
  const frame = record(canvasFrames?.[fileId]);
  if (frameType === HUBSPOT_EMAIL_FRAME_TYPE) {
    Object.assign(metadata, {
      width: 600,
      breakpointWidths: [],
      heightMode: "hug",
      heightPinned: false,
    });
  } else if (
    Array.isArray(metadata.breakpointWidths) &&
    metadata.breakpointWidths.length === 0
  ) {
    delete metadata.breakpointWidths;
  }
  return {
    ...typed,
    screenMetadata: { ...screenMetadata, [fileId]: metadata },
    ...(frameType === HUBSPOT_EMAIL_FRAME_TYPE && canvasFrames && frame
      ? {
          canvasFrames: { ...canvasFrames, [fileId]: { ...frame, width: 600 } },
        }
      : {}),
  };
}
