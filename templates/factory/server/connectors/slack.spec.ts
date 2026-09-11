import { afterEach, describe, expect, it, vi } from "vitest";

import { getUserInfo } from "./slack";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getUserInfo cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reuse a cached profile across Slack credentials", async () => {
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const auth =
          init &&
          typeof init.headers === "object" &&
          !Array.isArray(init.headers)
            ? (init.headers as Record<string, string>).Authorization
            : undefined;
        if (auth === "Bearer xoxb-org-a") {
          return jsonResponse({
            ok: true,
            user: {
              id: "U-shared",
              name: "orga",
              profile: { display_name: "Org A" },
            },
          });
        }
        return jsonResponse({
          ok: true,
          user: {
            id: "U-shared",
            name: "orgb",
            profile: { display_name: "Org B" },
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await getUserInfo(
      "primary",
      "U-shared",
      async () => "xoxb-org-a",
    );
    const second = await getUserInfo(
      "primary",
      "U-shared",
      async () => "xoxb-org-b",
    );

    expect(first.displayName).toBe("Org A");
    expect(second.displayName).toBe("Org B");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached profile for the same credential", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ok: true,
        user: {
          id: "U-cached",
          name: "same",
          profile: { display_name: "Same Org" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await getUserInfo(
      "primary",
      "U-cached",
      async () => "xoxb-same",
    );
    const second = await getUserInfo(
      "primary",
      "U-cached",
      async () => "xoxb-same",
    );

    expect(first.displayName).toBe("Same Org");
    expect(second.displayName).toBe("Same Org");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
