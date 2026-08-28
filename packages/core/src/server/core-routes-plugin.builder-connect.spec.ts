import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
}));

import { resolveBuilderOrgMutation } from "./core-routes-plugin.js";

function createMockEvent(): H3Event {
  return {
    req: {
      method: "POST",
      url: "https://example.com/_agent-native/builder/connect",
      headers: new Headers({ host: "example.com" }),
    },
    url: new URL("https://example.com/_agent-native/builder/connect"),
    node: {
      req: {
        headers: { host: "example.com" },
        method: "POST",
        socket: { remoteAddress: "203.0.113.10" },
        url: "/_agent-native/builder/connect",
      },
    },
    headers: new Headers({ host: "example.com" }),
    context: {},
    path: "/_agent-native/builder/connect",
  } as unknown as H3Event;
}

beforeEach(() => {
  getOrgContextMock.mockReset();
});

describe("resolveBuilderOrgMutation", () => {
  it("allows any authenticated org member to start Builder connect", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(
      resolveBuilderOrgMutation(createMockEvent(), {
        allowMemberInitiation: true,
      }),
    ).resolves.toEqual({
      orgId: "org-123",
      deny: null,
    });
  });

  it("keeps shared Builder revocation owner/admin protected", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(resolveBuilderOrgMutation(createMockEvent())).resolves.toEqual(
      {
        orgId: "org-123",
        deny: "Only an organization owner or admin can change the shared Builder connection.",
      },
    );
  });
});
