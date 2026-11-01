import { describe, expect, it } from "vitest";

import {
  checkWorkspaceAppScope,
  classifyWorkspacePath,
  // @ts-expect-error plain .mjs template script without types
} from "../templates/workspace-root/scripts/guard-workspace-app-scope.mjs";

describe("guard-workspace-app-scope", () => {
  it("classifies like Builder's classifyWorkspacePath", () => {
    expect(classifyWorkspacePath("crm", "apps/crm/app/a.ts")).toBe("app");
    expect(classifyWorkspacePath("crm", "./apps/crm/x")).toBe("app");
    expect(classifyWorkspacePath("crm", "pnpm-lock.yaml")).toBe(
      "derived-lockfile",
    );
    expect(classifyWorkspacePath("crm", "pnpm-workspace.yaml")).toBe(
      "pnpm-config",
    );
    expect(classifyWorkspacePath("crm", ".github/workflows/x.yml")).toBe("ci");
    expect(classifyWorkspacePath("crm", "apps/other/x.ts")).toBe("other-app");
    expect(classifyWorkspacePath("crm", "apps/crm-2/x.ts")).toBe("other-app");
    expect(classifyWorkspacePath("crm", "packages/shared/x.ts")).toBe("root");
  });

  it("fails on out-of-scope paths, warns on pnpm-workspace.yaml", () => {
    const r = checkWorkspaceAppScope("crm", [
      "apps/crm/a.ts",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "packages/shared/x.ts",
    ]);
    expect(r.violations.map((v: { path: string }) => v.path)).toEqual([
      "packages/shared/x.ts",
    ]);
    expect(r.warnings).toEqual(["pnpm-workspace.yaml"]);
  });
});
