import {
  callBrowserSession,
  listBrowserSessions,
} from "@agent-native/core/server";

import type { DocumentTextEdit } from "../shared/document-text-edits.js";

export const linkedLocalDocumentEditActionName = (documentId: string) =>
  `content-edit-linked-document:${documentId}`;

type LinkedLocalEditReceipt =
  | {
      status: "persisted";
      content: string;
      title: string;
      path: string;
      runtime: "browser" | "desktop";
      revision?: string;
    }
  | {
      status: "conflict" | "unavailable" | "failed";
      error: string;
    };

function isReceipt(value: unknown): value is LinkedLocalEditReceipt {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return ["persisted", "conflict", "unavailable", "failed"].includes(
    String(status),
  );
}

export async function editLinkedLocalDocumentThroughBrowser(args: {
  ownerEmail: string;
  documentId: string;
  expectedContent: string;
  edits: DocumentTextEdit[];
}): Promise<LinkedLocalEditReceipt> {
  const name = linkedLocalDocumentEditActionName(args.documentId);
  const sessions = await listBrowserSessions(args.ownerEmail, { limit: 100 });
  const matches = sessions.filter((session) =>
    session.actions.some((action) => action.name === name),
  );
  if (matches.length === 0) {
    return {
      status: "unavailable",
      error:
        "Open this linked document in a browser with its local source folder connected, then retry the edit.",
    };
  }
  if (matches.length > 1) {
    return {
      status: "conflict",
      error:
        "This linked document is open in more than one writable browser session. Close the extra tab and retry.",
    };
  }

  try {
    const result = await callBrowserSession(
      args.ownerEmail,
      matches[0]!.sessionId,
      {
        type: "run-action",
        name,
        args: {
          documentId: args.documentId,
          expectedContent: args.expectedContent,
          edits: args.edits,
        },
        timeoutMs: 30_000,
      },
      { timeoutMs: 30_000 },
    );
    return isReceipt(result)
      ? result
      : {
          status: "failed",
          error: "The local source returned an invalid receipt.",
        };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "The local source write failed.",
    };
  }
}
