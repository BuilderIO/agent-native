import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { fail } from "@agent-native/core/action";
import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";
import { z } from "zod";

export const CONTENT_FILE_FORMATS = ["markdown", "csv", "pdf"] as const;
export type ContentFileFormat = (typeof CONTENT_FILE_FORMATS)[number];
const CONTENT_FILE_MAX_BYTES = 2 * 1024 * 1024;
const TOO_LARGE_MESSAGE =
  "This Content page is too large to attach (over 2 MB). Export it from Content and attach the file instead.";

export const contentPageKindSchema = z.enum(["page", "collection"]);
export const contentFileFormatSchema = z.enum(CONTENT_FILE_FORMATS);

const FORMATS_BY_KIND: Record<
  z.infer<typeof contentPageKindSchema>,
  readonly ContentFileFormat[]
> = {
  page: ["markdown", "pdf"],
  collection: ["csv"],
};

const contentPageSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(2000),
  kind: contentPageKindSchema,
  format: contentFileFormatSchema,
  updatedAt: z.string().max(100).optional(),
});

export const contentPageListSchema = z.object({
  items: z.array(contentPageSchema).max(100),
  hasMore: z.boolean(),
});

const contentPageFileSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(2000),
  kind: contentPageKindSchema,
  format: contentFileFormatSchema,
  filename: z.string().min(1).max(255),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  size: z.number().int().nonnegative(),
});

export type ContentPage = z.infer<typeof contentPageSchema>;
export type ContentPageList = z.infer<typeof contentPageListSchema>;
export type ContentPageFile = z.infer<typeof contentPageFileSchema> & {
  data: Buffer;
};

const CONTENT_ERRORS: Record<string, { message: string; statusCode: number }> =
  {
    document_file_unavailable: {
      message:
        "This Content page is unavailable or you no longer have access to it.",
      statusCode: 404,
    },
    document_file_too_large: {
      message: TOO_LARGE_MESSAGE,
      statusCode: 413,
    },
    document_file_format_unsupported: {
      message:
        "That format doesn't fit this page: a page attaches as Markdown or PDF, a collection as CSV.",
      statusCode: 400,
    },
    document_file_pdf_text_unsupported: {
      message:
        "This page has text a PDF can't show yet, such as Chinese, Japanese, Korean, Arabic, Hebrew or Hindi. Attach it as Markdown instead.",
      statusCode: 422,
    },
    document_file_pdf_too_long: {
      message:
        "This page is too long or too wide to attach as a PDF. Attach it as Markdown instead.",
      statusCode: 413,
    },
    collection_export_limit_exceeded: {
      message:
        "This collection has too many rows to attach. Export a narrower view from Content and attach the file instead.",
      statusCode: 413,
    },
    collection_export_rollup_target_unsupported: {
      message:
        "Content can't export one of this collection's rollup columns, so it can't be attached.",
      statusCode: 422,
    },
  };

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

function contentTarget(): string {
  const content = getBuiltinAgents("mail").find((app) => app.id === "content");
  if (!content?.url || !URL.canParse(content.url)) return "content";
  const builtinUrl = content.url.replace(/\/+$/, "");
  const laneUrl = resolveLaneEndpoint(
    builtinUrl,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
  return laneUrl === builtinUrl ? "content" : laneUrl;
}

export function contentErrorCode(output: string) {
  return /\(errorCode: ([A-Za-z0-9_]+)\)/.exec(output)?.[1];
}

export async function invokeContentAction(
  action: string,
  input: Record<string, unknown>,
  signInMessage: string,
) {
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail) {
    fail(signInMessage, { statusCode: 401, errorCode: "unauthorized" });
  }
  try {
    const response = await invokeAgentAction({
      target: contentTarget(),
      selfAppId: "mail",
      action,
      input,
      userEmail: auth.userEmail,
      ...(auth.orgDomain ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs: 30_000,
    });
    return response.result;
  } catch {
    fail("Could not reach Content. Check its connection and try again.", {
      statusCode: 502,
      errorCode: "content_unavailable",
    });
  }
}

export function parseContentOutput(output: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    fail("Content returned an incomplete response. Try again.", {
      statusCode: 502,
      errorCode: "content_invalid_response",
    });
  }
}

