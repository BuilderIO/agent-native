import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callAction,
  serializeActionQueryParams,
  shouldRetryActionQueryForError,
} from "./use-action.js";

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

describe("shouldRetryActionQueryForError", () => {
  it("does not retry browser resource-exhaustion failures", () => {
    expect(
      shouldRetryActionQueryForError(
        0,
        new Error(
          "Action list-documents failed: net::ERR_INSUFFICIENT_RESOURCES",
        ),
      ),
    ).toBe(false);
  });

  it("allows a single retry for network-level failures (Chrome reports pool exhaustion as a generic fetch failure)", () => {
    const networkError = new Error(
      "Action list-documents failed: Failed to fetch",
    );
    expect(shouldRetryActionQueryForError(0, networkError)).toBe(true);
    expect(shouldRetryActionQueryForError(1, networkError)).toBe(false);
  });

  it("keeps three retries for HTTP errors that reached the server", () => {
    const httpError = Object.assign(
      new Error("Action list-documents failed: HTTP 500"),
      { status: 500 },
    );
    expect(shouldRetryActionQueryForError(2, httpError)).toBe(true);
    expect(shouldRetryActionQueryForError(3, httpError)).toBe(false);
  });

  it("does not retry auth failures", () => {
    expect(shouldRetryActionQueryForError(0, { status: 401 })).toBe(false);
    expect(shouldRetryActionQueryForError(0, { status: 403 })).toBe(false);
  });
});
