import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RoleRequest } from "../../../app/lib/model/role-request-contracts.js";

const pendingRequest: RoleRequest = {
  id: "role-request-1",
  requestedBy: "member@example.test",
  requestedRole: "admin",
  status: "pending",
  requestedAt: "2026-11-10T00:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

let requests: RoleRequest[] = [];
let isAdmin = true;
let requestsError: Error | null = null;
const refetchRequests = vi.fn();

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => ({ request: pendingRequest })),
  useActionQuery: (name: string) =>
    name === "get-workspace-bootstrap"
      ? { data: { features: { isAdmin } }, isPending: false, refetch: vi.fn() }
      : {
          data: requestsError ? undefined : { requests },
          isPending: false,
          error: requestsError,
          refetch: refetchRequests,
        },
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  SettingsGroup: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
}));
vi.mock("@agent-native/toolkit/ui/button", () => ({
  Button: ({ children }: { children: unknown }) => (
    <button type="button">{children as never}</button>
  ),
  ButtonBase: ({ children }: { children: unknown }) => (
    <button type="button">{children as never}</button>
  ),
}));

const { RoleRequestControl, RoleRequestQueue } = await import("./RoleRequests");

describe("workspace role requests", () => {
  it("offers a member the request control until they have an open request", () => {
    isAdmin = false;
    requests = [];
    expect(renderToStaticMarkup(<RoleRequestControl />)).toContain(
      "Request admin access",
    );
    requests = [pendingRequest];
    const html = renderToStaticMarkup(<RoleRequestControl />);
    expect(html).toContain("Request sent");
    expect(html).toContain("Request pending since");
  });

  it("tells an administrator their role instead of offering a request", () => {
    isAdmin = true;
    const html = renderToStaticMarkup(<RoleRequestControl />);
    expect(html).toContain("You are an administrator");
    expect(html).not.toContain("Request admin access");
  });

  it("gives an administrator an approve and a decline for every open request", () => {
    requests = [pendingRequest];
    const html = renderToStaticMarkup(<RoleRequestQueue />);
    expect(html).toContain("member@example.test");
    expect(html).toContain("Approve");
    expect(html).toContain("Decline");
  });

  it("says plainly when no request is open", () => {
    requestsError = null;
    requests = [];
    expect(renderToStaticMarkup(<RoleRequestQueue />)).toContain(
      "No open role requests.",
    );
  });

  it("shows an error alert instead of empty copy when role requests fail to load", () => {
    requestsError = new Error("Role requests unavailable");
    requests = [];
    const html = renderToStaticMarkup(<RoleRequestQueue />);
    expect(html).toContain("Role requests unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No open role requests.");
    requestsError = null;
  });
});
