import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

it("re-exports the settings shell through a Node ESM file path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const shellReexport = source.match(/export\s+\*\s+from\s+["']([^"']+)["'];/);
  expect(shellReexport?.[1]).toBe("./shell/index.js");

  const fixture = await mkdtemp(path.join(tmpdir(), "toolkit-settings-esm-"));
  try {
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await mkdir(path.join(fixture, "shell"));
    await writeFile(
      path.join(fixture, "shell", "index.js"),
      "export const marker = true;\n",
    );
    const entry = pathToFileURL(path.join(fixture, "index.mjs")).href;
    await writeFile(
      path.join(fixture, "index.mjs"),
      `export * from ${JSON.stringify(shellReexport?.[1])};\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { marker } = await import(${JSON.stringify(entry)}); if (!marker) process.exitCode = 1;`,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
