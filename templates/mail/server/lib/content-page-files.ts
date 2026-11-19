import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { fail } from "@agent-native/core/action";
import { z } from "zod";

/**
 * Content pages as Mail attachments. Content reads the page as a file under
 * the signed-in person's own access (read-document-file over A2A), and Mail
 * stores it like any other upload.
 */

export const CONTENT_FILE_FORMATS = ["markdown", "csv"] as const;
export type ContentFileFormat = (typeof CONTENT_FILE_FORMATS)[number];

const kindSchema = z.enum(["page", "collection"]);
const formatSchema = z.enum(CONTENT_FILE_FORMATS);

const contentPageSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(2000),
  kind: kindSchema,
  format: formatSchema,
  updatedAt: z.string().max(100).optional(),
});

const contentPageListSchema = z.object({
  items: z.array(contentPageSchema).max(100),
  hasMore: z.boolean(),
});

const contentPageFileSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(2000),
  kind: kindSchema,
  format: formatSchema,
  filename: z.string().min(1).max(255),
  encoding: z.literal("utf8"),
  content: z.string(),
  size: z.number().int().nonnegative(),
});

export type ContentPage = z.infer<typeof contentPageSchema>;
export type ContentPageList = z.infer<typeof contentPageListSchema>;
export type ContentPageFile = z.infer<typeof contentPageFileSchema>;

// What Content's refusals mean for someone attaching in Mail.
const CONTENT_ERRORS: Record<string, { message: string; statusCode: number }> =
  {
    document_file_unavailable: {
      message:
        "This Content page is unavailable or you no longer have access to it.",
      statusCode: 404,
    },
    document_file_too_large: {
      message:
        "This Content page is too large to attach (over 2 MB). Export it from Content and attach the file instead.",
      statusCode: 413,
    },
    document_file_format_unsupported: {
      message:
        "That format doesn't fit this page: a page attaches as Markdown, a collection as CSV.",
      statusCode: 400,
    },
  };

function contentErrorCode(output: string) {
  return /\(errorCode: ([a-z0-9_]+)\)/.exec(output)?.[1];
}

async function readDocumentFile(input: Record<string, unknown>) {
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail) {
    fail("Sign in to attach a Content page.", {
      statusCode: 401,
      errorCode: "unauthorized",
    });
  }
  let response;
  try {
    response = await invokeAgentAction({
      target: "content",
      selfAppId: "mail",
      action: "read-document-file",
      input,
      userEmail: auth.userEmail,
      orgDomain: auth.orgDomain,
      orgSecret: auth.orgSecret,
      requestTimeoutMs: 30_000,
    });
  } catch {
    fail("Could not reach Content. Check its connection and try again.", {
      statusCode: 502,
      errorCode: "content_unavailable",
    });
  }
  if (response.result.status !== "completed") {
    const code = contentErrorCode(response.result.output);
    const known = code ? CONTENT_ERRORS[code] : undefined;
    fail(
      known?.message ??
        "Content could not read this page. Check your access and its connection.",
      {
        statusCode: known?.statusCode ?? 409,
        errorCode: known && code ? code : "content_page_unavailable",
      },
    );
  }
  try {
    return JSON.parse(response.result.output) as unknown;
  } catch {
    fail("Content returned an incomplete response. Try again.", {
      statusCode: 502,
      errorCode: "content_invalid_response",
    });
  }
}

export async function listContentPages(args: {
  search?: string;
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
  format?: ContentFileFormat;
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
    (args.format && parsed.data.format !== args.format)
  ) {
    fail("Content returned an invalid file. Try again.", {
      statusCode: 502,
      errorCode: "content_invalid_response",
    });
  }
  return parsed.data;
}

const EXTENSION_BY_FORMAT: Record<ContentFileFormat, string> = {
  markdown: ".md",
  csv: ".csv",
};

/**
 * The name the recipient sees, ending in the format's extension whatever
 * Content sent, so the stored file's type matches what it holds.
 */
export function attachmentNameForFile(file: ContentPageFile) {
  const extension = EXTENSION_BY_FORMAT[file.format];
  const base =
    file.filename
      .replace(/[\\/\0\r\n]+/g, " ")
      .replace(/\.(?:md|markdown|csv)$/i, "")
      .trim()
      .slice(0, 255 - extension.length) || "Untitled";
  return `${base}${extension}`;
}
