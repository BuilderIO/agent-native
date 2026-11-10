import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({
    email: "viewer@example.test",
    orgId: "org-one",
  }),
}));
vi.mock("@agent-native/core/server", () => ({
  listThreads: mocks.list,
  searchThreads: mocks.search,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.access,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("./composer-reference-messages.js", () => ({
  composerReferenceMessages: async () => ({
    authentication: "Sign in",
    invalid: "Invalid reference",
    unavailable: "Reference unavailable",
  }),
}));
import { ForbiddenError } from "@agent-native/core/sharing";
import type { H3Event } from "h3";

import {
  searchConversationReferences,
  validateConversationReferences,
} from "./composer-references.js";
describe("conversation references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("uses the active organization and bounded summary search, without loading transcripts", async () => {
    mocks.search.mockResolvedValue([
      {
        id: "thread-one",
        title: "Roadmap",
        preview: "x".repeat(800),
        threadData: "private full transcript",
      },
    ]);
    const result = await searchConversationReferences("roadmap", {} as H3Event);
    expect(mocks.search).toHaveBeenCalledWith(
      "viewer@example.test",
      "roadmap",
      20,
      { orgId: "org-one", includeExternal: false, sourceAppId: "chat" },
    );
    expect(result).toEqual([
      {
        id: "chat:thread-one",
        label: "Roadmap",
        description: "x".repeat(500),
        refType: "chat",
        refId: "thread-one",
        refPath: "/chat/thread-one",
        icon: "message",
      },
    ]);
    mocks.search.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      searchConversationReferences("roadmap", {} as H3Event),
    ).rejects.toThrow("read failed");
  });
  it("rechecks withdrawn access before accepting selected conversation IDs", async () => {
    mocks.access.mockRejectedValueOnce(new ForbiddenError("revoked"));
    await expect(
      validateConversationReferences([
        {
          type: "mention",
          refType: "chat",
          refId: "thread-one",
          name: "Roadmap",
          path: "/chat/thread-one",
          source: "chat",
        },
      ]),
    ).rejects.toThrow("Reference unavailable");
    expect(mocks.access).toHaveBeenCalledWith(
      "chat_thread",
      "thread-one",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  });
});
