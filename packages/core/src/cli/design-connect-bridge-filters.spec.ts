import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isIgnoredByGitignore,
  parseGitignore,
  prepareDesignConnectManifest,
  shouldExcludeFromListing,
  startDesignConnectBridge,
} from "./design-connect.js";

/**
 * Focused tests for the /list-files ignore/secret-path filter logic and the
 * bridge's new list-files endpoint + hardened extension/secret blocklists.
 * Bridge lifecycle helpers mirror design-connect.spec.ts.
 */

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-design-cli-list-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.once("error", reject);
  });
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as Record<string, unknown>,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

describe("parseGitignore + isIgnoredByGitignore", () => {
  it("matches exact names, dir/, and *.ext patterns", () => {
    const rules = parseGitignore(
      ["# comment", "", "*.log", "dist/", "notes.txt", "/root-only.txt"].join(
        "\n",
      ),
    );
    expect(isIgnoredByGitignore(rules, "debug.log", false)).toBe(true);
    expect(isIgnoredByGitignore(rules, "nested/debug.log", false)).toBe(true);
    expect(isIgnoredByGitignore(rules, "dist", true)).toBe(true);
    expect(isIgnoredByGitignore(rules, "dist", false)).toBe(false);
    expect(isIgnoredByGitignore(rules, "notes.txt", false)).toBe(true);
    expect(isIgnoredByGitignore(rules, "root-only.txt", false)).toBe(true);
    expect(isIgnoredByGitignore(rules, "nested/root-only.txt", false)).toBe(
      false,
    );
    expect(isIgnoredByGitignore(rules, "keep.ts", false)).toBe(false);
  });

  it("ignores comment and blank lines and negation patterns", () => {
    const rules = parseGitignore("# comment\n\n!kept.log\n*.log\n");
    // Negation is unsupported in this subset — only the plain *.log rule is kept.
    expect(rules).toEqual([
      { pattern: "*.log", anchored: false, dirOnly: false },
    ]);
  });
});

