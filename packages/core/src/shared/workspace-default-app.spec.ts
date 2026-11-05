import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceDefaultApp,
  withWorkspaceRootEnv,
} from "./workspace-default-app.js";

function rootWithEnv(contents?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-default-app-"));
  if (contents !== undefined)
    fs.writeFileSync(path.join(root, ".env"), contents);
  return root;
}

describe("withWorkspaceRootEnv", () => {
  it("returns env untouched without a .env", () => {
    const env = { A: "1" };
    expect(withWorkspaceRootEnv(rootWithEnv(), env)).toBe(env);
  });

  it("lets non-blank process env win over .env", () => {
    const root = rootWithEnv("WORKSPACE_DEFAULT_APP=mail\n");
    expect(
      withWorkspaceRootEnv(root, { WORKSPACE_DEFAULT_APP: "calendar" })
        .WORKSPACE_DEFAULT_APP,
    ).toBe("calendar");
  });

  it("does not let a blank process env mask .env", () => {
    const root = rootWithEnv("WORKSPACE_DEFAULT_APP=mail\n");
    expect(
      withWorkspaceRootEnv(root, { WORKSPACE_DEFAULT_APP: "" })
        .WORKSPACE_DEFAULT_APP,
    ).toBe("mail");
  });
});

describe("resolveWorkspaceDefaultApp", () => {
  const apps = ["mail", "calendar"];

  it("resolves a known app, trimmed", () => {
    expect(
      resolveWorkspaceDefaultApp({ WORKSPACE_DEFAULT_APP: " mail " }, apps),
    ).toBe("mail");
  });

  it("returns null for unset, blank, or unknown", () => {
    expect(resolveWorkspaceDefaultApp({}, apps)).toBeNull();
    expect(
      resolveWorkspaceDefaultApp({ WORKSPACE_DEFAULT_APP: "" }, apps),
    ).toBeNull();
    expect(
      resolveWorkspaceDefaultApp({ WORKSPACE_DEFAULT_APP: "nope" }, apps),
    ).toBeNull();
  });
});
