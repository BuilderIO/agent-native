import { buildDeepLink } from "@agent-native/core/server";

import type { ComposeState } from "../../shared/types.js";

export function composeDeepLink(draft: Pick<ComposeState, "id">): string {
  return buildDeepLink({
    app: "mail",
    view: "inbox",
    to: "/inbox",
    params: { composeDraftId: draft.id },
  });
}
