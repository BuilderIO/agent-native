import { canonicalizeNfm } from "@shared/nfm";

/**
 * Whether the editor should save the text its collaborators converged on.
 * The stored body can spell that same page differently: a page an agent wrote
 * keeps a blank line between paragraphs, and the editor holds one block per
 * line. Saving the editor's spelling changes nothing on the page, and the save
 * can land after another writer, such as a suggestion accepted next, has
 * changed the body, which the server refuses as an edit that would lose text.
 */
export function convergedContentNeedsSave(args: {
  live: string;
  saved: string;
  attempted: string | null;
}): boolean {
  if (args.live === args.saved || args.live === args.attempted) return false;
  return canonicalizeNfm(args.live) !== canonicalizeNfm(args.saved);
}
