import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

import { submitDesignSystemsWaitlist } from "./design-system-waitlist";

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitDesignSystemsWaitlist", () => {
  it("posts the Design Systems use case and confirms a submitted form", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ formSubmitted: true }),
    });

    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "submitted" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/_agent-native/builder/branch-waitlist",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: "https://design.agent-native.com/design-systems",
          source: "design_systems_page",
          useCase: "design_system_workflows_waitlist",
        }),
      }),
    );
  });

  it("does not treat an unsuccessful form response as a completed signup", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ formSubmitted: false }),
    });

    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unreadable success payloads as unavailable", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    });

    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("requires an explicit submitted result", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("reports rejected requests and non-success responses as failures", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "failed" });

    mocks.fetch.mockResolvedValueOnce({ ok: false });
    await expect(
      submitDesignSystemsWaitlist(
        "https://design.agent-native.com/design-systems",
      ),
    ).resolves.toEqual({ status: "failed" });
  });
});
