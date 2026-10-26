import { afterEach, describe, expect, it, vi } from "vitest";

import { cliRerunCommand } from "./action-approval.js";

describe("cliRerunCommand", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  function onPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { ...platform, value });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
  });

  it("quotes for a POSIX shell", () => {
    onPlatform("linux");
    expect(cliRerunCommand("send", ["--to", "a b", "it's"])).toBe(
      `pnpm action send --to 'a b' 'it'"'"'s' --approved`,
    );
  });

  it("adds a cmd.exe form when Windows has no POSIX SHELL", () => {
    onPlatform("win32");
    vi.stubEnv("SHELL", "");
    expect(cliRerunCommand("send", ["--title", "Q3 plan", '{"id":"x"}'])).toBe(
      `pnpm action send --title 'Q3 plan' '{"id":"x"}' --approved\n` +
        `In cmd.exe: pnpm action send --title "Q3 plan" "{\\"id\\":\\"x\\"}" --approved`,
    );
  });

  it("prints one line when nothing needs quoting or the shell is POSIX", () => {
    onPlatform("win32");
    vi.stubEnv("SHELL", "");
    expect(cliRerunCommand("send", ["--id", "thread-1"])).toBe(
      "pnpm action send --id thread-1 --approved",
    );
    vi.stubEnv("SHELL", "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
    expect(cliRerunCommand("send", ["--title", "Q3 plan"])).toBe(
      "pnpm action send --title 'Q3 plan' --approved",
    );
  });
});
