import { afterEach, describe, expect, it, vi } from "vitest";
import { callAction, serializeActionQueryParams } from "./use-action.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serializeActionQueryParams", () => {
  it("serializes array GET params with bracket keys so single values stay arrays", () => {
    const query = serializeActionQueryParams({
      libraryId: "lib-1",
      candidateRunIds: ["run-1", "run-2"],
      empty: undefined,
      none: null,
    });

    const params = new URLSearchParams(query);
    expect(params.get("libraryId")).toBe("lib-1");
    expect(params.getAll("candidateRunIds[]")).toEqual(["run-1", "run-2"]);
    expect(params.has("empty")).toBe(false);
    expect(params.has("none")).toBe(false);
  });
});

describe("callAction", () => {
  it("calls mutating actions through the framework action transport", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, id: "meal-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAction("log-meal", { name: "Salad" })).resolves.toEqual({
      ok: true,
      id: "meal-1",
    });

    expect(fetchMock).toHaveBeenCalledWith("/_agent-native/actions/log-meal", {
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
      }),
      cache: "no-store",
      body: JSON.stringify({ name: "Salad" }),
    });
  });

  it("serializes GET params for imperative reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: "meal-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("list-meals", { tags: ["lunch", "fresh"] }, { method: "GET" }),
    ).resolves.toEqual([{ id: "meal-1" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/list-meals?tags%5B%5D=lunch&tags%5B%5D=fresh",
      {
        method: "GET",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        cache: "no-store",
      },
    );
  });
});
