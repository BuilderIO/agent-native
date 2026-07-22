export interface PromptOptimizationMetrics {
  shouldOptimize: boolean;
  estimatedTextTokens: number;
  estimatedVisionTokens: number;
  expectedTokenSavings: number;
  savingsPercentage: number;
  pageCount: number;
}

export interface PromptRenderOptions {
  width?: number;
  fontSize?: number;
  lineHeight?: number;
  padding?: number;
  maxLinesPerPage?: number;
}

export interface OptimizedPromptResult {
  promptText: string;
  attachments?: AttachmentItem[];
  isOptimized: boolean;
  savedTokens: number;
}

/**
 * Evaluates whether a prompt text is large enough to warrant conversion
 * to vision image frames to save input context tokens.
 */
export function evaluatePromptOptimization(
  text: string,
  isCode = false,
): PromptOptimizationMetrics {
  const trimmed = text ? text.trim() : "";
  if (!trimmed) {
    return {
      shouldOptimize: false,
      estimatedTextTokens: 0,
      estimatedVisionTokens: 0,
      expectedTokenSavings: 0,
      savingsPercentage: 0,
      pageCount: 0,
    };
  }

  // Heuristic token estimation (Code: ~2.8, CJK/Unicode: ~2.0, English Prose: ~3.8 chars/token)
  const isNonLatin =
    /[\u3000-\u9fff\u0600-\u06ff\u0900-\u097f\u0400-\u04ff]/.test(trimmed);
  const charRatio = isCode ? 2.8 : isNonLatin ? 2.0 : 3.8;
  const estimatedTextTokens = Math.ceil(trimmed.length / charRatio);

  // High-res canvas page (1200x1600) holds ~4,500 characters cleanly for OCR
  const CHARS_PER_PAGE = 4500;
  const pageCount = Math.max(1, Math.ceil(trimmed.length / CHARS_PER_PAGE));

  // Vision tile cost per frame (approx. 650 tokens for high-res tile)
  const VISION_TOKENS_PER_PAGE = 650;
  const estimatedVisionTokens = pageCount * VISION_TOKENS_PER_PAGE;

  const expectedTokenSavings = estimatedTextTokens - estimatedVisionTokens;
  const savingsPercentage = Math.round(
    (expectedTokenSavings / estimatedTextTokens) * 100,
  );

  // Conversion rule: > 3,500 text tokens AND >= 40% token savings
  const shouldOptimize = estimatedTextTokens > 3500 && savingsPercentage >= 40;

  return {
    shouldOptimize,
    estimatedTextTokens,
    estimatedVisionTokens,
    expectedTokenSavings,
    savingsPercentage: Math.max(0, savingsPercentage),
    pageCount,
  };
}

const FONT_STACK =
  '"Courier New", monospace, "Noto Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Arial", sans-serif';
const GUTTER_WIDTH = 60;

function createCanvasAndCtx(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context.");
    return { canvas, ctx };
  }
  if (typeof globalThis.OffscreenCanvas !== "undefined") {
    const canvas = new globalThis.OffscreenCanvas(width, height);
    const ctx = canvas.getContext(
      "2d",
    ) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Could not acquire 2D canvas context.");
    return { canvas, ctx };
  }
  throw new Error(
    "Canvas rendering is only available in browser or DOM/OffscreenCanvas environments.",
  );
}

interface RenderRow {
  text: string;
  lineNumber: number;
  showLineNumber: boolean;
}

