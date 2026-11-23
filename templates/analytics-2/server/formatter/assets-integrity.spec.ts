import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/formatter",
);
const childSource = path.join(assetsDir, "child.mjs");
const temporaryRoots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ManifestEntry = { path: string; size: number; sha256: string };

async function makeFixture(
  entries: ManifestEntry[],
  extras: Array<{ path: string; content: string }> = [],
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "formatter-integrity-"));
  temporaryRoots.push(root);
  await copyFile(childSource, path.join(root, "child.mjs"));
  for (const extra of extras) {
    const target = path.join(root, extra.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, extra.content);
  }
  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify({ files: entries }, null, 2),
  );
  return root;
}

async function validChildEntry(): Promise<ManifestEntry> {
  const bytes = await readFile(childSource);
  return {
    path: "child.mjs",
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function runChild(root: string): {
  valid: boolean;
  error?: { code?: string; message?: string };
} {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "child.mjs"), root, "--once"],
    {
      input: JSON.stringify({
        type: "validate",
        config: "[sqlfluff]\ntemplater = raw\n",
      }),
      encoding: "utf8",
      env: {},
      timeout: 20_000,
    },
  );
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim()) as {
    valid: boolean;
    error?: { code?: string; message?: string };
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("formatter asset integrity", () => {
  it("rejects a tampered manifest-listed file", async () => {
    const entry = await validChildEntry();
    const root = await makeFixture([{ ...entry, sha256: "f".repeat(64) }]);

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.code).toBe("runtime_error");
    expect(response.error?.message).toBe(
      "Bundled formatter asset integrity mismatch: child.mjs",
    );
  });

  it("rejects an unlisted extra wheel instead of installing it", async () => {
    const root = await makeFixture(
      [await validChildEntry()],
      [
        {
          path: "runtime/wheels/zzzextra-1.0-py3-none-any.whl",
          content: "PK\u0003\u0004not-a-real-wheel",
        },
      ],
    );

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.message).toBe(
      "Unlisted bundled formatter asset: runtime/wheels/zzzextra-1.0-py3-none-any.whl",
    );
  });

  it("rejects a parent-directory manifest path", async () => {
    const root = await makeFixture([
      { path: "../escape.txt", size: 1, sha256: "0".repeat(64) },
    ]);

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.message).toContain(
      "Invalid bundled formatter asset path: ../escape.txt",
    );
  });

  it("rejects an absolute manifest path", async () => {
    const root = await makeFixture([
      { path: "/tmp/escape.txt", size: 1, sha256: "0".repeat(64) },
    ]);

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.message).toContain(
      "Invalid bundled formatter asset path: /tmp/escape.txt",
    );
  });

  it("rejects duplicate manifest entries", async () => {
    const entry = await validChildEntry();
    const root = await makeFixture([entry, entry]);

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.message).toBe(
      "Duplicate bundled formatter asset entry: child.mjs",
    );
  });

  it("rejects a missing manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "formatter-integrity-"));
    temporaryRoots.push(root);
    await copyFile(childSource, path.join(root, "child.mjs"));

    const response = runChild(root);

    expect(response.valid).toBe(false);
    expect(response.error?.message).toBe(
      "SQLFluff formatter manifest is missing.",
    );
  });

  it("keeps the generated asset directory closed under its own manifest", async () => {
    // The real manifest must list every generated file except manifest.json.
    const manifest = JSON.parse(
      await readFile(path.join(assetsDir, "manifest.json"), "utf8"),
    ) as { files: ManifestEntry[] };
    const listed = new Set(manifest.files.map((file) => file.path));
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(
      manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)),
    ).toBe(true);
    expect(manifest.files.every((file) => !path.isAbsolute(file.path))).toBe(
      true,
    );
    expect(manifest.files.every((file) => !file.path.includes(".."))).toBe(
      true,
    );
    expect(listed.has("manifest.json")).toBe(false);
    expect(listed.has("child.mjs")).toBe(true);
    expect(listed.has("licenses/cpython/LICENSE")).toBe(true);
    expect(listed.has("licenses/pyodide/THIRD-PARTY-NOTICES.md")).toBe(true);
  });
});
