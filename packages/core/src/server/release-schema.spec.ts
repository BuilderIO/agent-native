import { describe, expect, it, vi } from "vitest";

import {
  frameworkSchemaEnsureNames,
  runFrameworkSchemaEnsures,
} from "./release-schema.js";

describe("frameworkSchemaEnsureNames", () => {
  it.each(["Settings", "ApplicationState", "AppSecrets", "Resources"])(
    "covers %s, which a request path can never create in production",
    (name) => {
      expect(frameworkSchemaEnsureNames()).toContain(name);
    },
  );

  it("lists every store exactly once", () => {
    const names = frameworkSchemaEnsureNames();

    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("runFrameworkSchemaEnsures", () => {
  it("runs sequentially, in list order", async () => {
    const order: string[] = [];
    const record = (name: string) => async () => {
      order.push(`${name}:start`);
      await Promise.resolve();
      order.push(`${name}:end`);
    };

    await runFrameworkSchemaEnsures([
      ["First", record("First")],
      ["Second", record("Second")],
    ]);

    expect(order).toEqual([
      "First:start",
      "First:end",
      "Second:start",
      "Second:end",
    ]);
  });

  it("aborts on the first failure and names the store", async () => {
    const after = vi.fn(async () => {});

    await expect(
      runFrameworkSchemaEnsures([
        [
          "Settings",
          async () => {
            throw new Error("permission denied for schema public");
          },
        ],
        ["ApplicationState", after],
      ]),
    ).rejects.toThrow(/Settings.*permission denied/);

    expect(after).not.toHaveBeenCalled();
  });

  it("keeps the original error as the cause", async () => {
    const original = new Error("lock timeout");

    await expect(
      runFrameworkSchemaEnsures([
        [
          "Resources",
          async () => {
            throw original;
          },
        ],
      ]),
    ).rejects.toMatchObject({ cause: original });
  });
});
