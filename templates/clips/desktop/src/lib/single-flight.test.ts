import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  it("shares one pending operation across concurrent callers", async () => {
    let resolve!: (value: string) => void;
    const operation = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const run = singleFlight(operation);

    const first = run();
    const second = run();
    resolve("saved");

    await expect(first).resolves.toBe("saved");
    await expect(second).resolves.toBe("saved");
    expect(first).toBe(second);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("shares the original rejection", async () => {
    const error = new Error("upload failed");
    const operation = vi.fn(() => Promise.reject(error));
    const run = singleFlight(operation);

    const first = run();
    const second = run();

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
