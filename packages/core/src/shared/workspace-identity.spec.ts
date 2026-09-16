import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { workspaceIdentity } from "./workspace-identity.js";

it("gives symlinked and physical workspace roots the same identity", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-identity-"));
  try {
    const physical = path.join(parent, "physical");
    const linked = path.join(parent, "linked");
    fs.mkdirSync(physical);
    fs.symlinkSync(physical, linked, "junction");
    expect(workspaceIdentity(linked)).toBe(workspaceIdentity(physical));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
