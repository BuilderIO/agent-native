import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMigrationAuthorizedRuntime,
  withMigrationRuntime,
} from "./migration-runtime.js";

describe("withMigrationRuntime timing logs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs ready and finished once for the outermost call", async () => {
    vi.stubEnv("VITEST", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await withMigrationRuntime(async () => {
      await withMigrationRuntime(async () => {
        expect(isMigrationAuthorizedRuntime()).toBe(true);
      });
    });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(
      lines.filter((line) => line.startsWith("[db] Migration runtime ready")),
    ).toHaveLength(1);
    expect(
      lines.filter((line) =>
        /^\[db\] Release migrations finished in \d+ms$/.test(line),
      ),
    ).toHaveLength(1);
    expect(isMigrationAuthorizedRuntime()).toBe(false);
  });

  it("stays quiet under vitest", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await withMigrationRuntime(async () => {});

    expect(log).not.toHaveBeenCalled();
  });
});
