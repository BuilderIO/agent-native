import { callAction } from "@agent-native/core/client/hooks";
import { toast } from "sonner";

import {
  MAX_FIG_UPLOAD_BYTES,
  uploadDesignFile,
} from "@/lib/design-file-upload";
import {
  importResultNotification,
  looksLikeStandaloneHtml,
  type ImportResult,
} from "@/lib/design-import";
import { preflightFigArchive } from "@/lib/fig-archive-preflight";
import type {
  FigClientImportOptions,
  FigClientImportProgress,
  PreparedFigImport,
} from "@/lib/fig-client-import";
import {
  claimFigImportToast,
  dismissFigImportToast,
  FIG_IMPORT_TOAST_ID,
  releaseFigImportToast,
  updateFigImportToast,
  type FigImportToastOwner,
} from "@/lib/pending-import";

import {
  BROWSER_FIG_LIMITS,
  type FigImportLimits,
} from "../../../../server/lib/fig-file-limits.js";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ImportDesignFileDeps {
  preflightFigArchive: typeof preflightFigArchive;
  prepareFigImport: (
    file: File,
    onProgress?: (progress: FigClientImportProgress) => void,
  ) => Promise<PreparedFigImport>;
  importFigInBrowser: (
    options: FigClientImportOptions,
  ) => Promise<ImportResult>;
  uploadDesignFile: typeof uploadDesignFile;
  importHtml: (input: {
    designId: string;
    content: string;
    originalName: string;
  }) => Promise<ImportResult>;
  isUploadStorageConfigured: () => Promise<boolean>;
}

export interface ImportDesignFileArgs {
  designId: string;
  file: File;
  t: Translate;
  formatNumber: (value: number) => string;
  formatList: (items: string[]) => string;
  /** Refreshes the editor onto the imported screens. */
  onImported: (result: ImportResult) => Promise<void>;
  /** Offered on the failure toast; not for files refused as too large. */
  onRetry?: () => void;
  deps: ImportDesignFileDepsOverrides;
}

interface ImportDesignFileDepsOverrides extends Partial<ImportDesignFileDeps> {
  isUploadStorageConfigured: ImportDesignFileDeps["isUploadStorageConfigured"];
}

export type ImportDesignFileOutcome =
  | { status: "imported"; result: ImportResult }
  | { status: "refused"; reason: "too-large" | "unsupported" | "not-html" }
  | { status: "failed"; error: unknown };

/** A .fig over the browser decoder's limits. The whole file is refused rather
 * than imported in part. */
export class FigFileTooLargeError extends Error {
  constructor(readonly limit: keyof FigImportLimits) {
    super(`.fig file exceeds the browser import limit (${limit}).`);
    this.name = "FigFileTooLargeError";
  }
}

const defaultDeps: Omit<ImportDesignFileDeps, "isUploadStorageConfigured"> = {
  preflightFigArchive,
  prepareFigImport: async (file, onProgress) =>
    (await import("@/lib/fig-client-import")).prepareFigImport(
      file,
      onProgress,
    ),
  importFigInBrowser: async (options) =>
    (await import("@/lib/fig-client-import")).importFigInBrowser(options),
  uploadDesignFile,
  importHtml: async ({ designId, content, originalName }) =>
    (await callAction("import-design-source", {
      designId,
      sourceType: "html-string",
      content,
      originalName,
    })) as ImportResult,
};

type FigProgress = {
  phase: FigClientImportProgress["phase"] | "uploading";
  progress: number | null;
  saved: number | null;
  total: number | null;
};

function describeProgress(
  { phase, progress, saved, total }: FigProgress,
  t: Translate,
  formatNumber: (value: number) => string,
): string {
  if (phase === "decoding") return t("designEditor.import.figImportAnalyzing");
  if (phase === "rendering" || progress === 100) {
    return t("designEditor.import.figUploadProcessing");
  }
  if (saved !== null && total !== null) {
    return t("designEditor.import.figImportSaving", {
      saved: formatNumber(saved),
      total: formatNumber(total),
    });
  }
  return t("designEditor.import.figUploadUploading", {
    progress: progress ?? 0,
  });
}

function fidelityWarnings(
  result: ImportResult,
  t: Translate,
  formatNumber: (value: number) => string,
  formatList: (items: string[]) => string,
): string[] {
  const warnings: string[] = [];
  const imageFallbacks = result.fidelityReport?.imageFallbacks.length;
  if (imageFallbacks) {
    warnings.push(
      t("designEditor.import.figmaImageFallbackWarning", {
        count: formatNumber(imageFallbacks),
      }),
    );
  }
  const approximated = result.fidelityReport?.approximated.length;
  if (approximated) {
    warnings.push(
      t("designEditor.import.figmaApproximationWarning", {
        count: formatNumber(approximated),
      }),
    );
  }
  const skippedFrames = result.skippedFrames ?? [];
  if (skippedFrames.length) {
    const names = formatList(skippedFrames.slice(0, 3));
    warnings.push(
      t("designEditor.import.figImportFramesSkippedWarning", {
        count: formatNumber(skippedFrames.length),
        names: skippedFrames.length > 3 ? `${names}, …` : names,
      }),
    );
  }
  if (result.skippedEmbeddedImageCount) {
    warnings.push(
      t("designEditor.import.figUploadImagesSkippedWarning", {
        count: formatNumber(result.skippedEmbeddedImageCount),
      }),
    );
  }
  return warnings;
}

