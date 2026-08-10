import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({
  default: {},
}));

import { FORMS_SYSTEM_PROMPT } from "./agent-chat";

describe("Forms agent public form links", () => {
  it("requires the action's canonical URL instead of slug-derived links", () => {
    expect(FORMS_SYSTEM_PROMPT).toContain(
      "copy the returned `publicUrl` verbatim",
    );
    expect(FORMS_SYSTEM_PROMPT).toContain(
      "Never derive a public link from `slug`",
    );
    expect(FORMS_SYSTEM_PROMPT).toContain("remove the `/f/` path segment");
    expect(FORMS_SYSTEM_PROMPT).toContain("instead of inventing one");
  });
});
