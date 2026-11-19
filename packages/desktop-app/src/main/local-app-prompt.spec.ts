import { describe, expect, it } from "vitest";

import { buildDesktopLocalAppPrompt } from "./local-app-prompt";
import { localAppSetupSteps, setupLocalAppFolder } from "./local-app-setup";

describe("Desktop local app build prompt", () => {
  const input = {
    userPrompt: "make me a new app that tells me the weather",
    targetPath: "/Users/me/.agent-native/workspaces/weather",
    port: 5181,
  };

  it("leads with the person's words and states what Desktop owns", () => {
    const prompt = buildDesktopLocalAppPrompt(input);
    expect(prompt.startsWith(input.userPrompt)).toBe(true);
    expect(prompt).toContain(input.targetPath);
    expect(prompt).toContain("http://localhost:5181");
    expect(prompt).toContain("Do not scaffold another app or reinstall");
    expect(prompt).toContain("Do not start, stop or restart a dev server");
    expect(prompt).toContain("PGlite");
    expect(prompt).toContain("Open-Meteo");
    expect(prompt).toContain("Do not edit .env files");
  });
});

describe("Desktop local app setup", () => {
  it("scaffolds the starter in place, then installs", () => {
    const steps = localAppSetupSteps();
    expect(steps.map((step) => [step.command, ...step.args].join(" "))).toEqual(
      [
        "npx --yes @agent-native/core@latest create . --standalone --template chat",
        "pnpm install",
      ],
    );
  });

  it("runs each step in the app folder and stops at the first failure", async () => {
    const calls: string[] = [];
    const labels: string[] = [];
    const result = await setupLocalAppFolder({
      targetPath: "/apps/weather",
      env: { PATH: "/bin" },
      onStep: (step) => labels.push(step.label),
      run: async (step, options) => {
        calls.push(`${options.cwd}: ${step.command}`);
        options.onOutput("progress\n");
        return step.command === "pnpm" ? { code: 1 } : { code: 0 };
      },
    });
    expect(calls).toEqual(["/apps/weather: npx", "/apps/weather: pnpm"]);
    expect(labels).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      step: "Installing the app's dependencies",
      error: "pnpm exited with code 1.",
    });
  });

  it("succeeds when every step exits cleanly", async () => {
    await expect(
      setupLocalAppFolder({
        targetPath: "/apps/weather",
        env: {},
        run: async () => ({ code: 0 }),
      }),
    ).resolves.toEqual({ ok: true });
  });
});
