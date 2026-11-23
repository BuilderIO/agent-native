import { describe, expect, it } from "vitest";

import { normalizeActionChatUIConfig } from "./action-ui.js";

describe("normalizeActionChatUIConfig", () => {
  it("preserves the server-side applicability predicate", () => {
    const when = () => true;
    const projectResult = (_args: Record<string, unknown>, result: unknown) =>
      result;

    expect(
      normalizeActionChatUIConfig({
        renderer: "mail.draft-created",
        when,
        projectResult,
      }),
    ).toEqual({ renderer: "mail.draft-created", when, projectResult });
  });
});
