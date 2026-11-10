import { afterEach, describe, expect, it, vi } from "vitest";

import { mcpApprovalAppPagePath } from "../shared/mcp-approval-review.js";
import {
  fetchMcpApproval,
  McpApprovalRequestError,
  readMcpApprovalId,
  sendMcpApprovalDecision,
} from "./mcp-approval.js";

const ID = "0b7f4c1e-2f4a-4d1c-9a43-5f1e8f0d2c6b";

function answer(status: number, body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the review link's fragment", () => {
  it("names the grant it was given, and nothing else", () => {
    const path = mcpApprovalAppPagePath(ID, "/inbox", "/mail");
    expect(path).toBe(`/mail/inbox#mcpApproval=${ID}`);
    expect(readMcpApprovalId(new URL(path, "https://x.test").hash)).toBe(ID);

    expect(readMcpApprovalId("")).toBeUndefined();
    expect(readMcpApprovalId("#mcpApproval=not-a-grant")).toBeUndefined();
    expect(
      readMcpApprovalId(`#mcpApproval=${ID.toUpperCase()}`),
    ).toBeUndefined();
    expect(readMcpApprovalId(`#other=${ID}`)).toBeUndefined();
  });
});

describe("reading a review", () => {
  it("reads it as JSON from the framework route, with the browser's cookie", async () => {
    const fetch = answer(200, { id: ID, state: "pending" });

    const result = await fetchMcpApproval(ID);

    expect(result).toEqual({
      status: "ready",
      view: { id: ID, state: "pending" },
    });
    expect(fetch).toHaveBeenCalledWith(
      `/_agent-native/mcp/approvals/${ID}`,
      expect.objectContaining({
        credentials: "same-origin",
        headers: { accept: "application/json" },
      }),
    );
  });

  it("tells a grant in another organization from no grant at all", async () => {
    answer(404, { error: "Not found", reason: "other-organization" });
    await expect(fetchMcpApproval(ID)).resolves.toEqual({
      status: "not-found",
      otherOrganization: true,
    });

    answer(404, { error: "Not found" });
    await expect(fetchMcpApproval(ID)).resolves.toEqual({
      status: "not-found",
      otherOrganization: false,
    });
  });

  it("says signed out, and throws for an answer it can't use", async () => {
    answer(401, { error: "Sign in" });
    await expect(fetchMcpApproval(ID)).resolves.toEqual({
      status: "signed-out",
    });

    answer(401, { error: "No hook", reason: "sign-in-unavailable" });
    await expect(fetchMcpApproval(ID)).resolves.toEqual({
      status: "sign-in-unavailable",
    });

    answer(503, { error: "Unavailable" });
    await expect(fetchMcpApproval(ID)).rejects.toBeInstanceOf(
      McpApprovalRequestError,
    );
  });
});

describe("deciding", () => {
  it("sends the decision with the view's token and reads the grant's state", async () => {
    const fetch = answer(200, { state: "approved", expiresAt: 5 });

    const result = await sendMcpApprovalDecision(ID, "approve", "token-1");

    expect(result).toEqual({
      status: "decided",
      state: "approved",
      expiresAt: 5,
    });
    expect(fetch).toHaveBeenCalledWith(
      `/_agent-native/mcp/approvals/${ID}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approve", csrfToken: "token-1" }),
      }),
    );
  });

  it("reads a decision made first elsewhere from a conflict", async () => {
    answer(409, { error: "Already decided", state: "denied", expiresAt: 5 });

    await expect(
      sendMcpApprovalDecision(ID, "approve", "token-1"),
    ).resolves.toEqual({ status: "decided", state: "denied", expiresAt: 5 });
  });

  it.each([
    [401, {}, { status: "signed-out" }],
    [401, { reason: "sign-in-unavailable" }, { status: "sign-in-unavailable" }],
    [403, {}, { status: "out-of-date" }],
    [404, {}, { status: "not-found" }],
  ])(
    "maps %i %j to a result the page can show",
    async (status, body, expected) => {
      answer(status, { error: "No", ...body });

      await expect(
        sendMcpApprovalDecision(ID, "deny", "token-1"),
      ).resolves.toEqual(expected);
    },
  );

  it("throws rather than report a state the server didn't send", async () => {
    answer(409, { error: "Conflict" });
    await expect(
      sendMcpApprovalDecision(ID, "deny", "token-1"),
    ).rejects.toBeInstanceOf(McpApprovalRequestError);

    answer(500, { error: "Broken" });
    await expect(
      sendMcpApprovalDecision(ID, "deny", "token-1"),
    ).rejects.toBeInstanceOf(McpApprovalRequestError);
  });
});
