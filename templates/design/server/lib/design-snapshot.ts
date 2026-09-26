import { eq } from "drizzle-orm";

import type { TweakDefinition } from "../../shared/api.js";
import { shouldUseLiveFileContent } from "../../shared/html-content.js";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "../../shared/resolve-tweaks.js";
import { getDb, schema } from "../db/index.js";
import { readLiveSourceFile } from "../source-workspace.js";

export interface SnapshotFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  source: "collab" | "stored";
}

export interface DesignSnapshot {
  designId: string;
  files: SnapshotFile[];
  tweaks: TweakDefinition[];
  appliedTweaks: TweakSelections;
  resolvedCssVars: Record<string, string>;
}

export interface BuildDesignSnapshotOptions {
  preferStoredFileContent?: boolean;
}

type SnapshotDatabase = Pick<ReturnType<typeof getDb>, "select">;

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

export async function buildDesignSnapshot(
  designId: string,
  designData?: string | null,
  options: BuildDesignSnapshotOptions = {},
  database?: SnapshotDatabase,
): Promise<DesignSnapshot> {
  const db = database ?? getDb();

  const rows = await db
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));

  const files: SnapshotFile[] = [];
  for (const f of rows) {
    let content = f.content;
    let source: "collab" | "stored" = "stored";
    if (!options.preferStoredFileContent) {
      const live = await readLiveSourceFile(f);
      if (
        live.source === "collab" &&
        shouldUseLiveFileContent({
          liveContent: live.content,
          storedContent: f.content,
          fileType: f.fileType,
        })
      ) {
        content = live.content;
        source = "collab";
      }
    }
    files.push({
      id: f.id,
      filename: f.filename,
      fileType: f.fileType,
      content,
      source,
    });
  }

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
