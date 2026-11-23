import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  listEnvironmentPackages,
  lockCandidates,
  resolveLockPath,
} from "./environment-packages.js";

/**
 * Row 432: the Environment panel answered 500 on Labs while the package lock was
 * in the build. The resolver only tried paths relative to the module, so a
 * preset that puts the assets elsewhere lost them. These rules pin the search:
 * the lock is found beside the module, in a chunk's parent, or under the process
 * working directory, and a genuine miss names every path it tried.
 */
describe("python runtime package lock resolution", () => {
  it("finds the lock beside a bundled module", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "env-lock-"));
    const server = path.join(root, "server");
    await mkdir(path.join(server, "formatter-assets", "runtime", "pyodide"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        server,
        "formatter-assets",
        "runtime",
        "pyodide",
        "pyodide-lock.json",
      ),
      JSON.stringify({
        info: { version: "3.12.1" },
        packages: {
          numpy: { version: "2.0.1", depends: [] },
          pandas: { version: "3.0.2", depends: ["numpy"] },
          pyarrow: { version: "22.0.0", depends: ["pandas"] },
        },
      }),
    );
    const found = resolveLockPath(`file://${server}/index.mjs`, undefined);
    expect(
      found.pathname.endsWith(
        "formatter-assets/runtime/pyodide/pyodide-lock.json",
      ),
    ).toBe(true);
    await expect(
      listEnvironmentPackages(undefined, found),
    ).resolves.toMatchObject({
      runtime: "Pyodide",
      runtimeVersion: "3.12.1",
      packages: [
        { name: "numpy", version: "2.0.1" },
        { name: "pandas", version: "3.0.2" },
        { name: "pyarrow", version: "22.0.0" },
      ],
    });
  });

  it("finds the lock under the process working directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "env-cwd-"));
    await mkdir(path.join(root, "formatter-assets", "runtime", "pyodide"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        root,
        "formatter-assets",
        "runtime",
        "pyodide",
        "pyodide-lock.json",
      ),
      JSON.stringify({ info: { python: "3.12.1" }, packages: {} }),
    );
    // the module lives in a function directory with no assets beside it
    const found = resolveLockPath(
      `file://${root}/functions/server/index.mjs`,
      root,
    );
    expect(found.pathname).toBe(
      path.join(
        root,
        "formatter-assets",
        "runtime",
        "pyodide",
        "pyodide-lock.json",
      ),
    );
  });

  it("names the module directory and every path it tried when the lock is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "env-missing-"));
    const candidates = lockCandidates(`file://${root}/server/index.mjs`, root);
    expect(candidates.length).toBeGreaterThan(5);
    expect(() =>
      resolveLockPath(`file://${root}/server/index.mjs`, root),
    ).toThrow(/package lock is missing .*from .*looked in .*formatter-assets/);
  });
});
