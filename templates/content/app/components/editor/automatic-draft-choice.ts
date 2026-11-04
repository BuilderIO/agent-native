import type { Document } from "@shared/api";

/**
 * Where a draft goes when nobody is there to choose. A page's History shows
 * only what its owner filed: anyone else's copy would be kept but out of their
 * reach, so it becomes a private page in their own space.
 */
export function automaticDraftChoice(
  accessRole: Document["accessRole"],
): "use_saved" | "save_separately" {
  return accessRole === "owner" ? "use_saved" : "save_separately";
}
