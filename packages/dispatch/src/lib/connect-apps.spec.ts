import { describe, expect, it } from "vitest";

import {
  buildIdentityConnectUrl,
  fetchConnectAgentCard,
  fetchMarketplaceApps,
  normalizeConnectUrl,
  parseConnectAgentCard,
} from "./connect-apps";

describe("connect apps helpers", () => {
  it("rejects unsafe or credential-bearing URLs", () => {
    expect(normalizeConnectUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeConnectUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeConnectUrl("https://127.0.0.1")).toBeNull();
    expect(normalizeConnectUrl("https://169.254.169.254")).toBeNull();
    expect(normalizeConnectUrl("https://[::1]")).toBeNull();
    expect(normalizeConnectUrl("http://localhost:3000")).not.toBeNull();
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

  it("preserves a path-mounted app when building connection URLs", async () => {
    const identity = new URL(
      buildIdentityConnectUrl(
        "https://community.agent-native.com/account-tiering",
      ),
    );
    expect(identity.pathname).toBe(
      "/account-tiering/_agent-native/identity/login",
    );
    expect(identity.searchParams.get("return")).toBe(
      "/account-tiering/_agent-native/open",
    );

    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          name: "Account Tiering",
          description: "Prioritize accounts",
          url: "https://community.agent-native.com/account-tiering/_agent-native/a2a",
          capabilities: { connect: true },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      await fetchConnectAgentCard(
        "https://community.agent-native.com/account-tiering",
      );
      expect(requestedUrl).toBe(
        "https://community.agent-native.com/account-tiering/.well-known/agent-card.json",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects unsafe marketplace entries before rendering links", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) =>
      new Response(
        typeof input === "string" && input === "https://feed.test"
          ? JSON.stringify({
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
            })
          : JSON.stringify({
              name: "Safe",
              description: "ok",
              url: "https://safe.example.test",
              capabilities: { connect: true },
            }),
        { status: 200 },
      )) as typeof fetch;
    try {
      await expect(fetchMarketplaceApps("https://feed.test")).resolves.toEqual([
        expect.objectContaining({ id: "safe" }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
