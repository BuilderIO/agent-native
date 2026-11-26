import { fail } from "@agent-native/core/action";
import {
  buildDeepLink,
  getAppConfig,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  contentErrorCode,
  invokeContentAction,
  parseContentOutput,
} from "./content-page-files.js";

const SIGN_IN_MESSAGE = "Sign in to read or add notes.";

export const contactNoteSchema = z.object({
  markdown: z.string(),
  url: z.string(),
  updatedAt: z.string(),
});

const noteResultSchema = z.object({ note: contactNoteSchema.nullable() });
const addResultSchema = z.object({
  note: contactNoteSchema,
  created: z.boolean(),
});

const NOTE_ERRORS: Record<string, { message: string; statusCode: number }> = {
  mail_note_trashed: {
    message:
      "This person's note is in Trash in Content. Restore it there to see or add notes.",
    statusCode: 409,
  },
  AGENT_TEXT_LOCKED: {
    message:
      "This person's note page in Content is set so apps and agents can't change its text. Change that from the page's Share panel in Content.",
    statusCode: 403,
  },
  AGENT_VIEW_ONLY: {
    message:
      "This person's note page in Content is set so apps and agents can only read it. Change that from the page's Share panel in Content.",
    statusCode: 403,
  },
  DOCUMENT_REVISION_CONFLICT: {
    message: "The note page changed while your note was saved. Try again.",
    statusCode: 409,
  },
};

function failFromContent(output: string, fallback: string): never {
  const code = contentErrorCode(output);
  const known = code ? NOTE_ERRORS[code] : undefined;
  fail(known?.message ?? fallback, {
    statusCode: known?.statusCode ?? 409,
    errorCode: known && code ? code : "content_note_unavailable",
  });
}

function invalidResponse(): never {
  fail("Content returned an invalid note. Try again.", {
    statusCode: 502,
    errorCode: "content_invalid_response",
  });
}

export async function readContactNote(email: string) {
  const result = await invokeContentAction(
    "get-mail-note",
    { email },
    SIGN_IN_MESSAGE,
  );
  if (result.status !== "completed") {
    failFromContent(
      result.output,
      "Content couldn't read this person's note. Check your access and try again.",
    );
  }
  const parsed = noteResultSchema.safeParse(parseContentOutput(result.output));
  if (!parsed.success) invalidResponse();
  return parsed.data;
}

export async function addContactNote(args: {
  email: string;
  text: string;
  name?: string | undefined;
  date?: string | undefined;
  threadId?: string | undefined;
  subject?: string | undefined;
}) {
  const url = args.threadId
    ? toAbsoluteOpenUrl(
        buildDeepLink({
          app: "mail",
          view: "inbox",
          params: { threadId: args.threadId },
        }),
        getAppConfig().app.url,
      )
    : undefined;
  const link =
    url && /^https?:\/\//.test(url)
      ? { label: args.subject?.trim() || "Email", url }
      : undefined;
  const result = await invokeContentAction(
    "add-mail-note",
    {
      email: args.email,
      text: args.text,
      ...(args.name?.trim() ? { name: args.name.trim() } : {}),
      ...(args.date ? { date: args.date } : {}),
      ...(link ? { link } : {}),
    },
    SIGN_IN_MESSAGE,
  );
  if (result.status !== "completed") {
    failFromContent(
      result.output,
      "Content couldn't save the note. Check your access and try again.",
    );
  }
  const parsed = addResultSchema.safeParse(parseContentOutput(result.output));
  if (!parsed.success) invalidResponse();
  return parsed.data;
}
