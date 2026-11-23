import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { z } from "zod";

import { collectBrowserNotebookPackages } from "../../shared/notebook-browser-packages.js";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const formatter = path.join(appRoot, "server/assets/formatter");
const output = path.join(appRoot, "public/offline-kernel");
const staging = path.join(appRoot, ".tmp/offline-kernel");
const duckdbVersion = "1.33.1-dev57.0";
const maxBytes = 96 * 1024 * 1024;

const manifestSchema = z.object({
  pyodideVersion: z.string(),
  files: z.array(
    z.object({ path: z.string(), sha256: z.string(), size: z.number() }),
  ),
});
const lockSchema = z.object({
  packages: z.record(
    z.string(),
    z.object({
      file_name: z.string(),
      sha256: z.string(),
      depends: z.array(z.string()),
    }),
  ),
});

async function download(
  url: string,
  sha: string,
  algorithm: "sha256" | "sha512",
) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`Could not download ${url}`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maxBytes)
      throw new Error(`Asset exceeded its byte limit: ${url}`);
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const encoding = algorithm === "sha256" ? "hex" : "base64";
  if (createHash(algorithm).update(data).digest(encoding) !== sha)
    throw new Error(`Invalid asset hash: ${url}`);
  return data;
}

async function main() {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(formatter, "manifest.json"), "utf8")),
  );
  const runtime = "runtime/pyodide/";
  const pyodide = path.join(staging, "pyodide");
  const duckdb = path.join(staging, "duckdb");
  await rm(staging, { recursive: true, force: true });
  try {
    await Promise.all([
      mkdir(pyodide, { recursive: true }),
      mkdir(duckdb, { recursive: true }),
    ]);
    for (const file of manifest.files.filter((file) =>
      file.path.startsWith(runtime),
    )) {
      const name = file.path.slice(runtime.length);
      if (path.basename(name) !== name)
        throw new Error("Invalid formatter manifest path");
      const bytes = await readFile(path.join(formatter, file.path));
      if (
        bytes.byteLength !== file.size ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256
      )
        throw new Error(`Invalid formatter asset: ${name}`);
      await writeFile(path.join(pyodide, name), bytes);
    }
    const lock = lockSchema.parse(
      JSON.parse(
        await readFile(path.join(pyodide, "pyodide-lock.json"), "utf8"),
      ),
    );
    const wheels = collectBrowserNotebookPackages(lock.packages);
    for (const wheel of wheels.values()) {
      const url = `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodideVersion}/full/${wheel.file_name}`;
      await writeFile(
        path.join(pyodide, wheel.file_name),
        await download(url, wheel.sha256, "sha256"),
      );
    }
    const duckdbAssets = {
      "duckdb-browser-blocking.mjs":
        "qQLzoiJxAFNoKwLKJfVygLbn6in6R6IewobJnJ1E0c9K54uWgVxK3gJ4CaTIpex2rHDuL1Cmn4oAU1VIsJsg6A==",
      "duckdb-mvp.wasm":
        "kEZRyQx7nS1nlVW+PpEMgm4LfOm/H0j7ssfyioIP9FZ9aRVXNw6u3VPZIYsT+jO4lg9TNUN1bc9AjUsLNKV0vA==",
    };
    for (const [name, sha] of Object.entries(duckdbAssets)) {
      const url = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${duckdbVersion}/dist/${name}`;
      await writeFile(
        path.join(duckdb, name),
        await download(url, sha, "sha512"),
      );
    }
    const compiled = path.join(staging, "compiled");
    await build({
      root: appRoot,
      configFile: false,
      publicDir: false,
      build: {
        lib: {
          entry: path.join(duckdb, "duckdb-browser-blocking.mjs"),
          formats: ["es"],
          fileName: () => "duckdb.mjs",
        },
        outDir: compiled,
      },
    });
    await cp(
      path.join(duckdb, "duckdb-mvp.wasm"),
      path.join(compiled, "duckdb-mvp.wasm"),
    );
    const fixtureDir = path.join(appRoot, ".tmp/k0-duckdb");
    const nodeModule = "duckdb-node-blocking.cjs";
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      path.join(fixtureDir, nodeModule),
      await download(
        `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${duckdbVersion}/dist/${nodeModule}`,
        "FqASrBmxM5SJk7tEmx6F/FzbreFyIvXqYZtPDvhYk3b7m7Tsj+3DgeR27kLgw8qxvCl8wyIY4PX16WK/PnveNg==",
        "sha512",
      ),
    );
    await cp(
      path.join(duckdb, "duckdb-mvp.wasm"),
      path.join(fixtureDir, "duckdb-mvp.wasm"),
    );
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await cp(pyodide, path.join(output, "pyodide"), { recursive: true });
    await cp(path.join(formatter, "licenses"), path.join(output, "licenses"), {
      recursive: true,
    });
    await cp(compiled, path.join(output, "duckdb"), { recursive: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await main();
