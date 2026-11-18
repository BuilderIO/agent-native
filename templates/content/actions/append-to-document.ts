import { ActionContractError } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentRevisionToken } from "../server/lib/document-revision.js";
import { assertNoNewlySharedVideoIds } from "../server/lib/video-block-ids.js";
import { rewriteContentLiveCopyBody } from "../server/live-copy/write.js";
import { canonicalizeNfm } from "../shared/nfm.js";
import { getDatabaseByDocumentId } from "./_database-utils.js";
import {
  assertAgentsMayEditPageText,
  isAgentCall,
  serverSaveContext,
} from "./_document-agent-lock.js";
import { assertEditableDocument } from "./_document-edit-mutation.js";
import { assertSourceAllowsPageEdit } from "./_document-source.js";
import updateDocument from "./update-document.js";

/**
 * The page's body with `blocks` after its last block. Each block is a line of
 * its own, so the two join with one newline once the page's trailing blank
 * lines are gone.
 */
export function appendBlocksToBody(body: string, blocks: string): string {
  const kept = body.replace(/[\r\n]+$/, "");
  return kept ? `${kept}\n${blocks}` : blocks;
}

function isRevisionConflict(error: unknown) {
  return (
    error instanceof ActionContractError &&
    error.errorCode === "DOCUMENT_REVISION_CONFLICT"
  );
}

export default defineAction({
  description:
    "Add blocks to the end of a page, for the block menu's Move to. The editor removes the block from its own page once this returns.",
  schema: z.object({
    documentId: z.string().describe("ID of the page the blocks go to"),
    content: z
      .string()
      .describe("The blocks as Content Markdown, one block per line"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    title: z.string(),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend" && !isAgentCall(ctx),
  run: async ({ documentId, content }, ctx) => {
    if (!content.trim()) fail("There is nothing to move.", { statusCode: 400 });
    const blocks = canonicalizeNfm(content);

    // A tab's save between the read and the write makes the first try
    // conflict; the second reads the page again.
    for (let attempt = 0; ; attempt++) {
      const access = await assertAccess("document", documentId, "editor");
      const page = access.resource;
      assertEditableDocument(page);
      if (await getDatabaseByDocumentId(documentId)) {
        fail("A collection's page doesn't take blocks. Pick a page.", {
          errorCode: "DOCUMENT_IS_COLLECTION",
          statusCode: 400,
        });
      }
      assertSourceAllowsPageEdit(page);
      assertAgentsMayEditPageText(page, ctx);
      const existing = (page.content as string | null) ?? "";
      const next = appendBlocksToBody(existing, blocks);
      assertNoNewlySharedVideoIds(existing, next);

      try {
        const wroteLiveCopy = await rewriteContentLiveCopyBody(documentId, {
          cause: { ctx, operation: "append-to-document" },
          base: existing,
          candidate: next,
        });
        if (!wroteLiveCopy) {
          const saved = await updateDocument.run(
            {
              id: documentId,
              content: next,
              baseRevision: documentRevisionToken(page.bodyRevision, existing),
            },
            serverSaveContext(ctx),
          );
          if ("conflict" in saved) {
            fail("The page changed while the block was added. Try again.", {
              errorCode: "DOCUMENT_REVISION_CONFLICT",
              statusCode: 409,
            });
          }
        }
      } catch (error) {
        if (attempt === 0 && isRevisionConflict(error)) continue;
        throw error;
      }

      await writeAppState("refresh-signal", { ts: Date.now() });
      return { documentId, title: (page.title as string | null) ?? "" };
    }
  },
});
