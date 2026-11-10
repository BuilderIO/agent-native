import { H3 } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAppState: vi.fn(),
  deleteAppStateByPrefix: vi.fn(),
  deleteGmailDraft: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
  deleteAppState: vi.fn(),
  deleteAppStateByPrefix: mocks.deleteAppStateByPrefix,
  listAppState: mocks.listAppState,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "owner@example.com",
  buildDeepLink: () => "/mail",
}));

vi.mock("../server/lib/gmail-drafts.js", () => ({
  saveGmailDraft: vi.fn(),
  deleteGmailDraft: mocks.deleteGmailDraft,
  findGmailDraftAccount: vi.fn(),
}));

import manageDraft from "./manage-draft";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAppState.mockResolvedValue([
    { key: "compose-first", value: { id: "first", body: "Draft" } },
  ]);
});

async function deleteAllOverRoute(headers: Record<string, string>) {
  const { mountActionRoutes } = await import("@agent-native/core/server");
  const h3 = new H3();
  mountActionRoutes(
    { h3, hooks: { hook: () => {} } },
    { "manage-draft": manageDraft as any },
    {
      appId: "mail",
      getOwnerFromEvent: async () => "owner@example.com",
      resolveOrgId: async () => "org-1",
    },
  );
  const response = await h3.fetch(
    new Request(
      "https://mail.example.test/_agent-native/actions/manage-draft",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ action: "delete-all" }),
      },
    ),
  );
  return { status: response.status, body: await response.json() };
}

function expectNoDraftTouched() {
  expect(mocks.listAppState).not.toHaveBeenCalled();
  expect(mocks.deleteAppStateByPrefix).not.toHaveBeenCalled();
  expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
}

// The frontend header is only the caller's claim to be the Mail UI. Without
// the UI's proof, delete-all must not run as an in-app call.
describe("manage-draft delete-all with a forged frontend header", () => {
  it("asks a call without UI proof to prove itself first", async () => {
    await expect(
      deleteAllOverRoute({ "x-agent-native-frontend": "1" }),
    ).resolves.toMatchObject({
      status: 403,
      body: { errorCode: "ui_capability_required" },
    });
    expectNoDraftTouched();
  });

  it("requires approval from a bearer caller that also sends the header", async () => {
    const { status, body } = await deleteAllOverRoute({
      authorization: "Bearer example-agent-token",
      "x-agent-native-frontend": "1",
    });

    expect(status).toBe(409);
    expect(body).toMatchObject({ errorCode: "approval_required" });
    expect(body.error).toContain('"manage-draft" requires human approval');
    expectNoDraftTouched();
  });
});
