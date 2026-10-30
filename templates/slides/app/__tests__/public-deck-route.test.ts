import { SSR_QUERY_CACHE_KEY_HEADER } from "@agent-native/core/shared";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configuredBasePath = vi.hoisted(() => ({ current: "" }));

vi.mock("@/pages/SharedPresentation", () => ({
  PresentationLinkDeck: () => null,
}));

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getConfiguredAppBasePath: () => configuredBasePath.current,
}));

import { buildDeckDiscovery, loader } from "../routes/p.$id";

function requestFor(id = "deck-1", token?: string) {
  const url = new URL(`https://slides.example.test/p/${id}`);
  if (token) url.searchParams.set("agent_access", token);
  return {
    params: { id },
    request: new Request(url),
  } as unknown as LoaderFunctionArgs;
}

describe("public deck route", () => {
  beforeEach(() => {
    configuredBasePath.current = "";
  });

  it("renders the same impersonal shell for every deck visibility", async () => {
    const result = await loader(requestFor());

    // oracle-change: /p/:id SSR is an impersonal shell; deck data and access now load client-side via get-presentation-deck (tested there).
    // No deck content and no access decision: the cached HTML must not go
    // stale when the deck is edited or its General access changes.
    expect(result).toEqual({
      id: "deck-1",
      basePath: "",
      agentAccessToken: null,
    });
  });

  it("prefixes agent-readable deck context URLs with the app base path", () => {
    const discovery = buildDeckDiscovery({
      id: "deck-1",
      title: "Launch review",
      basePath: "/slides",
    });

    expect(discovery.url).toBe("/slides/p/deck-1");
    expect(discovery.contextUrl).toBe(
      "/slides/api/deck-agent-context.json?id=deck-1",
    );
  });

  it("returns the configured app base path for deck discovery", async () => {
    configuredBasePath.current = "/slides";

    await expect(loader(requestFor())).resolves.toMatchObject({
      id: "deck-1",
      basePath: "/slides",
    });
  });

  it("keys an agent link's shell by its query without verifying the token", async () => {
    const result = (await loader(requestFor("deck-1", "tok+1"))) as unknown as {
      type: string;
      init: { headers: unknown };
      data: unknown;
    };

    expect(result.type).toBe("DataWithResponseInit");
    expect(result.init.headers).toEqual({
      "Referrer-Policy": "no-referrer",
      [SSR_QUERY_CACHE_KEY_HEADER]: "query",
    });
    expect(result.data).toEqual({
      id: "deck-1",
      basePath: "",
      agentAccessToken: "tok+1",
    });
  });
});
