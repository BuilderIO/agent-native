import { shouldUseLiveFileContent } from "../../shared/html-content.js";
import {
  readLiveSourceFile,
  SourceWorkspaceEditConflictError,
  type SourceWorkspaceFile,
} from "../source-workspace.js";

export class ExportLiveSourceError extends Error {
  readonly statusCode: number;
  readonly actionErrorCode:
    | "design_export_source_conflict"
    | "design_export_live_source_unreadable";

  constructor(
    readonly code: "source-conflict" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "ExportLiveSourceError";
    this.statusCode = code === "source-conflict" ? 409 : 422;
    this.actionErrorCode =
      code === "source-conflict"
        ? "design_export_source_conflict"
        : "design_export_live_source_unreadable";
  }
}

export async function loadLiveExportFiles<File extends SourceWorkspaceFile>(
  files: readonly File[],
): Promise<Array<File & { content: string; versionHash: string }>> {
  const liveFiles: Array<File & { content: string; versionHash: string }> = [];
  for (const file of files) {
    let live: Awaited<ReturnType<typeof readLiveSourceFile>>;
    try {
      live = await readLiveSourceFile(file);
    } catch (error) {
      if (error instanceof SourceWorkspaceEditConflictError)
        throw new ExportLiveSourceError("source-conflict", error.message);
      throw error;
    }
    if (
      !shouldUseLiveFileContent({
        liveContent: live.content,
        storedContent: file.content ?? "",
        fileType: file.fileType,
      })
    )
      throw new ExportLiveSourceError(
        "unreadable",
        `Live source ${file.filename} is not renderable HTML.`,
      );
    liveFiles.push({
      ...file,
      content: live.content,
      versionHash: live.versionHash,
    });
  }
  return liveFiles;
}
