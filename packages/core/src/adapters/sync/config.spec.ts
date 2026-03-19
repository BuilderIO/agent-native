import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect } from "vitest";
import {
  shouldSyncFile,
  getDocId,
  isDenylisted,
  assertSafePath,
  assertNotSymlink,
  validateIdentifier,
  hashContent,
} from "./config.js";

describe("shouldSyncFile", () => {
  it("matches a file against a positive pattern", () => {
    expect(shouldSyncFile("file.json", ["*.json"])).toBe(true);
  });

  it("returns false when no patterns match", () => {
    expect(shouldSyncFile("data/file.txt", ["*.json"])).toBe(false);
  });

  it("returns false for empty patterns array", () => {
    expect(shouldSyncFile("anything.json", [])).toBe(false);
  });

  it("excludes files matching negation patterns", () => {
    expect(shouldSyncFile("secret.tmp", ["*.*", "!*.tmp"])).toBe(false);
  });

  it("blocks denylisted files even if pattern matches", () => {
    expect(shouldSyncFile(".env", [".*"])).toBe(false);
    expect(shouldSyncFile(".env.local", [".*"])).toBe(false);
  });

  it("matches non-denylisted dot files when pattern uses dot: true", () => {
    expect(shouldSyncFile(".myconfig", [".*"])).toBe(true);
  });

  it("returns false when positive and negation cancel out", () => {
    expect(shouldSyncFile("data.json", ["*.json", "!*.json"])).toBe(false);
  });

  it("matches glob patterns with directory wildcards", () => {
    expect(shouldSyncFile("data/nested/file.json", ["data/**/*.json"])).toBe(
      true,
    );
  });
});

describe("isDenylisted", () => {
  it("blocks .env files", () => {
    expect(isDenylisted(".env")).toBe(true);
    expect(isDenylisted(".env.local")).toBe(true);
  });

  it("blocks node_modules", () => {
    expect(isDenylisted("node_modules/foo/bar.js")).toBe(true);
  });

  it("blocks .git directory", () => {
    expect(isDenylisted(".git/config")).toBe(true);
  });

  it("allows normal files", () => {
    expect(isDenylisted("data/file.json")).toBe(false);
  });
});

describe("getDocId", () => {
  it("generates an ID from appId and file path using : separator", () => {
    expect(getDocId("app1", "data/file.json")).toBe("app1:data/file.json");
  });

  it("preserves path structure", () => {
    expect(getDocId("app1", "data/nested/file.json")).toBe(
      "app1:data/nested/file.json",
    );
  });

  it("handles paths with no slashes", () => {
    expect(getDocId("app1", "file.json")).toBe("app1:file.json");
  });
});

describe("assertSafePath", () => {
  let tmpRoot: string;

  function setup() {
    // Use realpathSync to resolve macOS /tmp -> /private/tmp symlink
    tmpRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "safepath-")),
    );
  }

  function teardown() {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  it("blocks directory traversal", () => {
    setup();
    try {
      expect(() => assertSafePath(tmpRoot, "../../etc/passwd")).toThrow(
        "Path traversal blocked",
      );
    } finally {
      teardown();
    }
  });

  it("blocks null byte injection", () => {
    setup();
    try {
      expect(() => assertSafePath(tmpRoot, "file\0.json")).toThrow(
        "empty or contains null byte",
      );
    } finally {
      teardown();
    }
  });

  it("blocks empty path", () => {
    setup();
    try {
      expect(() => assertSafePath(tmpRoot, "")).toThrow(
        "empty or contains null byte",
      );
    } finally {
      teardown();
    }
  });

  it("allows valid relative paths", () => {
    setup();
    try {
      fs.mkdirSync(path.join(tmpRoot, "data"), { recursive: true });
      const result = assertSafePath(tmpRoot, "data/file.json");
      expect(result).toBe(path.join(tmpRoot, "data/file.json"));
    } finally {
      teardown();
    }
  });

  it("works when parent dir doesn't exist yet", () => {
    setup();
    try {
      const result = assertSafePath(tmpRoot, "nonexistent/deep/file.json");
      expect(result).toBe(path.join(tmpRoot, "nonexistent/deep/file.json"));
    } finally {
      teardown();
    }
  });
});

describe("assertNotSymlink", () => {
  let tmpDir: string;

  function setup() {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "symlink-")),
    );
  }

  function teardown() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it("passes for regular files", () => {
    setup();
    try {
      const filePath = path.join(tmpDir, "regular.txt");
      fs.writeFileSync(filePath, "hello");
      expect(() => assertNotSymlink(filePath)).not.toThrow();
    } finally {
      teardown();
    }
  });

  it("passes for non-existent files", () => {
    setup();
    try {
      const filePath = path.join(tmpDir, "does-not-exist.txt");
      expect(() => assertNotSymlink(filePath)).not.toThrow();
    } finally {
      teardown();
    }
  });

  it("throws for symlinks", () => {
    setup();
    try {
      const target = path.join(tmpDir, "target.txt");
      const link = path.join(tmpDir, "link.txt");
      fs.writeFileSync(target, "target content");
      fs.symlinkSync(target, link);
      expect(() => assertNotSymlink(link)).toThrow(
        "Refusing to write through symlink",
      );
    } finally {
      teardown();
    }
  });
});

describe("validateIdentifier", () => {
  it("accepts alphanumeric with hyphens and underscores", () => {
    expect(() => validateIdentifier("appId", "my-app_123")).not.toThrow();
  });

  it("rejects spaces", () => {
    expect(() => validateIdentifier("appId", "my app")).toThrow(
      "Invalid appId",
    );
  });

  it("rejects ampersand", () => {
    expect(() => validateIdentifier("appId", "foo&bar")).toThrow(
      "Invalid appId",
    );
  });

  it("rejects equals sign", () => {
    expect(() => validateIdentifier("appId", "foo=bar")).toThrow(
      "Invalid appId",
    );
  });

  it("rejects slashes", () => {
    expect(() => validateIdentifier("appId", "foo/bar")).toThrow(
      "Invalid appId",
    );
  });
});

describe("hashContent", () => {
  it("returns consistent hash for same content", () => {
    const hash1 = hashContent("hello world");
    const hash2 = hashContent("hello world");
    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different content", () => {
    const hash1 = hashContent("hello");
    const hash2 = hashContent("world");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a branded ContentHash type", () => {
    const hash = hashContent("test");
    // The hash is a string at runtime; verify it's a valid hex SHA-256 (64 chars)
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