async function readDocumentFile(input: Record<string, unknown>) {
  const result = await invokeContentAction(
    "read-document-file",
    input,
    "Sign in to attach a Content page.",
  );
  if (result.status !== "completed") {
    const code = contentErrorCode(result.output);
    const known = code ? CONTENT_ERRORS[code] : undefined;
    if (
      input.format === "pdf" &&
      (code === "document_file_pdf_failed" ||
        (!known && result.output.includes("Invalid action parameters")))
    ) {
      fail(
        "Content couldn't make a PDF of this page. Attach it as Markdown instead.",
        { statusCode: 409, errorCode: "content_page_pdf_unavailable" },
      );
    }
    fail(
      known?.message ??
        "Content could not read this page. Check your access and its connection.",
      {
        statusCode: known?.statusCode ?? 409,
        errorCode: known && code ? code : "content_page_unavailable",
      },
    );
  }
  return parseContentOutput(result.output);
}

export async function listContentPages(args: {
  search?: string | undefined;
  page: number;
}): Promise<ContentPageList> {
  const output = await readDocumentFile({
    operation: "list",
    page: args.page,
    ...(args.search ? { search: args.search } : {}),
  });
  const parsed = contentPageListSchema.safeParse(output);
  if (!parsed.success) {
    fail("Content returned an invalid page list. Try again.", {
      statusCode: 502,
      errorCode: "content_invalid_response",
    });
  }
  return parsed.data;
}

export async function readContentPageFile(args: {
  id: string;
  format?: ContentFileFormat | undefined;
}): Promise<ContentPageFile> {
  const output = await readDocumentFile({
    operation: "read",
    page: 1,
    id: args.id,
    ...(args.format ? { format: args.format } : {}),
  });
  const parsed = contentPageFileSchema.safeParse(output);
  if (
    !parsed.success ||
    parsed.data.id !== args.id ||
    !FORMATS_BY_KIND[parsed.data.kind].includes(parsed.data.format) ||
    (parsed.data.format === "pdf") !== (parsed.data.encoding === "base64") ||
    (args.format && parsed.data.format !== args.format)
  ) {
    fail("Content returned an invalid file. Try again.", {
      statusCode: 502,
      errorCode: "content_invalid_response",
    });
  }
  const data = decodeFile(parsed.data.content, parsed.data.encoding);
  if (
    !data ||
    data.byteLength !== parsed.data.size ||
    (parsed.data.format === "pdf" &&
      data.subarray(0, 5).toString("latin1") !== "%PDF-")
  ) {
    fail(
      "This page's file didn't reach Mail intact, so it wasn't attached. Export it from Content and attach the file instead.",
      { statusCode: 502, errorCode: "content_file_incomplete" },
    );
  }
  if (data.byteLength > CONTENT_FILE_MAX_BYTES) {
    fail(TOO_LARGE_MESSAGE, {
      statusCode: 413,
      errorCode: "document_file_too_large",
    });
  }
  return { ...parsed.data, data };
}

function decodeFile(content: string, encoding: "utf8" | "base64") {
  if (encoding === "utf8") return Buffer.from(content, "utf8");
  const data = Buffer.from(content, "base64");
  return data.toString("base64") === content ? data : null;
}

const EXTENSION_BY_FORMAT: Record<ContentFileFormat, string> = {
  markdown: ".md",
  csv: ".csv",
  pdf: ".pdf",
};

export function attachmentNameForFile(
  file: Pick<ContentPageFile, "filename" | "format">,
) {
  const extension = EXTENSION_BY_FORMAT[file.format];
  const base =
    file.filename
      .replace(/[\\/\0\r\n]+/g, " ")
      .replace(/\.(?:md|markdown|csv|pdf)$/i, "")
      .trim()
      .slice(0, 255 - extension.length) || "Untitled";
  return `${base}${extension}`;
}
