import { describe, expect, it, vi } from "vitest";

import { withMigrationRuntime } from "../db/migration-runtime.js";
import {
  frameworkSchemaEnsureNames,
  runFrameworkSchemaEnsures as runUnwrapped,
} from "./release-schema.js";

const runFrameworkSchemaEnsures = (...args: Parameters<typeof runUnwrapped>) =>
  withMigrationRuntime(() => runUnwrapped(...args));

describe("frameworkSchemaEnsureNames", () => {
  it.each(["settings", "application_state", "app_secrets", "resources"])(
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
  it("refuses to run without migration duty", async () => {
    const run = vi.fn(async () => {});

    await expect(runUnwrapped([["settings", run]])).rejects.toThrow(
      /withMigrationRuntime/,
    );
    expect(run).not.toHaveBeenCalled();
  });

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
