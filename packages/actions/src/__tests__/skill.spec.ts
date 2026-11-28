import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runActionCli } from "../cli.js";
import {
  ActionError,
  defineActionErrors,
  fail,
  isActionError,
} from "../contract.js";
import {
  AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH,
  installActionsSkill,
} from "../skill.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("actions skill installation and CLI", () => {
  it("installs .agents/skills/agent-native-actions/SKILL.md via init and skill commands", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-actions-skill-"));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "15.0.0" } }),
      "utf8",
    );

    const code = await runActionCli(["init", "--cwd", dir]);
    expect(code).toBe(0);

    const skillPath = path.join(dir, AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH);
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf8");
    expect(content).toContain("name: agent-native-actions");
    expect(content).toContain("Always Build New Capabilities as Actions");

    const second = installActionsSkill({ projectRoot: dir });
    expect(second.status).toBe("skipped");

    const forced = installActionsSkill({ projectRoot: dir, overwrite: true });
    expect(forced.status).toBe("updated");
  });

  it("brands ActionError with actionContractError for @agent-native/core interop", () => {
    const errors = defineActionErrors("not_found", "already_paid");
    expect(Object.isFrozen(errors.codes)).toBe(true);

    let thrown: unknown;
    try {
      fail("Missing record", { statusCode: 404, errorCode: "not_found" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ActionError);
    expect(isActionError(thrown)).toBe(true);
    expect(
      (thrown as { actionContractError?: unknown }).actionContractError,
    ).toBe(true);
  });
});
