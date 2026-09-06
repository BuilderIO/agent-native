import { describe, expect, it } from "vitest";

import {
  flushDocumentPropertyWrites,
  trackDocumentPropertyWrite,
} from "./document-property-persistence";

describe("Page property persistence barrier", () => {
  it("waits only for the selected Page's writes", async () => {
    let finish!: () => void;
    const save = trackDocumentPropertyWrite(
      "a",
      "property",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let flushed = false;
    const flush = flushDocumentPropertyWrites("a").then(() => {
      flushed = true;
    });
    await flushDocumentPropertyWrites("b");
    expect(flushed).toBe(false);
    finish();
    await save;
    await flush;
    expect(flushed).toBe(true);
  });
  it("blocks navigation after a failure until that property saves successfully", async () => {
    await expect(
      trackDocumentPropertyWrite("retry", "p", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    await expect(flushDocumentPropertyWrites("retry")).rejects.toThrow(
      "offline",
    );
    await trackDocumentPropertyWrite("retry", "p", async () => undefined);
    await expect(flushDocumentPropertyWrites("retry")).resolves.toBeUndefined();
  });
  it("does not let an older completion clear a newer failed edit", async () => {
    let finish!: () => void;
    const older = trackDocumentPropertyWrite(
      "race",
      "p",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(
      trackDocumentPropertyWrite("race", "p", async () => {
        throw new Error("latest failed");
      }),
    ).rejects.toThrow();
    finish();
    await older;
    await expect(flushDocumentPropertyWrites("race")).rejects.toThrow(
      "latest failed",
    );
    await trackDocumentPropertyWrite("race", "p", async () => undefined);
  });
});
