import { describe, expect, it } from "vitest";

import { normalizeActionChatUIConfig } from "./action-ui.js";

describe("normalizeActionChatUIConfig", () => {
  it("preserves the server-side applicability predicate", () => {
    const when = () => true;

    expect(
      normalizeActionChatUIConfig({
        renderer: "mail.draft-created",
        when,
      }),
    ).toEqual({ renderer: "mail.draft-created", when });
  });
});
