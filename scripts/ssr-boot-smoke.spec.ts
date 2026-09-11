import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("ssr boot smoke coverage reporting", () => {
  it("fails closed when --report-uncovered finds an unmeasured template", () => {
    const workspace = mkdtempSync(
      path.join(os.tmpdir(), "agent-native-ssr-smoke-"),
    );
    const appDir = path.join(
      workspace,
      "templates",
      "covered",
      ".netlify",
      "functions-internal",
      "server",
    );
    mkdirSync(appDir, { recursive: true });
    mkdirSync(path.join(workspace, "templates", "uncovered"), {
      recursive: true,
    });
    writeFileSync(
      path.join(workspace, "templates", "covered", "package.json"),
      "{}\n",
    );
    writeFileSync(
      path.join(workspace, "templates", "uncovered", "package.json"),
      "{}\n",
    );
    writeFileSync(path.join(appDir, "main.mjs"), "export default {};\n");

    let error: { status?: number; stdout?: string; stderr?: string } | null =
      null;
    try {
      execFileSync(
        process.execPath,
        [
          path.resolve("scripts/ssr-boot-smoke.mjs"),
          "--report-uncovered",
          "covered",
        ],
        { cwd: workspace, encoding: "utf8" },
      );
    } catch (caught) {
      error = caught as typeof error;
    }

    expect(error?.status).toBe(3);
    expect(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}`).toMatch(
      /NOT COVERED/,
    );
  });
});
