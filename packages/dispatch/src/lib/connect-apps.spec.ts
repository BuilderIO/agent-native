import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args),
}));

import {
  fetchConnectAgentCard,
  fetchMarketplaceApps,
} from "../server/lib/connect-apps";
import {
  buildAgentCardUrl,
  buildIdentityConnectUrl,
  normalizeConnectUrl,
  parseConnectAgentCard,
} from "./connect-apps";

describe("connect apps helpers", () => {
  beforeEach(() => ssrfSafeFetchMock.mockReset());

  it("rejects unsafe or credential-bearing URLs", () => {
    expect(normalizeConnectUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeConnectUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeConnectUrl("https://127.0.0.1")).toBeNull();
    expect(normalizeConnectUrl("https://169.254.169.254")).toBeNull();
    expect(normalizeConnectUrl("https://[::1]")).toBeNull();
    expect(normalizeConnectUrl("https://[::ffff:127.0.0.1]")).toBeNull();
    expect(normalizeConnectUrl("https://[::ffff:7f00:1]")).toBeNull();
    expect(normalizeConnectUrl("https://[::ffff:6440:1]")).toBeNull();
    expect(normalizeConnectUrl("https://[::ffff:0:0]")).toBeNull();
    expect(normalizeConnectUrl("https://[fc00::1]")).toBeNull();
    expect(normalizeConnectUrl("https://[fe80::1]")).toBeNull();
    expect(normalizeConnectUrl("https://fdroid.org")).not.toBeNull();
    expect(normalizeConnectUrl("http://localhost:3000")).toBeNull();
  });

  it("accepts a connect-capable card only from the requested origin", () => {
    const card = parseConnectAgentCard(
      {
        name: "Slides",
        description: "A slide workspace",
        url: "https://slides.example.com/_agent-native/a2a",
        capabilities: { connect: true },
      },
      "https://slides.example.com",
    );
    expect(card).toMatchObject({ name: "Slides", connect: true });
    expect(
      parseConnectAgentCard(
        {
          name: "Slides",
          description: "A slide workspace",
          url: "https://evil.example.com/_agent-native/a2a",
          capabilities: { connect: true },
        },
        "https://slides.example.com",
      ),
    ).toBeNull();
    expect(
      parseConnectAgentCard(
        {
          name: "Slides",
          description: "A slide workspace",
          url: "https://user:pass@slides.example.com/_agent-native/a2a",
          capabilities: { connect: true },
        },
        "https://slides.example.com",
      ),
    ).toBeNull();
    expect(
      parseConnectAgentCard(
        {
          name: "Slides",
          description: "A slide workspace",
          url: "https://slides.example.com/other-app/_agent-native/a2a",
          capabilities: { connect: true },
        },
        "https://slides.example.com",
        "/slides",
      ),
    ).toBeNull();
    expect(
      parseConnectAgentCard(
        {
          name: "Slides",
          description: "A slide workspace",
          url: "https://slides.example.com/slides/_agent-native/a2a",
          capabilities: { connect: true },
        },
        "https://slides.example.com",
        "/slides",
      ),
    ).toMatchObject({ connect: true });
  });

  it("uses the existing identity login and open handoff", () => {
    const url = new URL(buildIdentityConnectUrl("https://slides.example.com"));
    expect(url.pathname).toBe("/_agent-native/identity/login");
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("return")).toBe("/_agent-native/open");
  });

  it("builds a path-mounted agent card URL", () => {
    expect(
      buildAgentCardUrl("https://community.agent-native.com/account-tiering"),
    ).toBe(
      "https://community.agent-native.com/account-tiering/.well-known/agent-card.json",
    );
  });

  it("fetches agent cards through the server SSRF boundary", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Account Tiering",
          description: "Prioritize accounts",
          url: "https://community.agent-native.com/account-tiering/_agent-native/a2a",
          capabilities: { connect: true },
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchConnectAgentCard(
        "https://community.agent-native.com/account-tiering",
      ),
    ).resolves.toMatchObject({ name: "Account Tiering", connect: true });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://community.agent-native.com/account-tiering/.well-known/agent-card.json",
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
      expect.objectContaining({
        maxRedirects: 3,
        requireDispatcher: true,
        httpsOnly: true,
        assertUrlAllowed: expect.any(Function),
      }),
    );
    const fetchPolicy = ssrfSafeFetchMock.mock.calls[0]?.[2] as {
      assertUrlAllowed: (url: string) => void;
    };
    expect(() =>
      fetchPolicy.assertUrlAllowed(
        "https://evil.example.test/account-tiering/.well-known/agent-card.json",
      ),
    ).toThrow(/requested URL/);
    expect(() =>
      fetchPolicy.assertUrlAllowed(
        "https://community.agent-native.com/account-tiering/.well-known/agent-card.json",
      ),
    ).not.toThrow();
  });

  it("rejects unsafe addresses before calling the server fetch boundary", async () => {
    await expect(fetchConnectAgentCard("https://127.0.0.1")).rejects.toThrow(
      /secure app URL/,
    );
    await expect(
      fetchConnectAgentCard("http://localhost:3000"),
    ).rejects.toThrow(/secure app URL/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe marketplace entries before rendering links", async () => {
    ssrfSafeFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            apps: [
              {
                id: "unsafe",
                name: "Unsafe",
                description: "bad",
                url: "javascript:alert(1)",
                capabilities: ["connect"],
              },
              {
                id: "safe",
                name: "Safe",
                description: "ok",
                url: "https://safe.example.test",
                capabilities: ["connect"],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "Safe",
            description: "ok",
            url: "https://safe.example.test/_agent-native/a2a",
            capabilities: { connect: true },
          }),
          { status: 200 },
        ),
      );

    await expect(fetchMarketplaceApps("https://feed.test")).resolves.toEqual([
      expect.objectContaining({ id: "safe" }),
    ]);
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://feed.test/",
      "https://safe.example.test/.well-known/agent-card.json",
    ]);
  });
});
