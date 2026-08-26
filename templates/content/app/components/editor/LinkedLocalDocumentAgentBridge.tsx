import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { startAgentNativeBrowserSessionBridge } from "@agent-native/core/client/host";
import type { AgentNativeClientAction } from "@agent-native/core/client/host";
import type { Document } from "@shared/api";
import {
  applyDocumentTextEdits,
  type DocumentTextEdit,
} from "@shared/document-text-edits";
import { useEffect, useRef } from "react";

import type { DesktopContentFileRevision } from "@/lib/desktop-content-files";
import {
  readDocumentFromLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "@/lib/local-content-source-files";

type EditArgs = {
  documentId: string;
  expectedContent: string;
  expectedTitle: string;
  expectedDescription: string;
  expectedMetadata: string;
  edits: DocumentTextEdit[];
};

const actionName = (documentId: string) =>
  `content-edit-linked-document:${documentId}`;

export function LinkedLocalDocumentAgentBridge({
  document,
  getEditorSnapshot,
  onPersisted,
}: {
  document: Document;
  getEditorSnapshot(): { title: string; content: string };
  onPersisted(document: Document, revision?: DesktopContentFileRevision): void;
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
          expectedDescription: { type: "string" },
          expectedMetadata: { type: "string" },
          edits: { type: "array" },
        },
        required: [
          "documentId",
          "expectedContent",
          "expectedTitle",
          "expectedDescription",
          "expectedMetadata",
          "edits",
        ],
      },
      async run(args) {
        const current = documentRef.current;
        if (args.documentId !== current.id) {
          return { status: "conflict", error: "The open document changed." };
        }
        const editorMatchesExpected = () => {
          const editor = getEditorSnapshot();
          return (
            editor.content === args.expectedContent &&
            editor.title === args.expectedTitle
          );
        };
        if (!editorMatchesExpected()) {
          return {
            status: "conflict",
            error:
              "Save the pending editor changes before retrying the agent edit.",
          };
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
          baseline.document.title !== args.expectedTitle ||
          (baseline.document.description ?? "") !== args.expectedDescription ||
          JSON.stringify({
            parentId: baseline.document.parentId,
            icon: baseline.document.icon,
            position: baseline.document.position,
            isFavorite: baseline.document.isFavorite,
            hideFromSearch: baseline.document.hideFromSearch,
            visibility: baseline.document.visibility,
          }) !== args.expectedMetadata
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
        if (!editorMatchesExpected()) {
          return {
            status: "conflict",
            error:
              "The editor changed while the agent edit was being prepared.",
          };
        }
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
          return {
            status: "source-persisted/readback-pending",
            content: next.content,
            title: next.title,
            path: written.path,
            runtime: written.runtime,
            revision: written.revision,
          };
        }
        if (readBack.document.content !== applied.content) {
          return {
            status: "failed",
            error:
              "The linked file read-back did not match the requested edit.",
          };
        }
        onPersisted(readBack.document, readBack.revision);
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
  }, [document.id, getEditorSnapshot, onPersisted]);

  return null;
}
