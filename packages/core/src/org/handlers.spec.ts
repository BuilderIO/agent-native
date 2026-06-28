import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockGetOrgContext = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, key: string) => event._params?.[key],
  getRequestURL: (event: any) => new URL(event._url),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
  createOrganization: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
}));

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn(),
}));

vi.mock("../server/email-templates.js", () => ({
  renderInviteEmail: vi.fn(() => ({ subject: "", html: "", text: "" })),
}));

vi.mock("../server/email.js", () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (event: any) => Promise.resolve(event._body),
}));

vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: vi.fn(),
}));

import { listMembersHandler } from "./handlers.js";

function makeEvent(path: string) {
  return { _url: `https://app.example.test${path}` } as any;
}

describe("org handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 0 });
  });

  it("uses a non-backslash LIKE escape for paginated member search", async () => {
    await listMembersHandler(
      makeEvent("/_agent-native/org/members?q=Alice%25_Bob!&limit=8&offset=16"),
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toContain("LOWER(email) LIKE ? ESCAPE '!'");
    expect(call.sql).toContain("LIMIT ? OFFSET ?");
    expect(call.sql).not.toContain("ESCAPE '\\'");
    expect(call.args).toEqual(["org-1", "%alice!%!_bob!!%", 9, 16]);
  });
});
