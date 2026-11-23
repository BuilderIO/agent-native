import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyFormatterAssets,
  resolveAssetDestination,
  resolvePreset,
  verifyCopiedAssets,
} from "./copy-assets-to-build.js";

const temporaryRoots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeAppRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "formatter-packaging-"));
  temporaryRoots.push(root);
  return root;
}

async function writeSourceFixture(appRoot: string): Promise<void> {
  const source = path.join(appRoot, "server", "assets", "formatter");
  const payload = Buffer.from("select 1\n");
  await mkdir(path.join(source, "runtime"), { recursive: true });
  await writeFile(path.join(source, "runtime", "data.bin"), payload);
  await writeFile(path.join(source, "child.mjs"), "// fixture child\n");
  const files = [
    {
      path: "runtime/data.bin",
      size: payload.byteLength,
      sha256: sha256(payload),
    },
  ];
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({ files }, null, 2),
  );
}

async function makeServerOutput(
  appRoot: string,
  relative: string,
): Promise<string> {
  const serverRoot = path.join(appRoot, relative);
  await mkdir(serverRoot, { recursive: true });
  await writeFile(path.join(serverRoot, "main.mjs"), "// nitro entry\n");
  return serverRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("formatter asset packaging", () => {
  it("defaults to the node-server preset", () => {
    expect(resolvePreset(undefined)).toBe("node-server");
    expect(resolvePreset("  NETLIFY ")).toBe("netlify");
  });

  it("targets the Netlify function server directory", () => {
    expect(
      path.relative(
        "/app",
        resolveAssetDestination("/app", "netlify").replace(/\\/g, "/"),
      ),
    ).toBe(".netlify/functions-internal/server/formatter-assets");
  });

  it("targets the node server directory", () => {
    expect(
      path.relative(
        "/app",
        resolveAssetDestination("/app", "node-server").replace(/\\/g, "/"),
      ),
    ).toBe(".output/server/formatter-assets");
  });

  it("copies and verifies assets into the actual Netlify function layout", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    const serverRoot = await makeServerOutput(
      appRoot,
      ".netlify/functions-internal/server",
    );

    const result = await copyFormatterAssets(appRoot, "netlify");

    expect(result.preset).toBe("netlify");
    expect(result.destination).toBe(path.join(serverRoot, "formatter-assets"));
    expect(result.files).toBe(1);
    await expect(
      readFile(path.join(result.destination, "runtime", "data.bin"), "utf8"),
    ).resolves.toBe("select 1\n");
  });

  it("copies and verifies assets into every deployable Netlify runtime target", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    const main = await makeServerOutput(
      appRoot,
      ".netlify/functions-internal/server",
    );
    const background = await makeServerOutput(
      appRoot,
      ".netlify/functions-internal/server-agent-background",
    );
    const scheduled = path.join(
      appRoot,
      ".netlify/functions-internal/agent-native-recurring-jobs",
    );
    await mkdir(scheduled, { recursive: true });
    await writeFile(
      path.join(scheduled, "agent-native-recurring-jobs.mjs"),
      "// scheduled trigger, not a server bundle\n",
    );

    const result = await copyFormatterAssets(appRoot, "netlify");

    expect(result.destination).toBe(path.join(main, "formatter-assets"));
    expect(result.destinations).toEqual([
      path.join(main, "formatter-assets"),
      path.join(background, "formatter-assets"),
    ]);
    const source = path.join(appRoot, "server", "assets", "formatter");
    for (const destination of result.destinations) {
      await expect(
        readFile(path.join(destination, "runtime", "data.bin"), "utf8"),
      ).resolves.toBe("select 1\n");
      await expect(verifyCopiedAssets(source, destination)).resolves.toBe(1);
    }
    await expect(
      lstat(path.join(scheduled, "formatter-assets")),
    ).rejects.toThrow(/ENOENT/);
  });

  it("refuses to replace a symlinked destination and leaves its target intact", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    const serverRoot = await makeServerOutput(appRoot, ".output/server");
    const outside = await makeAppRoot();
    const sentinel = path.join(outside, "sentinel.txt");
    await writeFile(sentinel, "keep\n");
    await symlink(outside, path.join(serverRoot, "formatter-assets"));

    await expect(copyFormatterAssets(appRoot, "node-server")).rejects.toThrow(
      /Refusing to replace non-directory formatter asset destination/,
    );
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("refuses a server root that escapes the app root through a symlink", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    const outside = await makeAppRoot();
    const outsideServer = path.join(outside, "server");
    await mkdir(outsideServer, { recursive: true });
    await writeFile(path.join(outsideServer, "main.mjs"), "// nitro entry\n");
    await symlink(outside, path.join(appRoot, ".output"));

    await expect(copyFormatterAssets(appRoot, "node-server")).rejects.toThrow(
      /Refusing to write formatter assets outside the app root/,
    );
  });

  it("copies and verifies assets into the node server layout", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    await makeServerOutput(appRoot, ".output/server");

    const result = await copyFormatterAssets(appRoot, "node-server");

    expect(result.destination).toBe(
      path.join(appRoot, ".output", "server", "formatter-assets"),
    );
    await expect(
      readFile(path.join(result.destination, "child.mjs"), "utf8"),
    ).resolves.toContain("fixture child");
  });

  it("preserves an in-app research tree reached through an output symlink", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    const research = path.join(appRoot, "research");
    const assets = path.join(research, "server", "formatter-assets");
    await mkdir(assets, { recursive: true });
    const sentinel = path.join(assets, "sentinel.txt");
    await writeFile(sentinel, "keep\n");
    await symlink(research, path.join(appRoot, ".output"));

    await expect(copyFormatterAssets(appRoot, "node-server")).rejects.toThrow(
      /Refusing to follow a formatter output symlink/,
    );
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("fails explicitly when the preset server output is missing", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);

    await expect(copyFormatterAssets(appRoot, "netlify")).rejects.toThrow(
      /Nitro server output for preset "netlify" is missing at \.netlify\/functions-internal\/server/,
    );
  });

  it("fails explicitly for an unsupported preset instead of guessing a path", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);

    await expect(
      copyFormatterAssets(appRoot, "cloudflare_module"),
    ).rejects.toThrow(/Unsupported Nitro preset for formatter assets/);
  });

  it("fails when generated assets were never built", async () => {
    const appRoot = await makeAppRoot();
    await makeServerOutput(appRoot, ".output/server");

    await expect(copyFormatterAssets(appRoot, "node-server")).rejects.toThrow(
      /Run `pnpm formatter:assets` before building\./,
    );
  });

  it("rejects a partial copy during verification", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    await makeServerOutput(appRoot, ".output/server");
    const result = await copyFormatterAssets(appRoot, "node-server");
    await rm(path.join(result.destination, "runtime", "data.bin"));

    await expect(
      verifyCopiedAssets(
        path.join(appRoot, "server", "assets", "formatter"),
        result.destination,
      ),
    ).rejects.toThrow(/do not match the generated file set/);
  });

  it("rejects a corrupted copy during verification", async () => {
    const appRoot = await makeAppRoot();
    await writeSourceFixture(appRoot);
    await makeServerOutput(appRoot, ".output/server");
    const result = await copyFormatterAssets(appRoot, "node-server");
    await writeFile(
      path.join(result.destination, "runtime", "data.bin"),
      "select 2\n",
    );

    await expect(
      verifyCopiedAssets(
        path.join(appRoot, "server", "assets", "formatter"),
        result.destination,
      ),
    ).rejects.toThrow(/integrity mismatch: runtime\/data\.bin/);
  });

  it("keeps the copied directory reachable from the compiled resolver candidates", async () => {
    for (const preset of ["netlify", "node-server"]) {
      const destination = resolveAssetDestination("/app", preset);
      const serverRoot = path.dirname(destination);

      // Bundled flat chunk: moduleDir = <serverRoot>/_chunks.
      expect(
        path.resolve(path.join(serverRoot, "_chunks"), "../formatter-assets"),
      ).toBe(destination);
      // Entry module bundled at <serverRoot>/main.mjs.
      expect(path.resolve(serverRoot, "formatter-assets")).toBe(destination);
    }
  });
});
