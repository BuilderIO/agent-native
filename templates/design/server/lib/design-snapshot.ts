/**
 * Shared snapshot logic for the design round-trip.
 *
 * "Snapshot" = the design's *current* state an external agent should continue
 * from: the live file contents (Yjs collab text when a live editing session
 * exists for a file, otherwise the stored `design_files.content`) plus the
 * user's tuned tweak values resolved to CSS custom properties.
 *
 * Both `get-design-snapshot` (read-only ingest) and `export-coding-handoff`
 * (design -> code) build from this so they never diverge. Access control is
 * the caller's responsibility — call assertAccess/resolveAccess first.
 */

import { hasCollabState, getText } from "@agent-native/core/collab";
import { eq } from "drizzle-orm";

import type { TweakDefinition } from "../../shared/api.js";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "../../shared/resolve-tweaks.js";
import { getDb, schema } from "../db/index.js";

export interface SnapshotFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  /** "collab" when the live Yjs session text was used, "stored" otherwise. */
  source: "collab" | "stored";
}

export interface DesignSnapshot {
  designId: string;
  /** Files with live (collab) content preferred over stored content. */
  files: SnapshotFile[];
  /** Tweak definitions the design declares (from designs.data.tweaks). */
  tweaks: TweakDefinition[];
  /** The user's persisted knob selections (designs.data.tweakSelections). */
  appliedTweaks: TweakSelections;
  /** Resolved `--css-var` -> value map produced by the shared resolver. */
  resolvedCssVars: Record<string, string>;
}

function parseDesignData(data?: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * Build the current snapshot for a design. Caller must have already verified
 * access (assertAccess/resolveAccess) — this function does no auth.
 */
export async function buildDesignSnapshot(
  designId: string,
  designData?: string | null,
): Promise<DesignSnapshot> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));

  const files: SnapshotFile[] = [];
  for (const f of rows) {
    let content = f.content;
    let source: "collab" | "stored" = "stored";
    // Prefer live collab text when an editing session exists for this file so
    // an external agent sees in-flight edits, not the last persisted snapshot.
    try {
      if (await hasCollabState(f.id)) {
        const live = await getText(f.id, "content");
        if (typeof live === "string" && live.length > 0) {
          content = live;
          source = "collab";
        }
      }
    } catch {
      // Collab read is best-effort; fall back to stored content.
    }
    files.push({
      id: f.id,
      filename: f.filename,
      fileType: f.fileType,
      content,
      source,
    });
  }

  // index.html first, then alphabetical — stable, predictable handoff order.
  files.sort((a, b) => {
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.filename.localeCompare(b.filename);
  });

  const data = parseDesignData(designData);
  const tweaks: TweakDefinition[] = Array.isArray(
    (data as { tweaks?: unknown }).tweaks,
  )
    ? ((data as { tweaks: TweakDefinition[] }).tweaks ?? [])
    : [];
  const rawSelections = (data as { tweakSelections?: unknown }).tweakSelections;
  const appliedTweaks: TweakSelections =
    rawSelections &&
    typeof rawSelections === "object" &&
    !Array.isArray(rawSelections)
      ? (rawSelections as TweakSelections)
      : {};
  const resolvedCssVars = resolveTweaksToCssVars(tweaks, appliedTweaks);

  return {
    designId,
    files,
    tweaks,
    appliedTweaks,
    resolvedCssVars,
  };
}
