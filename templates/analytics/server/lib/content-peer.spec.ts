import { resetAppConfigForTests } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveA2ACallerAuth: vi.fn(),
  invokeAgentAction: vi.fn(),
}));

const discovery = vi.hoisted(() => ({
  contentUrl: "https://content.agent-native.com",
}));

vi.mock("@agent-native/core/a2a", () => ({
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
  invokeAgentAction: mocks.invokeAgentAction,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () => [{ id: "content", url: discovery.contentUrl }],
}));

import { requestContentCitations } from "./content-peer";

const PAGE = {
  id: "doc_1",
  title: "Q4 review",
  url: "https://content.agent-native.com/page/doc_1",
  updatedAt: "2026-11-18T10:00:00.000Z",
};

function answer(status: "completed" | "failed", output: string) {
  return {
    result: { action: "list-analytics-chart-citations", status, output },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  discovery.contentUrl = "https://content.agent-native.com";
  mocks.resolveA2ACallerAuth.mockResolvedValue({
    userEmail: "reader@example.test",
    orgDomain: "example.test",
    orgSecret: "org-secret",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("requestContentCitations", () => {
  it("asks Content as the signed-in person for the pages citing a dashboard", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ pages: [PAGE], more: true })),
    );
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: true,
      pages: [PAGE],
      more: true,
    });
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith({
      target: "content",
      selfAppId: "analytics",
      action: "list-analytics-chart-citations",
      input: { dashboardId: "growth" },
      userEmail: "reader@example.test",
      orgDomain: "example.test",
      orgSecret: "org-secret",
      requestTimeoutMs: 15_000,
    });
  });

  it("asks beta Content when Analytics is served from beta", async () => {
    vi.stubEnv("APP_URL", "https://beta.analytics.agent-native.com");
    resetAppConfigForTests();
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ pages: [], more: false })),
    );
    await requestContentCitations("growth");
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "https://beta.content.agent-native.com",
      }),
    );
  });

  it("asks the built-in Content by name on production and locally", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ pages: [], more: false })),
    );
    for (const lane of [
      {
        analytics: "https://analytics.agent-native.com",
        content: "https://content.agent-native.com",
      },
      { analytics: "http://localhost:8084", content: "http://localhost:8083" },
    ]) {
      vi.stubEnv("APP_URL", lane.analytics);
      resetAppConfigForTests();
      discovery.contentUrl = lane.content;
      await requestContentCitations("growth");
    }
    expect(
      mocks.invokeAgentAction.mock.calls.map((call) => call[0]?.target),
    ).toEqual(["content", "content"]);
  });

  it("opens a page link Content sent without its origin on Content's lane", async () => {
    vi.stubEnv("APP_URL", "https://beta.analytics.agent-native.com");
    resetAppConfigForTests();
    mocks.invokeAgentAction.mockResolvedValue(
      answer(
        "completed",
        JSON.stringify({
          pages: [{ ...PAGE, url: "/page/doc_1" }],
          more: false,
        }),
      ),
    );
    await expect(requestContentCitations("growth")).resolves.toMatchObject({
      ok: true,
      pages: [{ url: "https://beta.content.agent-native.com/page/doc_1" }],
    });
  });

  it("asks nothing without a signed-in person", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValue({ userEmail: undefined });
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: false,
      code: "content_signed_out",
    });
    expect(mocks.invokeAgentAction).not.toHaveBeenCalled();
  });

  it("says when Content can't be reached, refuses, or answers nonsense", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invokeAgentAction.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: false,
      code: "content_unreachable",
    });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer("failed", JSON.stringify({ error: "Sign in" })),
    );
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: false,
      code: "content_refused",
    });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer("completed", JSON.stringify({ pages: "none" })),
    );
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: false,
      code: "content_invalid_response",
    });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer(
        "completed",
        JSON.stringify({
          pages: [{ ...PAGE, url: "javascript:alert(1)" }],
          more: false,
        }),
      ),
    );
    await expect(requestContentCitations("growth")).resolves.toEqual({
      ok: false,
      code: "content_invalid_response",
    });
    warn.mockRestore();
  });

  it("logs the shape, not the titles, of an answer it can't read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer(
        "completed",
        JSON.stringify({
          pages: [{ ...PAGE, updatedAt: 7, secret: "acme" }],
          more: false,
        }),
      ),
    );
    await requestContentCitations("growth");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("acme");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Q4 review");
    warn.mockRestore();
  });
});
