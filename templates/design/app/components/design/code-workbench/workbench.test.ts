import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeMonacoThemeColor } from "../code-workbench-theme";
import { CODE_WORKBENCH_SHELL_CLASSNAME } from "./code-workbench-shell";

describe("code workbench shell", () => {
  it("keeps a full-height edge between the workbench and canvas", () => {
    expect(CODE_WORKBENCH_SHELL_CLASSNAME).toContain("border-r");
    expect(CODE_WORKBENCH_SHELL_CLASSNAME).toContain("--workbench-border");
    expect(CODE_WORKBENCH_SHELL_CLASSNAME).toContain("shadow-[4px_0_12px");
  });

  it("keeps the per-design workbench mounted while another panel is visible", () => {
    const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
    const workbenchIndex = source.indexOf("<CodeWorkbenchLoader");
    expect(workbenchIndex).toBeGreaterThan(0);
    const mountGate = source.slice(workbenchIndex - 120, workbenchIndex);
    expect(mountGate).toContain("{id");
    expect(mountGate).toContain("!shellMode");
    expect(mountGate).not.toContain('activeLeftPanel === "code"');
    expect(mountGate).not.toContain("activeCodeFile");
  });

  it("normalizes computed CSS colors before passing them to Monaco", () => {
    expect(normalizeMonacoThemeColor("rgb(230, 230, 230)")).toBe("#e6e6e6");
    expect(normalizeMonacoThemeColor("rgba(14, 165, 233, 0.4)")).toBe(
      "#0ea5e966",
    );
    expect(normalizeMonacoThemeColor("rgb(90% 90% 90% / 50%)")).toBe(
      "#e6e6e680",
    );
    expect(normalizeMonacoThemeColor("#fff")).toBe("#ffffff");
    expect(normalizeMonacoThemeColor("var(--workbench-fg)")).toBeUndefined();
  });
});
