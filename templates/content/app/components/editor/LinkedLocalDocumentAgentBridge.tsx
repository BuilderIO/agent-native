import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { startAgentNativeBrowserSessionBridge } from "@agent-native/core/client/host";
import type { AgentNativeClientAction } from "@agent-native/core/client/host";
import type { Document } from "@shared/api";
import {
  applyDocumentTextEdits,
  type DocumentTextEdit,
} from "@shared/document-text-edits";
import { useEffect, useRef } from "react";

import {
  readDocumentFromLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "@/lib/local-content-source-files";

type EditArgs = {
  documentId: string;
  expectedContent: string;
  expectedTitle: string;
  edits: DocumentTextEdit[];
};

const actionName = (documentId: string) =>
  `content-edit-linked-document:${documentId}`;

export function LinkedLocalDocumentAgentBridge({
  document,
  onPersisted,
}: {
  document: Document;
  onPersisted(document: Document): void;
}) {
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    const action: AgentNativeClientAction<EditArgs> = {
      name: actionName(document.id),
      description: actionName(document.id),
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          expectedContent: { type: "string" },
          expectedTitle: { type: "string" },
          edits: { type: "array" },
        },
        required: ["documentId", "expectedContent", "expectedTitle", "edits"],
      },
      async run(args) {
        const current = documentRef.current;
        if (args.documentId !== current.id) {
          return { status: "conflict", error: "The open document changed." };
        }
        const baseline = await readDocumentFromLinkedLocalSource(current);
        if (!baseline.ok) {
          return {
            status: baseline.unavailable ? "unavailable" : "failed",
            error: baseline.error,
          };
        }
        if (
          baseline.document.content !== args.expectedContent ||
          baseline.document.title !== args.expectedTitle
        ) {
          return {
            status: "conflict",
            error: "The linked file changed after the agent loaded it.",
          };
        }
        const applied = applyDocumentTextEdits(
          baseline.document.content,
          args.edits,
        );
        if (applied.changeCount === 0) {
          return {
            status: "failed",
            error: "None of the requested text was found in the linked file.",
          };
        }
        const next = { ...baseline.document, content: applied.content };
        const written = await writeDocumentToLinkedLocalSource(
          next,
          current.source,
          { expectedRevision: baseline.revision },
        );
        if (!written.ok) {
          return {
            status: written.conflict
              ? "conflict"
              : written.unavailable
                ? "unavailable"
                : "failed",
            error: written.error,
          };
        }
        const readBack = await readDocumentFromLinkedLocalSource(next);
        if (!readBack.ok) {
          return { status: "failed", error: readBack.error };
        }
        if (readBack.document.content !== applied.content) {
          return {
            status: "failed",
            error:
              "The linked file read-back did not match the requested edit.",
          };
        }
        onPersisted(readBack.document);
        return {
          status: "persisted",
          content: readBack.document.content,
          title: readBack.document.title,
          path: readBack.path,
          runtime: readBack.runtime,
          revision: readBack.revision,
        };
      },
    };
    const bridge = startAgentNativeBrowserSessionBridge({
      session: {
        id: `${getBrowserTabId()}:content-page:${document.id}`,
        label: document.title,
        connectedAt: new Date().toISOString(),
        url: window.location.href,
      },
      label: `Content: ${document.title}`,
      getContext: () => ({
        route: { pathname: window.location.pathname },
        resource: { type: "document", id: document.id },
      }),
      actions: [action],
    });
    return () => bridge.stop();
  }, [document.id, onPersisted]);

  return null;
}
