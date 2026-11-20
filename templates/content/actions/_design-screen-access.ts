import {
  authorizeEmbedPage,
  embedDocumentIdSchema,
  type EmbedPage,
} from "./_embed-page-access.js";

export const designScreenDocumentIdSchema = embedDocumentIdSchema;

export async function authorizeDesignScreenPage(
  documentId: string,
  role: "viewer" | "editor",
): Promise<EmbedPage> {
  return authorizeEmbedPage(documentId, role, {
    signedOut: {
      message: "Sign in to pin Design screens.",
      errorCode: "design_screen_signed_out",
    },
    editRequired: {
      message: "Only the page's editors can pin or refresh Design screens.",
      errorCode: "design_screen_edit_required",
    },
  });
}
