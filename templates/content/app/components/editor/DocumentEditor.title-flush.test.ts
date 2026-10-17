import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import type { Document } from "@shared/api";

import { answerFlushRequest, flushTitleOnly } from "./DocumentEditor";

function flushes() {
  return {
    document: vi.fn(async () => {}),
    property: vi.fn(async (_propertyId: string) => {}),
    title: vi.fn(async () => ({ status: "success" as const, saved: true })),
  };
}

const savedDocument = {
  id: "doc-1",
  title: "Renamed",
  updatedAt: "2026-10-17T00:00:01.000Z",
} as Document;

describe("an agent's flush request", () => {
  it.each([
    ["a scope the editor does not know", { scope: "body" }],
    ["a scope in another case", { scope: "TITLE" }],
    ["a scope that is not a string", { scope: 3 }],
    ["a null scope", { scope: null }],
    ["the title scope with a field", { scope: "title", propertyId: "p-1" }],
  ])("refuses %s and never runs a whole flush", async (_name, request) => {
    const flush = flushes();

    await expect(answerFlushRequest(request, flush, "failed")).resolves.toEqual(
      {
        status: "error",
        scope: request.scope,
        code: "unsupported_scope",
      },
    );
    expect(flush.document).not.toHaveBeenCalled();
    expect(flush.property).not.toHaveBeenCalled();
    expect(flush.title).not.toHaveBeenCalled();
  });

  it("saves only the title for a title request", async () => {
    const flush = flushes();

    await expect(
      answerFlushRequest({ scope: "title" }, flush, "failed"),
    ).resolves.toEqual({ scope: "title", status: "success", saved: true });
    expect(flush.title).toHaveBeenCalledOnce();
    expect(flush.document).not.toHaveBeenCalled();
  });

  it("passes a title save's failure on with its code", async () => {
    const flush = flushes();
    flush.title.mockResolvedValueOnce({
      status: "error",
      code: "title_conflict",
    } as never);

    await expect(
      answerFlushRequest({ scope: "title" }, flush, "failed"),
    ).resolves.toEqual({
      scope: "title",
      status: "error",
      code: "title_conflict",
    });
  });

  it("runs the whole flush for a request that names no scope, as before", async () => {
    const flush = flushes();

    await expect(answerFlushRequest({}, flush, "failed")).resolves.toEqual({
      status: "success",
    });
    expect(flush.document).toHaveBeenCalledOnce();

    flush.document.mockRejectedValueOnce(new Error("body not acknowledged"));
    await expect(answerFlushRequest({}, flush, "failed")).resolves.toEqual({
      status: "error",
      error: "body not acknowledged",
    });

    await answerFlushRequest({ propertyId: "p-1" }, flush, "failed");
    expect(flush.property).toHaveBeenCalledWith("p-1");
    expect(flush.document).toHaveBeenCalledTimes(2);
  });
});

describe("saving the title alone for an agent", () => {
  it("sends the latest title against the one it last saved, after saves on their way settle", async () => {
    const order: string[] = [];
    let title = "Draft";
    let settle!: () => void;
    const save = vi.fn(async (sent: string, base: string) => {
      order.push(`save ${sent} over ${base}`);
      return savedDocument;
    });
    const adopt = vi.fn();

    const answer = flushTitleOnly({
      settleSavesInFlight: () =>
        new Promise<void>((resolve) => {
          settle = () => {
            order.push("settled");
            resolve();
          };
        }),
      titles: () => ({
        title,
        lastSavedTitle: "Original",
        documentTitle: "Original",
      }),
      save,
      adopt,
    });
    title = "Renamed";
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    settle();

    await expect(answer).resolves.toEqual({ status: "success", saved: true });
    expect(order).toEqual(["settled", "save Renamed over Original"]);
    expect(adopt).toHaveBeenCalledWith(savedDocument, "Renamed");
  });

  it("answers without a save when the title is already saved", async () => {
    const save = vi.fn();

    await expect(
      flushTitleOnly({
        settleSavesInFlight: async () => {},
        titles: () => ({
          title: "Same",
          lastSavedTitle: "Same",
          documentTitle: "Same",
        }),
        save,
        adopt: vi.fn(),
      }),
    ).resolves.toEqual({ status: "success", saved: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses to send over a title another writer renamed", async () => {
    const save = vi.fn();

    await expect(
      flushTitleOnly({
        settleSavesInFlight: async () => {},
        titles: () => ({
          title: "Mine",
          lastSavedTitle: "Original",
          documentTitle: "Theirs",
        }),
        save,
        adopt: vi.fn(),
      }),
    ).resolves.toEqual({ status: "error", code: "title_conflict" });
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ["a conflict", { conflict: true }],
    ["a superseded save", { superseded: true }],
    ["a save the page kept in History", { preservationRequired: true }],
  ])("reports %s as a title conflict", async (_name, result) => {
    const adopt = vi.fn();

    await expect(
      flushTitleOnly({
        settleSavesInFlight: async () => {},
        titles: () => ({
          title: "Mine",
          lastSavedTitle: "Original",
          documentTitle: "Original",
        }),
        save: async () => result as never,
        adopt,
      }),
    ).resolves.toEqual({ status: "error", code: "title_conflict" });
    expect(adopt).not.toHaveBeenCalled();
  });

  it("reports a save that failed with its message", async () => {
    await expect(
      flushTitleOnly({
        settleSavesInFlight: async () => {},
        titles: () => ({
          title: "Mine",
          lastSavedTitle: "Original",
          documentTitle: "Original",
        }),
        save: async () => {
          throw new Error("network down");
        },
        adopt: vi.fn(),
      }),
    ).resolves.toEqual({
      status: "error",
      code: "title_save_failed",
      error: "network down",
    });
  });
});
