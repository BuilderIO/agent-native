// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendDesignEditorCommand,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";

import { applySameTabEditorCommands } from "./apply-same-tab-editor-commands";

const mocks = vi.hoisted(() => ({
  writes: [] as Array<[string, unknown]>,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  setClientAppState: vi.fn(async (key: string, value: unknown) => {
    mocks.writes.push([key, value]);
    return value ?? null;
  }),
}));

const TAB = "tab-1";
const STORED_KEY = `design-editor-command:${TAB}`;

function tokensCommand(designId = "design-1"): DesignEditorCommand {
  return {
    designId,
    leftPanel: "library",
    issuedAt: 1,
    path: `/design/${designId}?panel=library`,
  };
}

const unsubscribes: Array<() => void> = [];

function listen(apply: (command: DesignEditorCommand) => boolean) {
  unsubscribes.push(
    applySameTabEditorCommands({
      designId: "design-1",
      browserTabId: TAB,
      apply,
    }),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/design/design-1?panel=threads");
});

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  mocks.writes.length = 0;
});

describe("applySameTabEditorCommands", () => {
  it("applies a navigate for the open design before the send returns, then clears its stored copy", () => {
    const applied: DesignEditorCommand[] = [];
    listen((command) => {
      applied.push(command);
      return true;
    });

    const command = tokensCommand();
    sendDesignEditorCommand(command, TAB);

    // Core changes the address right after the send returns, so the editor's
    // updates for the command are queued ahead of the address change.
    expect(applied).toEqual([command]);
    expect(mocks.writes).toEqual([
      [STORED_KEY, command],
      [STORED_KEY, null],
    ]);
  });

  it("leaves another design's command stored for the editor that opens it", () => {
    const apply = vi.fn(() => true);
    listen(apply);

    const command = tokensCommand("design-2");
    sendDesignEditorCommand(command, TAB);

    expect(apply).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([[STORED_KEY, command]]);
  });

  it("leaves a command whose path opens another editor route stored for that editor", () => {
    window.history.replaceState(null, "", "/visual-edit/design-1");
    const apply = vi.fn(() => true);
    listen(apply);

    const command = { ...tokensCommand(), interactTheme: "dark" as const };
    sendDesignEditorCommand(command, TAB);

    expect(apply).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([[STORED_KEY, command]]);
  });

  it("keeps a command the editor can't apply yet stored for a later read", () => {
    const apply = vi.fn(() => false);
    listen(apply);

    const command = tokensCommand();
    sendDesignEditorCommand(command, TAB);

    expect(apply).toHaveBeenCalledWith(command);
    expect(mocks.writes).toEqual([[STORED_KEY, command]]);
  });

  it("stops applying once unsubscribed", () => {
    const apply = vi.fn(() => true);
    listen(apply);
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();

    sendDesignEditorCommand(tokensCommand(), TAB);

    expect(apply).not.toHaveBeenCalled();
  });
});
