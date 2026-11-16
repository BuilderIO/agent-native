import { describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/dispatch-store.js", () => ({
  createLinkToken: vi.fn(),
}));

import action from "./create-link-token.js";

describe("create-link-token", () => {
  it("keeps the link token out of persisted chat history and still asks for approval", () => {
    expect(action.persistInChatHistory).toBe(false);
    expect(action.needsApproval).toBe(true);
    expect(action.allowPersistentApproval).toBe(false);
  });
});
