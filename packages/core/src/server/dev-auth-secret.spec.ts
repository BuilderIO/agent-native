import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEV_AUTH_SECRET_PATH,
  DevAuthSecretFileError,
  resolvePersistedDevAuthSecret,
} from "./better-auth-instance.js";

function tempAppRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dev-auth-secret-"));
}

function secretFile(appRoot: string): string {
  return path.join(appRoot, DEV_AUTH_SECRET_PATH);
}

describe("resolvePersistedDevAuthSecret", () => {
  it("creates the file exclusively with restrictive permissions and no env files", () => {
    const appRoot = tempAppRoot();
    try {
      const secret = resolvePersistedDevAuthSecret(
        appRoot,
        () => "generated-secret-value",
      );

      expect(secret).toBe("generated-secret-value");
      const file = secretFile(appRoot);
      expect(fs.readFileSync(file, "utf8")).toBe("generated-secret-value\n");
      if (process.platform !== "win32") {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
      expect(fs.existsSync(path.join(appRoot, ".env.local"))).toBe(false);
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("reuses the persisted value on the next call instead of regenerating", () => {
    const appRoot = tempAppRoot();
    try {
      let generation = 0;
      const generate = () => `secret-generation-${++generation}`;

      const first = resolvePersistedDevAuthSecret(appRoot, generate);
      const second = resolvePersistedDevAuthSecret(appRoot, generate);

      expect(first).toBe("secret-generation-1");
      expect(second).toBe("secret-generation-1");
      expect(generation).toBe(1);
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("reuses a pre-existing secret verbatim and never overwrites it", () => {
    const appRoot = tempAppRoot();
    try {
      fs.mkdirSync(path.dirname(secretFile(appRoot)), { recursive: true });
      fs.writeFileSync(secretFile(appRoot), "hand-configured-secret\n", {
        mode: 0o600,
      });

      const secret = resolvePersistedDevAuthSecret(
        appRoot,
        () => "should-never-be-written",
      );

      expect(secret).toBe("hand-configured-secret");
      expect(fs.readFileSync(secretFile(appRoot), "utf8")).toBe(
        "hand-configured-secret\n",
      );
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("keeps the concurrent winner's secret and cleans up the loser", () => {
    const appRoot = tempAppRoot();
    try {
      const concurrentWriter = () => {
        fs.mkdirSync(path.dirname(secretFile(appRoot)), { recursive: true });
        fs.writeFileSync(secretFile(appRoot), "winner-secret\n", {
          mode: 0o600,
        });
        return "loser-secret";
      };

      const secret = resolvePersistedDevAuthSecret(appRoot, concurrentWriter);

      expect(secret).toBe("winner-secret");
      expect(fs.readFileSync(secretFile(appRoot), "utf8")).toBe(
        "winner-secret\n",
      );
      expect(fs.readdirSync(path.dirname(secretFile(appRoot)))).toEqual([
        "dev-auth-secret",
      ]);
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("throws a typed error for an unreadable file without overwriting it", () => {
    if (process.platform === "win32" || (process.getuid?.() ?? -1) === 0)
      return;

    const appRoot = tempAppRoot();
    try {
      fs.mkdirSync(path.dirname(secretFile(appRoot)), { recursive: true });
      fs.writeFileSync(secretFile(appRoot), "unreadable-secret\n");
      fs.chmodSync(secretFile(appRoot), 0o000);

      expect(() =>
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written"),
      ).toThrowError(DevAuthSecretFileError);
      try {
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written");
        expect.unreachable();
      } catch (error) {
        expect((error as DevAuthSecretFileError).reason).toBe("unreadable");
      }

      fs.chmodSync(secretFile(appRoot), 0o600);
      expect(fs.readFileSync(secretFile(appRoot), "utf8")).toBe(
        "unreadable-secret\n",
      );
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("throws a typed error for an empty file without overwriting it", () => {
    const appRoot = tempAppRoot();
    try {
      fs.mkdirSync(path.dirname(secretFile(appRoot)), { recursive: true });
      fs.writeFileSync(secretFile(appRoot), "", { mode: 0o600 });

      expect(() =>
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written"),
      ).toThrowError(DevAuthSecretFileError);
      try {
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written");
        expect.unreachable();
      } catch (error) {
        expect((error as DevAuthSecretFileError).reason).toBe("empty");
      }

      expect(fs.readFileSync(secretFile(appRoot), "utf8")).toBe("");
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("rejects a persisted secret that is accessible to other users", () => {
    if (process.platform === "win32") return;
    const appRoot = tempAppRoot();
    try {
      fs.mkdirSync(path.dirname(secretFile(appRoot)), { recursive: true });
      fs.writeFileSync(secretFile(appRoot), "exposed-secret\n", {
        mode: 0o644,
      });
      fs.chmodSync(secretFile(appRoot), 0o644);
      try {
        resolvePersistedDevAuthSecret(appRoot, () => "replacement");
        expect.unreachable();
      } catch (error) {
        expect((error as DevAuthSecretFileError).reason).toBe("unsafe");
      }
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("throws a typed error when the secret cannot be persisted at all", () => {
    const outer = tempAppRoot();
    try {
      const blocker = path.join(outer, "blocker");
      fs.writeFileSync(blocker, "not a directory");
      const appRoot = path.join(blocker, "app");

      expect(() =>
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written"),
      ).toThrowError(DevAuthSecretFileError);
      try {
        resolvePersistedDevAuthSecret(appRoot, () => "should-never-be-written");
        expect.unreachable();
      } catch (error) {
        expect((error as DevAuthSecretFileError).reason).toBe("create-failed");
      }
      expect(fs.existsSync(appRoot)).toBe(false);
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });
});