describe("shouldExcludeFromListing", () => {
  const emptyGitignore = parseGitignore("");

  it("always excludes .git, node_modules, dist, build, and framework output dirs", () => {
    for (const dir of [
      ".git",
      "node_modules",
      "dist",
      "build",
      ".next",
      ".output",
      ".nuxt",
      "coverage",
      ".cache",
    ]) {
      expect(
        shouldExcludeFromListing(`${dir}/nested/file.ts`, {
          gitignore: emptyGitignore,
        }),
      ).toBe(true);
    }
  });

  it("always excludes .DS_Store", () => {
    expect(
      shouldExcludeFromListing(".DS_Store", { gitignore: emptyGitignore }),
    ).toBe(true);
  });

  it("blocks secret-looking paths regardless of gitignore", () => {
    expect(
      shouldExcludeFromListing(".env", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing(".env.local", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("server/secrets.pem", {
        gitignore: emptyGitignore,
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("keys/private.key", {
        gitignore: emptyGitignore,
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("home/id_rsa", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing(".git/HEAD", { gitignore: emptyGitignore }),
    ).toBe(true);
  });

  it("blocks uppercase/mixed-case variants of secret-looking paths", () => {
    // macOS's default filesystem (and Windows) is case-insensitive, so these
    // must be blocked identically to their lowercase form.
    expect(
      shouldExcludeFromListing(".ENV", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing(".Env.Local", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("server/SECRETS.PEM", {
        gitignore: emptyGitignore,
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("keys/Private.KEY", {
        gitignore: emptyGitignore,
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("home/ID_RSA", { gitignore: emptyGitignore }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing(".GIT/HEAD", { gitignore: emptyGitignore }),
    ).toBe(true);
  });

  it("allows other dotfiles like .gitignore and .prettierrc", () => {
    expect(
      shouldExcludeFromListing(".gitignore", { gitignore: emptyGitignore }),
    ).toBe(false);
    expect(
      shouldExcludeFromListing(".prettierrc", { gitignore: emptyGitignore }),
    ).toBe(false);
  });

  it("excludes binary-looking extensions", () => {
    for (const name of ["logo.png", "font.woff2", "archive.zip", "doc.pdf"]) {
      expect(
        shouldExcludeFromListing(name, { gitignore: emptyGitignore }),
      ).toBe(true);
    }
  });

  it("excludes files over the 2 MB size cap", () => {
    expect(
      shouldExcludeFromListing("big.ts", {
        gitignore: emptyGitignore,
        sizeBytes: 2 * 1024 * 1024 + 1,
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromListing("small.ts", {
        gitignore: emptyGitignore,
        sizeBytes: 1024,
      }),
    ).toBe(false);
  });

  it("honors root .gitignore patterns", () => {
    const rules = parseGitignore("*.log\nbuild-output/\n");
    expect(shouldExcludeFromListing("app.log", { gitignore: rules })).toBe(
      true,
    );
    expect(
      shouldExcludeFromListing("build-output/index.html", {
        gitignore: rules,
      }),
    ).toBe(true);
    expect(shouldExcludeFromListing("src/index.ts", { gitignore: rules })).toBe(
      false,
    );
  });
});

describe("design connect bridge /list-files endpoint", () => {
  it("lists files honoring .gitignore, always-ignore dirs, and secret blocklist", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n");
    fs.writeFileSync(path.join(root, "index.html"), "<h1>hi</h1>");
    fs.writeFileSync(path.join(root, "debug.log"), "noisy");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "pkg", "index.js"),
      "module.exports = {};",
    );
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export {};");

    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/list-files`,
        {},
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).toBe(200);
      expect(result.body["ok"]).toBe(true);
      const files = (result.body["files"] as Array<{ path: string }>).map(
        (f) => f.path,
      );
      expect(files).toContain("index.html");
      expect(files).toContain("src/app.ts");
      expect(files).not.toContain("debug.log");
      expect(files).not.toContain(".env");
      expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
      expect(result.body["truncated"]).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("requires a valid bridge token for /list-files", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await postJson(`http://127.0.0.1:${port}/list-files`, {});
      expect(result.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects reads of secret-looking paths even with a valid token", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/read-file`,
        { relPath: ".env" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).not.toBe(200);
      expect(result.body["ok"]).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("accepts the expanded text-file extension list for writes", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };
      for (const relPath of ["app.ts", "component.tsx", "config.yaml"]) {
        const result = await postJson(
          `${base}/write-file`,
          { relPath, content: "// ok" },
          authHeader,
        );
        expect(result.status).toBe(200);
      }
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("still rejects writes for extensions outside the allowed list", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/write-file`,
        { relPath: "binary.exe", content: "nope" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).toBe(500);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("advertises listFiles/readTextFiles/writeTextFiles manifest capabilities", async () => {
    const root = tmpDir();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: await freePort(),
    });
    expect(manifest.manifestCapabilities).toEqual({
      listFiles: true,
      readTextFiles: true,
      writeTextFiles: true,
    });
    expect(manifest.capabilities.some((c) => c.operation === "listFiles")).toBe(
      true,
    );
  });

  it("rejects reads of uppercase/mixed-case secret-looking paths", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, ".ENV"), "SECRET=1");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/read-file`,
        { relPath: ".ENV" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).not.toBe(200);
      expect(result.body["ok"]).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects writes of uppercase/mixed-case secret-looking paths", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/write-file`,
        { relPath: "KEY.PEM", content: "nope" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).not.toBe(200);
      expect(result.body["ok"]).toBe(false);
      expect(fs.existsSync(path.join(root, "KEY.PEM"))).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });
});

describe("design connect bridge version conflict handling", () => {
  it("read-file returns a versionHash", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "index.html"), "<h1>hi</h1>");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/read-file`,
        { relPath: "index.html" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).toBe(200);
      expect(typeof result.body["versionHash"]).toBe("string");
      expect(result.body["versionHash"]).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("uses content hashes when size and mtime are unchanged", async () => {
    const root = tmpDir();
    const file = path.join(root, "same-size.tsx");
    const fixedTime = new Date("2025-01-01T00:00:00.000Z");
    fs.writeFileSync(file, "AAAA");
    fs.utimesSync(file, fixedTime, fixedTime);
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const auth = { "x-bridge-token": bridge.bridgeToken };
    try {
      const base = `http://127.0.0.1:${port}`;
      const before = await postJson(
        `${base}/read-file`,
        { relPath: "same-size.tsx" },
        auth,
      );
      fs.writeFileSync(file, "BBBB");
      fs.utimesSync(file, fixedTime, fixedTime);
      const after = await postJson(
        `${base}/read-file`,
        { relPath: "same-size.tsx" },
        auth,
      );
      expect(before.body["versionHash"]).not.toBe(after.body["versionHash"]);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("write-file succeeds with no expectedVersionHash for a new file and returns versionHash", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const result = await postJson(
        `${base}/write-file`,
        { relPath: "new.html", content: "<p>new</p>" },
        { "x-bridge-token": bridgeToken },
      );
      expect(result.status).toBe(200);
      expect(typeof result.body["versionHash"]).toBe("string");
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("supports an exact-hash contract without changing legacy optional writes", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "component.tsx"), "export const v = 0;\n");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const auth = { "x-bridge-token": bridge.bridgeToken };
    try {
      const base = `http://127.0.0.1:${port}`;
      const guarded = await postJson(
        `${base}/write-file`,
        {
          relPath: "component.tsx",
          content: "export const v = 1;\n",
          requireExpectedVersionHash: true,
        },
        auth,
      );
      expect(guarded.status).toBe(428);
      expect(guarded.body["error"]).toBe("expectedVersionHash is required");

      const legacy = await postJson(
        `${base}/write-file`,
        { relPath: "component.tsx", content: "export const v = 2;\n" },
        auth,
      );
      expect(legacy.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("treats deletion as a conflict under the exact-hash contract", async () => {
    const root = tmpDir();
    const file = path.join(root, "component.tsx");
    fs.writeFileSync(file, "export const v = 0;\n");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const auth = { "x-bridge-token": bridge.bridgeToken };
    try {
      const base = `http://127.0.0.1:${port}`;
      const read = await postJson(
        `${base}/read-file`,
        { relPath: "component.tsx" },
        auth,
      );
      fs.rmSync(file);
      const result = await postJson(
        `${base}/write-file`,
        {
          relPath: "component.tsx",
          content: "export const v = 1;\n",
          expectedVersionHash: read.body["versionHash"],
          requireExpectedVersionHash: true,
        },
        auth,
      );
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        ok: false,
        error: "version conflict",
      });
      expect(result.body).not.toHaveProperty("content");
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("write-file returns 409 when expectedVersionHash is stale", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "index.html"), "<h1>hi</h1>");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      // Someone else changes the file on disk after the client "read" it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      fs.writeFileSync(
        path.join(root, "index.html"),
        "<h1>changed underneath you</h1>",
      );

      const result = await postJson(
        `${base}/write-file`,
        {
          relPath: "index.html",
          content: "<h1>my edit</h1>",
          expectedVersionHash: "0-9999999",
        },
        authHeader,
      );
      expect(result.status).toBe(409);
      expect(result.body["error"]).toBe("version conflict");
      expect(typeof result.body["currentVersionHash"]).toBe("string");
      // The concurrent change must not have been overwritten.
      expect(fs.readFileSync(path.join(root, "index.html"), "utf8")).toBe(
        "<h1>changed underneath you</h1>",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("write-file succeeds when expectedVersionHash matches the current file", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "index.html"), "<h1>hi</h1>");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const readResult = await postJson(
        `${base}/read-file`,
        { relPath: "index.html" },
        authHeader,
      );
      const expectedVersionHash = readResult.body["versionHash"] as string;

      const writeResult = await postJson(
        `${base}/write-file`,
        {
          relPath: "index.html",
          content: "<h1>updated</h1>",
          expectedVersionHash,
        },
        authHeader,
      );
      expect(writeResult.status).toBe(200);
      expect(writeResult.body["ok"]).toBe(true);
      expect(fs.readFileSync(path.join(root, "index.html"), "utf8")).toBe(
        "<h1>updated</h1>",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("serializes concurrent compare-and-swap writes to one canonical path", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "real"));
    fs.writeFileSync(
      path.join(root, "real/component.tsx"),
      "export const v = 0;\n",
    );
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"), "dir");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const auth = { "x-bridge-token": bridge.bridgeToken };
    try {
      const base = `http://127.0.0.1:${port}`;
      const read = await postJson(
        `${base}/read-file`,
        { relPath: "real/component.tsx" },
        auth,
      );
      const expectedVersionHash = read.body["versionHash"] as string;
      const writes = await Promise.all(
        [
          { value: 1, relPath: "real/component.tsx" },
          { value: 2, relPath: "alias/component.tsx" },
        ].map(({ value, relPath }) =>
          postJson(
            `${base}/write-file`,
            {
              relPath,
              content: `export const v = ${value};\n`,
              expectedVersionHash,
            },
            auth,
          ),
        ),
      );
      expect(writes.map((result) => result.status).sort()).toEqual([200, 409]);
      const winner = writes.find((result) => result.status === 200)!;
      const finalRead = await postJson(
        `${base}/read-file`,
        { relPath: "real/component.tsx" },
        auth,
      );
      expect(finalRead.body["versionHash"]).toBe(winner.body["versionHash"]);
      expect(
        fs
          .readdirSync(path.join(root, "real"))
          .filter((name) => name.includes(".agent-native-")),
      ).toEqual([]);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("rejects a leaf symlink swapped in after read without touching its target", async () => {
    const root = tmpDir();
    const outside = tmpDir();
    const relPath = "component.tsx";
    const localPath = path.join(root, relPath);
    const outsidePath = path.join(outside, "outside.tsx");
    fs.writeFileSync(localPath, "export const local = true;\n");
    fs.writeFileSync(outsidePath, "export const secret = true;\n");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const auth = { "x-bridge-token": bridge.bridgeToken };
    try {
      const base = `http://127.0.0.1:${port}`;
      const read = await postJson(`${base}/read-file`, { relPath }, auth);
      fs.rmSync(localPath);
      fs.symlinkSync(outsidePath, localPath);
      const result = await postJson(
        `${base}/write-file`,
        {
          relPath,
          content: "export const overwritten = true;\n",
          expectedVersionHash: read.body["versionHash"],
        },
        auth,
      );
      expect(result.status).not.toBe(200);
      expect(fs.readFileSync(outsidePath, "utf8")).toBe(
        "export const secret = true;\n",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("atomically creates nested files and removes temp siblings", async () => {
    const root = tmpDir();
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      const result = await postJson(
        `http://127.0.0.1:${port}/write-file`,
        { relPath: "src/new.tsx", content: "export default <main />;\n" },
        { "x-bridge-token": bridge.bridgeToken },
      );
      expect(result.status).toBe(200);
      expect(fs.readFileSync(path.join(root, "src/new.tsx"), "utf8")).toBe(
        "export default <main />;\n",
      );
      expect(
        fs
          .readdirSync(path.join(root, "src"))
          .filter((name) => name.includes(".agent-native-")),
      ).toEqual([]);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("apply-edit returns 409 when expectedVersionHash is stale", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "style.css"), "body { color: red; }");
    const port = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    const { bridgeToken } = bridge;
    try {
      const base = `http://127.0.0.1:${port}`;
      const authHeader = { "x-bridge-token": bridgeToken };

      const result = await postJson(
        `${base}/apply-edit`,
        {
          relPath: "style.css",
          search: "color: red;",
          replace: "color: blue;",
          expectedVersionHash: "0-9999999",
        },
        authHeader,
      );
      expect(result.status).toBe(409);
      expect(result.body["error"]).toBe("version conflict");
      expect(fs.readFileSync(path.join(root, "style.css"), "utf8")).toBe(
        "body { color: red; }",
      );
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });
});