function settledToastId(owner: FigImportToastOwner) {
  return releaseFigImportToast(owner) ? FIG_IMPORT_TOAST_ID : undefined;
}

async function importFigFile(
  args: ImportDesignFileArgs,
  deps: ImportDesignFileDeps,
  report: (update: Partial<FigProgress>) => void,
): Promise<ImportResult> {
  const { designId, file, t } = args;
  const preflight = await deps.preflightFigArchive(file, BROWSER_FIG_LIMITS);
  if (preflight.status === "too-large") {
    throw new FigFileTooLargeError(preflight.limit);
  }
  try {
    const prepared = await deps.prepareFigImport(file);
    if (prepared.summary.frameCount > BROWSER_FIG_LIMITS.frames) {
      prepared.dispose();
      throw new FigFileTooLargeError("frames");
    }
    return await deps.importFigInBrowser({
      designId,
      file,
      prepared,
      onProgress: ({ phase, ratio, saved, total }) =>
        report({
          phase,
          progress: Math.round((ratio ?? 0) * 90) + 5,
          saved: saved ?? null,
          total: total ?? null,
        }),
    });
  } catch (localError) {
    if (
      localError instanceof FigFileTooLargeError ||
      file.size > MAX_FIG_UPLOAD_BYTES ||
      (localError as { remoteMutationStarted?: unknown })
        .remoteMutationStarted === true ||
      !(await deps.isUploadStorageConfigured())
    ) {
      throw localError;
    }
    console.warn(
      "[fig-import] in-browser conversion failed; falling back to the upload route.",
      localError,
    );
    report({ phase: "uploading", progress: 0, saved: null, total: null });
    return deps.uploadDesignFile({
      designId,
      file,
      fallbackErrorMessage: t("designEditor.import.errors.uploadFailed"),
      onProgress: ({ percent }) => report({ progress: percent }),
    });
  }
}

/** File → Import and the home .fig handoff: imports a whole .fig or a
 * standalone HTML file onto the canvas, with progress in one toast. */
export async function runImportDesignFile(
  args: ImportDesignFileArgs,
): Promise<ImportDesignFileOutcome> {
  const { file, t, formatNumber, formatList } = args;
  const deps: ImportDesignFileDeps = { ...defaultDeps, ...args.deps };
  const isFig = /\.fig$/i.test(file.name);
  if (!isFig && !/\.html?$/i.test(file.name)) {
    toast.error(t("designEditor.import.errors.importFailed"), {
      description: t("designEditor.import.errors.unsupportedFileType"),
    });
    return { status: "refused", reason: "unsupported" };
  }

  const owner = claimFigImportToast();
  let progress: FigProgress = {
    phase: isFig ? "decoding" : "rendering",
    progress: null,
    saved: null,
    total: null,
  };
  const report = (update: Partial<FigProgress>) => {
    progress = { ...progress, ...update };
    updateFigImportToast(
      owner,
      describeProgress(progress, t, formatNumber),
      file.name,
    );
  };
  report({});

  try {
    let result: ImportResult;
    if (isFig) {
      result = await importFigFile(args, deps, report);
    } else {
      const content = await file.text();
      if (!looksLikeStandaloneHtml(content)) {
        toast.error(t("designEditor.import.errors.notHtml"), {
          id: settledToastId(owner),
          description: file.name,
        });
        return { status: "refused", reason: "not-html" };
      }
      result = await deps.importHtml({
        designId: args.designId,
        content,
        originalName: file.name,
      });
    }
    if (result.error) throw new Error(result.error);
    await args.onImported(result);
    const notification = importResultNotification(
      result,
      t(
        isFig
          ? "designEditor.import.uploadSuccess"
          : "designEditor.import.htmlSuccess",
      ),
      {
        fidelityWarnings: fidelityWarnings(result, t, formatNumber, formatList),
      },
    );
    const id = settledToastId(owner);
    if (notification.variant === "warning") {
      toast.warning(notification.title, {
        id,
        description: notification.description,
      });
    } else {
      toast.success(notification.title, { id, description: undefined });
    }
    return { status: "imported", result };
  } catch (error) {
    const tooLarge = error instanceof FigFileTooLargeError;
    toast.error(t("designEditor.import.errors.importFailed"), {
      id: settledToastId(owner),
      description: tooLarge
        ? t("designEditor.import.errors.figFileTooLarge")
        : error instanceof Error
          ? error.message
          : t("common.genericError"),
      action:
        !tooLarge && args.onRetry
          ? { label: t("homeContext.retry"), onClick: args.onRetry }
          : undefined,
    });
    return tooLarge
      ? { status: "refused", reason: "too-large" }
      : { status: "failed", error };
  } finally {
    dismissFigImportToast(owner);
  }
}
