import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import {
  listEnvironmentPackages,
  resolveLockPath,
} from "./environment-packages.js";

it("lists the locked versions of bundled packages and their dependencies in name order", async () => {
  const lock = JSON.stringify({
    info: { version: "314.0.7" },
    packages: {
      zeta: { version: "2.0.0", depends: [] },
      alpha: { version: "1.2.3", depends: ["zeta"] },
      "alpha-tests": { version: "1.2.3", depends: ["alpha"] },
      pandas: { version: "3.0.2", depends: ["alpha"] },
      pyarrow: { version: "22.0.0", depends: ["pandas", "alpha"] },
    },
  });
  const report = await listEnvironmentPackages(
    async () => lock,
    new URL("file:///fixture/pyodide-lock.json"),
  );
  expect(report.runtime).toBe("Pyodide");
  expect(report.runtimeVersion).toBe("314.0.7");
  expect(report.packages).toEqual([
    { name: "alpha", version: "1.2.3" },
    { name: "pandas", version: "3.0.2" },
    { name: "pyarrow", version: "22.0.0" },
    { name: "zeta", version: "2.0.0" },
  ]);
});

it("reports only packages installed by the browser notebook kernel", async () => {
  const lock = new URL(
    "./pyodide-lock.json",
    import.meta.resolve("pyodide/package.json"),
  );
  const report = await listEnvironmentPackages(undefined, lock);
  expect(report.runtimeVersion).toBe("3.14.2");
  expect(report.packages.map(({ name }) => name)).toEqual([
    "numpy",
    "pandas",
    "pyarrow",
    "pyodide-unix-timezones",
    "python-dateutil",
    "pytz",
    "six",
  ]);
});

// A deployed server has no `server/` directory: the app build copies the
// formatter assets beside the server entry, so the panel has to find the lock
// in the copied directory. Answering 500 there was the served failure.
it("finds the runtime lock beside the bundled server entry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "analytics-2-env-"));
  try {
    const entry = path.join(root, "_chunks");
    await mkdir(entry, { recursive: true });
    const lock = path.join(root, "formatter-assets", "runtime", "pyodide");
    await mkdir(lock, { recursive: true });
    const lockFile = path.join(lock, "pyodide-lock.json");
    await writeFile(
      lockFile,
      JSON.stringify({
        info: { python: "3.14.2" },
        packages: {
          pandas: { version: "3.0.2", depends: [] },
          pyarrow: { version: "22.0.0", depends: ["pandas"] },
        },
      }),
    );
    const resolved = resolveLockPath(
      pathToFileURL(path.join(entry, "server.mjs")).href,
    );
    expect(fileURLToPath(resolved)).toBe(lockFile);
    const report = await listEnvironmentPackages(undefined, resolved);
    expect(report.runtimeVersion).toBe("3.14.2");
    expect(report.packages).toEqual([
      { name: "pandas", version: "3.0.2" },
      { name: "pyarrow", version: "22.0.0" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Absence is a named error, not an empty package list a reader would read as
// "your runtime has no packages".
it("names the missing lock instead of reporting zero packages", () => {
  expect(() =>
    resolveLockPath(
      pathToFileURL(path.join(tmpdir(), "no-such-app", "index.mjs")).href,
    ),
  ).toThrow(/package lock is missing/);
});
