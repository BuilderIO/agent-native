import fs from "fs";
import os from "os";
import path from "path";

import { describe, it, expect } from "vitest";

import {
  parseArgs,
  camelCaseArgs,
  isValidPath,
  isValidProjectPath,
  loadEnv,
} from "./utils.js";

const ENV_TEST_KEYS = [
  "DATABASE_URL",
  "AN_TEST_SHARED",
  "AN_TEST_LOCAL_ONLY",
  "AN_TEST_WORKSPACE_ONLY",
];

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_TEST_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("parseArgs", () => {
  it("parses --key value format", () => {
    expect(parseArgs(["--name", "hello"])).toEqual({ name: "hello" });
  });

  it("preserves empty --key value format", () => {
    expect(parseArgs(["--name", ""])).toEqual({ name: "" });
  });

  it("parses --key=value format", () => {
    expect(parseArgs(["--name=hello"])).toEqual({ name: "hello" });
  });

  it("parses --flag as boolean true", () => {
    expect(parseArgs(["--verbose"])).toEqual({ verbose: "true" });
  });

  it("returns empty object for empty array", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("handles mixed formats", () => {
    expect(parseArgs(["--name", "hello", "--count=5", "--verbose"])).toEqual({
      name: "hello",
      count: "5",
      verbose: "true",
    });
  });

  it("treats --key --other-key as two boolean flags", () => {
    expect(parseArgs(["--foo", "--bar"])).toEqual({ foo: "true", bar: "true" });
  });

  it("skips non-flag arguments", () => {
    expect(parseArgs(["positional", "--name", "hello"])).toEqual({
      name: "hello",
    });
  });
});

describe("camelCaseArgs", () => {
  it("converts kebab-case to camelCase", () => {
    expect(camelCaseArgs({ "my-key": "val" })).toEqual({ myKey: "val" });
  });

  it("leaves already camelCase keys unchanged", () => {
    expect(camelCaseArgs({ myKey: "val" })).toEqual({ myKey: "val" });
  });

  it("leaves single-word keys unchanged", () => {
    expect(camelCaseArgs({ name: "val" })).toEqual({ name: "val" });
  });

  it("returns empty object for empty input", () => {
    expect(camelCaseArgs({})).toEqual({});
  });
});

describe("loadEnv", () => {
  it("lets app .env.local override app .env while preserving shell env", () => {
    const snapshot = Object.fromEntries(
      ENV_TEST_KEYS.map((key) => [key, process.env[key]]),
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "an-load-env-"));
    const appDir = path.join(tmp, "apps", "analytics");

    try {
      for (const key of ENV_TEST_KEYS) delete process.env[key];
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          "agent-native": {
            workspaceCore: "packages/core",
          },
        }),
      );
      fs.writeFileSync(
        path.join(tmp, ".env"),
        ["AN_TEST_WORKSPACE_ONLY=workspace", "AN_TEST_SHARED=workspace"].join(
          "\n",
        ),
      );
      fs.writeFileSync(
        path.join(tmp, ".env.local"),
        "AN_TEST_WORKSPACE_ONLY=workspace-local\n",
      );
      fs.writeFileSync(
        path.join(appDir, ".env"),
        ["DATABASE_URL=postgres://production", "AN_TEST_SHARED=app"].join("\n"),
      );
      fs.writeFileSync(
        path.join(appDir, ".env.local"),
        ["DATABASE_URL=file:./data/app.db", "AN_TEST_LOCAL_ONLY=local"].join(
          "\n",
        ),
      );

      loadEnv(path.join(appDir, ".env"));

      expect(process.env.DATABASE_URL).toBe("file:./data/app.db");
      expect(process.env.AN_TEST_SHARED).toBe("app");
      expect(process.env.AN_TEST_LOCAL_ONLY).toBe("local");
      expect(process.env.AN_TEST_WORKSPACE_ONLY).toBe("workspace-local");

      process.env.DATABASE_URL = "postgres://shell";
      delete process.env.AN_TEST_SHARED;
      delete process.env.AN_TEST_LOCAL_ONLY;
      delete process.env.AN_TEST_WORKSPACE_ONLY;

      loadEnv(path.join(appDir, ".env"));

      expect(process.env.DATABASE_URL).toBe("postgres://shell");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      restoreEnv(snapshot);
    }
  });
});

describe("isValidPath", () => {
  it("accepts a valid relative path", () => {
    expect(isValidPath("data/file.json")).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(isValidPath("/etc/passwd")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isValidPath("../secret")).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isValidPath("file\0.json")).toBe(false);
  });

  it("accepts a simple filename", () => {
    expect(isValidPath("readme.md")).toBe(true);
  });
});

describe("isValidProjectPath", () => {
  it("accepts a valid slug", () => {
    expect(isValidProjectPath("my-project")).toBe(true);
  });

  it("accepts a grouped slug", () => {
    expect(isValidProjectPath("group/my-project")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidProjectPath("")).toBe(false);
  });

  it("rejects path with special characters", () => {
    expect(isValidProjectPath("my project!")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isValidProjectPath("/absolute")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isValidProjectPath("../escape")).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(isValidProjectPath("MyProject")).toBe(false);
  });
});
