import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockListBrowserSessions = vi.fn();
const mockCallBrowserSession = vi.fn();
const mockGetCurrentRequestBrowserTabId = vi.fn<() => string | null>();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  listBrowserSessions: (...args: unknown[]) => mockListBrowserSessions(...args),
  callBrowserSession: (...args: unknown[]) => mockCallBrowserSession(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "editor@example.com",
}));

vi.mock("./_tab-state.js", () => ({
  getCurrentRequestBrowserTabId: () => mockGetCurrentRequestBrowserTabId(),
}));

import {
  buildContrastAuditRequest,
  CONTRAST_AUDIT_CLIENT_ACTION,
  CONTRAST_AUDIT_RESOURCE_TYPE,
} from "../shared/contrast-audit";
import action from "./audit-contrast";

const slides = [
  { id: "a", content: "<p>A</p>" },
  { id: "b", content: "<p>B</p>" },
];
const designSystemData = JSON.stringify({ colors: { primary: "#000000" } });
const expectedRequest = buildContrastAuditRequest("deck-1", {
  designSystemId: "ds-1",
  designSystemData,
  slides,
});

function session(sessionId: string, deckId: string, withAction = true) {
  return {
    sessionId,
    context: { resource: { type: CONTRAST_AUDIT_RESOURCE_TYPE, id: deckId } },
    actions: withAction ? [{ name: CONTRAST_AUDIT_CLIENT_ACTION }] : [],
  };
}

function cleanResult() {
  return {
    deckId: "deck-1",
    renderKey: expectedRequest.renderKey,
    audited: expectedRequest.slides.map((slide) => ({
      id: slide.id,
      contentHash: slide.contentHash,
    })),
    failures: [],
    unverified: [],
    skipped: [],
  };
}

const run = (args: { deckId: string }) =>
  (action as unknown as { run: (a: typeof args) => Promise<any> }).run(args);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentRequestBrowserTabId.mockReturnValue(null);
  mockResolveAccess.mockImplementation((type: string) => {
    if (type === "design-system") {
      return Promise.resolve({ resource: { data: designSystemData } });
    }
    return Promise.resolve({
      resource: { designSystemId: "ds-1", data: JSON.stringify({ slides }) },
    });
  });
  mockCallBrowserSession.mockResolvedValue(cleanResult());
});

describe("audit-contrast", () => {
  it("runs in the tab that has this deck open, not another deck's tab", async () => {
    mockListBrowserSessions.mockResolvedValue([
      session("tab-other", "deck-2"),
      session("tab-this", "deck-1"),
    ]);

    const report = await run({ deckId: "deck-1" });

    expect(mockCallBrowserSession).toHaveBeenCalledWith(
      "editor@example.com",
      "tab-this",
      expect.objectContaining({
        type: "run-action",
        name: CONTRAST_AUDIT_CLIENT_ACTION,
        args: expectedRequest,
      }),
      expect.any(Object),
    );
    expect(report.canClaimContrastPasses).toBe(true);
  });

  it("fails loudly when no editor has the deck open", async () => {
    mockListBrowserSessions.mockResolvedValue([
      session("tab-other", "deck-2"),
      session("tab-no-action", "deck-1", false),
    ]);

    await expect(run({ deckId: "deck-1" })).rejects.toThrow(
      "open in the Slides editor",
    );
    expect(mockCallBrowserSession).not.toHaveBeenCalled();
  });

  it("rejects a deck the caller cannot access", async () => {
    mockResolveAccess.mockResolvedValue(null);

    await expect(run({ deckId: "deck-1" })).rejects.toThrow("Deck not found");
    expect(mockListBrowserSessions).not.toHaveBeenCalled();
  });
});
