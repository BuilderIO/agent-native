export type HandoffFormat = "markdown" | "json";

export interface HandoffDesign {
  id: string;
  title: string;
  description?: string | null;
  data?: string | null;
  projectType?: string | null;
  updatedAt?: string | null;
}

export interface HandoffFile {
  filename: string;
  fileType?: string | null;
  content: string;
}

export interface DesignHandoffPayload {
  exportedAt: string;
  design: {
    id: string;
    title: string;
    description?: string | null;
    projectType?: string | null;
    updatedAt?: string | null;
    lastPrompt?: string;
    data?: Record<string, unknown>;
  };
  files: Array<{
    filename: string;
    fileType: string;
    content: string;
  }>;
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

export function normalizeHandoffOrigin(origin?: string | null): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function normalizeHandoffFormat(format?: string | null): HandoffFormat {
  return format === "json" ? "json" : "markdown";
}

export function buildRawHandoffUrl({
  id,
  token,
  origin,
  format = "markdown",
}: {
  id: string;
  token: string;
  origin?: string | null;
  format?: HandoffFormat;
}): string {
  const params = new URLSearchParams({
    token,
    format,
  });
  const path = appPath(
    `/api/design-handoff/${encodeURIComponent(id)}?${params.toString()}`,
  );
  const normalizedOrigin = normalizeHandoffOrigin(origin);
  return normalizedOrigin ? `${normalizedOrigin}${path}` : path;
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

function sortHandoffFiles(files: HandoffFile[]) {
  return [...files].sort((a, b) => {
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.filename.localeCompare(b.filename);
  });
}

export function buildDesignHandoffPayload({
  design,
  files,
  exportedAt = new Date().toISOString(),
}: {
  design: HandoffDesign;
  files: HandoffFile[];
  exportedAt?: string;
}): DesignHandoffPayload {
  const data = parseDesignData(design.data);
  const lastPrompt =
    typeof data.lastPrompt === "string" ? data.lastPrompt : undefined;

  return {
    exportedAt,
    design: {
      id: design.id,
      title: design.title,
      description: design.description,
      projectType: design.projectType,
      updatedAt: design.updatedAt,
      lastPrompt,
      data,
    },
    files: sortHandoffFiles(files).map((file) => ({
      filename: file.filename,
      fileType: file.fileType || "html",
      content: file.content,
    })),
  };
}

function languageForFile(filename: string, fileType: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".css") || fileType === "css") return "css";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx") || fileType === "jsx") {
    return "jsx";
  }
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".md")) return "md";
  return "html";
}

function fenceFor(content: string): string {
  let longest = 2;
  for (const match of content.matchAll(/`{3,}/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return "`".repeat(longest + 1);
}

export function buildDesignHandoffMarkdown(
  payload: DesignHandoffPayload,
): string {
  const lines = [
    `# Design Handoff: ${payload.design.title}`,
    "",
    `Design ID: ${payload.design.id}`,
    `Exported: ${payload.exportedAt}`,
  ];

  if (payload.design.description) {
    lines.push(`Description: ${payload.design.description}`);
  }
  if (payload.design.projectType) {
    lines.push(`Project type: ${payload.design.projectType}`);
  }
  if (payload.design.updatedAt) {
    lines.push(`Last updated: ${payload.design.updatedAt}`);
  }
  if (payload.design.lastPrompt) {
    lines.push("", "## Last Prompt", "", payload.design.lastPrompt);
  }

  lines.push(
    "",
    "## Files",
    "",
    "Use these source files as the visual and interaction reference for the implementation.",
  );

  for (const file of payload.files) {
    const fence = fenceFor(file.content);
    lines.push(
      "",
      `### ${file.filename}`,
      "",
      `${fence}${languageForFile(file.filename, file.fileType)}`,
      file.content,
      fence,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function buildCodingHandoffPrompt({
  rawUrl,
  title,
  fileCount,
}: {
  rawUrl: string;
  title: string;
  fileCount: number;
}): string {
  return [
    `Build this design as production code: ${title}`,
    "",
    `Fetch the raw design bundle here: ${rawUrl}`,
    "",
    `The bundle contains ${fileCount} file${fileCount === 1 ? "" : "s"} with the exact HTML/CSS/JSX source from the Design app. Use it as the source of truth for layout, typography, colors, spacing, responsive behavior, copy, and interactions. Convert it into the target project stack or Builder.io page/component while preserving the visual intent. If multiple screens are included, implement the primary page first and map the rest to routes, sections, or components as appropriate.`,
  ].join("\n");
}
