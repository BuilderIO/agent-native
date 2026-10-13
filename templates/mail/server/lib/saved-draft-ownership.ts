import { findGmailDraftAccount } from "./gmail-drafts.js";
import { readLocalEmails } from "./local-email-store.js";

export type SavedDraftBackend = "gmail" | "local";

export class SavedDraftOwnershipError extends Error {
  constructor(savedDraftId: string) {
    super(
      `Could not verify the backend for saved draft ${savedDraftId}; no matching local or Gmail draft was found.`,
    );
    this.name = "SavedDraftOwnershipError";
  }
}

export async function resolveExistingSavedDraftOwnership(args: {
  ownerEmail: string;
  savedDraftId: string;
  savedDraftBackend?: SavedDraftBackend;
  accountEmail?: string;
}): Promise<{ backend: SavedDraftBackend; accountEmail?: string }> {
  if (args.savedDraftBackend === "local") return { backend: "local" };
  if (args.savedDraftBackend === "gmail" && args.accountEmail) {
    return { backend: "gmail", accountEmail: args.accountEmail };
  }

  if (!args.savedDraftBackend) {
    const localEmails = await readLocalEmails(args.ownerEmail);
    if (
      localEmails.some(
        (email) => email.id === args.savedDraftId && email.isDraft,
      )
    ) {
      return { backend: "local" };
    }
  }

  const accountEmail = await findGmailDraftAccount({
    ownerEmail: args.ownerEmail,
    accountEmail: args.accountEmail,
    draftId: args.savedDraftId,
  });
  if (accountEmail) return { backend: "gmail", accountEmail };

  throw new SavedDraftOwnershipError(args.savedDraftId);
}
