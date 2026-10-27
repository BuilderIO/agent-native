import { afterEach, describe, expect, it, vi } from "vitest";

import { cliApprovalRefusal, cliRerunCommand } from "./action-approval.js";

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

describe("cliApprovalRefusal", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  function onPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { ...platform, value });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
  });

  it("offers a rerun with --approved", () => {
    onPlatform("linux");
    expect(cliApprovalRefusal("send", ["--note", "%HOME% 50%"])).toBe(
      `Action "send" requires human approval. Ask the person to approve this call, then rerun:\n` +
        `pnpm action send --note '%HOME% 50%' --approved`,
    );
  });

  it.each([
    ["", `\nIn cmd.exe: pnpm action send --note "%USERNAME%"`],
    ["C:\\Program Files\\Git\\usr\\bin\\bash.exe", ""],
  ])(
    "sends a Windows call with %%NAME%% to the prompt instead (SHELL=%j)",
    (shell, cmdLine) => {
      onPlatform("win32");
      vi.stubEnv("SHELL", shell);
      expect(cliApprovalRefusal("send", ["--note", "%USERNAME%"])).toBe(
        `Action "send" requires human approval. An argument contains %NAME%, which Windows expands when pnpm runs the action, so a rerun with --approved might not use these values. Ask the person to run this in a terminal and check the values at the prompt:\n` +
          `pnpm action send --note '%USERNAME%'${cmdLine}`,
      );
    },
  );

  it("keeps the Windows rerun for a lone percent sign or plain JSON", () => {
    onPlatform("win32");
    vi.stubEnv("SHELL", "");
    expect(cliApprovalRefusal("send", ["--note", "50%"])).toBe(
      `Action "send" requires human approval. Ask the person to approve this call, then rerun:\n` +
        `pnpm action send --note '50%' --approved\n` +
        `In cmd.exe: pnpm action send --note "50%" --approved`,
    );
    expect(cliApprovalRefusal("send", ['{"id":"x"}', "--note", "a b"])).toBe(
      `Action "send" requires human approval. Ask the person to approve this call, then rerun:\n` +
        `pnpm action send '{"id":"x"}' --note 'a b' --approved\n` +
        `In cmd.exe: pnpm action send "{\\"id\\":\\"x\\"}" --note "a b" --approved`,
    );
  });

  it.each([
    ["", ['a" & echo hi & "b', "%USERNAME%"]],
    ["C:\\Program Files\\Git\\usr\\bin\\bash.exe", ['a"', "& echo hi"]],
  ])(
    "shows no Windows command when a quote meets & | < > ^ (SHELL=%j)",
    (shell, args) => {
      onPlatform("win32");
      vi.stubEnv("SHELL", shell);
      expect(cliApprovalRefusal("send", args)).toBe(
        `Action "send" requires human approval. The arguments have a quote and one of & | < > ^, which pnpm on Windows can't pass through cmd.exe intact, so there's no command to copy. Ask the person to approve this call in the app instead.`,
      );
    },
  );

  it("keeps the rerun for a quote and & on a POSIX system", () => {
    onPlatform("linux");
    expect(cliApprovalRefusal("send", ['a" & b'])).toBe(
      `Action "send" requires human approval. Ask the person to approve this call, then rerun:\n` +
        `pnpm action send 'a" & b' --approved`,
    );
  });
});