function wrapLine(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  line: string,
  maxWidthPx: number,
): string[] {
  if (line.length === 0) return [""];
  if (ctx.measureText(line).width <= maxWidthPx) return [line];

  const rows: string[] = [];
  let current = "";
  for (const char of line) {
    const candidate = current + char;
    if (current.length > 0 && ctx.measureText(candidate).width > maxWidthPx) {
      rows.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * Renders text into paginated PNG Data-URLs using Web HTML5 Canvas.
 */
export async function renderTextToImagePagesWeb(
  text: string,
  options: PromptRenderOptions = {},
): Promise<string[]> {
  const width = options.width ?? 1200;
  const fontSize = options.fontSize ?? 16;
  const lineHeight = Math.round(fontSize * (options.lineHeight ?? 1.5));
  const padding = options.padding ?? 32;
  const maxLinesPerPage = options.maxLinesPerPage ?? 60;
  const maxTextWidthPx = Math.max(
    fontSize * 4,
    width - padding * 2 - GUTTER_WIDTH,
  );

  // Text is wrapped, never truncated — a dropped character here would silently
  // corrupt the very content this optimizer exists to preserve.
  const { ctx: measureCtx } = createCanvasAndCtx(1, 1);
  measureCtx.font = `${fontSize}px ${FONT_STACK}`;

  const rows: RenderRow[] = [];
  text.split("\n").forEach((line, sourceIndex) => {
    const wrapped = wrapLine(measureCtx, line, maxTextWidthPx);
    wrapped.forEach((rowText, wrapIndex) => {
      rows.push({
        text: rowText,
        lineNumber: sourceIndex + 1,
        showLineNumber: wrapIndex === 0,
      });
    });
  });

  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;
  const pages: string[] = [];

  for (let i = 0; i < rows.length; i += maxLinesPerPage) {
    const pageRows = rows.slice(i, i + maxLinesPerPage);
    const canvasHeight = pageRows.length * lineHeight + padding * 2;

    const { canvas, ctx } = createCanvasAndCtx(
      Math.round(width * dpr),
      Math.round(canvasHeight * dpr),
    );
    ctx.scale(dpr, dpr);

    // High contrast slate dark mode background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, canvasHeight);

    // Universal multi-language font stack for OCR across all Unicode scripts
    ctx.font = `${fontSize}px ${FONT_STACK}`;
    ctx.textBaseline = "top";

    pageRows.forEach((row, index) => {
      const y = padding + index * lineHeight;

      if (row.showLineNumber) {
        // Line number (grey)
        ctx.fillStyle = "#64748b";
        ctx.fillText(String(row.lineNumber).padStart(4, " "), padding, y);
      }

      // Line text (white)
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(row.text, padding + GUTTER_WIDTH, y);
    });

    if ("toDataURL" in canvas && typeof canvas.toDataURL === "function") {
      pages.push(canvas.toDataURL("image/png"));
    } else if (
      "convertToBlob" in canvas &&
      typeof canvas.convertToBlob === "function"
    ) {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const dataUrl = await blobToDataURL(blob);
      pages.push(dataUrl);
    }
  }

  return pages;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface AttachmentItem {
  type?: string;
  name?: string;
  contentType?: string;
  data?: string;
  text?: string;
  url?: string;
  [key: string]: unknown;
}

export interface OptimizePromptOptions {
  isCode?: boolean;
  renderOptions?: PromptRenderOptions;
  attachments?: AttachmentItem[];
}

/**
 * Main Web Prompt Optimizer function. Converts oversized prompts and pasted-text
 * attachments into vision image frames. Includes fail-safe fallbacks.
 */
export async function optimizePromptSubmission(
  promptText: string,
  options: OptimizePromptOptions = {},
): Promise<OptimizedPromptResult> {
  let isOptimized = false;
  let savedTokens = 0;
  let finalPromptText = promptText;
  const processedAttachments: AttachmentItem[] = [];

  // 1. Evaluate and optimize main promptText if oversized
  const textMetrics = evaluatePromptOptimization(promptText, options.isCode);
  if (textMetrics.shouldOptimize) {
    try {
      const pageDataUrls = await renderTextToImagePagesWeb(
        promptText,
        options.renderOptions,
      );

      const visionAttachments = pageDataUrls.map((url, idx) => ({
        name: `prompt-vision-frame-${idx + 1}.png`,
        type: "image",
        contentType: "image/png",
        data: url,
        url,
      }));

      processedAttachments.push(...visionAttachments);
      savedTokens += textMetrics.expectedTokenSavings;
      isOptimized = true;

      finalPromptText =
        `[PROMPT OPTIMIZER ACTIVE: Oversized prompt (${textMetrics.estimatedTextTokens} tokens) ` +
        `condensed to ${pageDataUrls.length} vision frame(s) saving ~${textMetrics.expectedTokenSavings} input tokens]`;
    } catch {
      // Fail-safe fallback
    }
  }

  // 2. Evaluate and optimize text attachments (including pasted-text-*.txt)
  if (options.attachments && options.attachments.length > 0) {
    for (const attachment of options.attachments) {
      const rawText =
        typeof attachment.text === "string" ? attachment.text : "";
      const isTextFile =
        rawText.length > 0 ||
        attachment.contentType === "text/plain" ||
        (attachment.name && attachment.name.startsWith("pasted-text-"));

      if (isTextFile && rawText) {
        const attMetrics = evaluatePromptOptimization(rawText, options.isCode);
        if (attMetrics.shouldOptimize) {
          try {
            const pageDataUrls = await renderTextToImagePagesWeb(
              rawText,
              options.renderOptions,
            );

            const baseName = attachment.name
              ? attachment.name.replace(/\.[^.]+$/, "")
              : "pasted-text";
            const visionAttachments = pageDataUrls.map((url, idx) => ({
              name: `${baseName}-vision-frame-${idx + 1}.png`,
              type: "image",
              contentType: "image/png",
              data: url,
              url,
            }));

            processedAttachments.push(...visionAttachments);
            savedTokens += attMetrics.expectedTokenSavings;
            isOptimized = true;

            if (!textMetrics.shouldOptimize && finalPromptText === promptText) {
              finalPromptText =
                `[PROMPT OPTIMIZER ACTIVE: Attached text (${attMetrics.estimatedTextTokens} tokens) ` +
                `condensed to ${pageDataUrls.length} vision frame(s) saving ~${attMetrics.expectedTokenSavings} input tokens]`;
            }
            continue; // Replaced text file attachment with vision frames
          } catch {
            // Fail-safe: keep original text attachment
          }
        }
      }

      processedAttachments.push(attachment);
    }
  }

  if (!isOptimized) {
    return {
      promptText,
      attachments: options.attachments,
      isOptimized: false,
      savedTokens: 0,
    };
  }

  return {
    promptText: finalPromptText,
    attachments:
      processedAttachments.length > 0 ? processedAttachments : undefined,
    isOptimized,
    savedTokens,
  };
}
