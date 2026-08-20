import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    currentTabId: "tab-a",
    writeAppState: vi.fn((key: string, value: Record<string, unknown>) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    writeAppStateForCurrentTab: vi.fn(
      (key: string, value: Record<string, unknown>) => {
        store.set(`${key}:${mocks.currentTabId}`, value);
        return Promise.resolve();
      },
    ),
    assertAccess: vi.fn(),
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/_agent-native/open?app=design",
}));

import navigateAction from "./navigate.js";
import showDesignQuestionsAction from "./show-design-questions.js";

/** Mirrors the client's read order: tab-scoped key first, then the global. */
function navigateCommandVisibleTo(
  browserTabId: string,
): Record<string, unknown> | null {
  return (
    mocks.store.get(`navigate:${browserTabId}`) ??
    mocks.store.get("navigate") ??
    null
  );
}

describe("design navigate commands are scoped to the issuing tab", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.currentTabId = "tab-a";
    vi.clearAllMocks();
  });

  it("does not move a second tab when navigate runs in the first", async () => {
    await navigateAction.run({
      view: "editor",
      designId: "design_hi",
      editorView: "overview",
    });

    expect(navigateCommandVisibleTo("tab-a")).toMatchObject({
      designId: "design_hi",
    });
    expect(navigateCommandVisibleTo("tab-b")).toBeNull();
  });

  it("does not move a second tab when intake questions open in the first", async () => {
    await showDesignQuestionsAction.run({
      designId: "design_hi",
      questions: [
        {
          id: "form_factor",
          type: "text-options",
          question: "What form factor?",
          options: [{ label: "Desktop", value: "desktop" }],
        },
      ],
    });

    expect(navigateCommandVisibleTo("tab-a")).toMatchObject({
      designId: "design_hi",
    });
    expect(navigateCommandVisibleTo("tab-b")).toBeNull();
  });

  it("leaves each tab on its own design when two designs are set up back to back", async () => {
    mocks.currentTabId = "tab-a";
    await showDesignQuestionsAction.run({
      designId: "design_hi",
      questions: [
        {
          id: "form_factor",
          type: "text-options",
          question: "What form factor?",
          options: [{ label: "Desktop", value: "desktop" }],
        },
      ],
    });

    mocks.currentTabId = "tab-b";
    await showDesignQuestionsAction.run({
      designId: "design_goodbye",
      questions: [
        {
          id: "mood",
          type: "text-options",
          question: "What mood?",
          options: [{ label: "Warm", value: "warm" }],
        },
      ],
    });

    expect(navigateCommandVisibleTo("tab-a")).toMatchObject({
      designId: "design_hi",
    });
    expect(navigateCommandVisibleTo("tab-b")).toMatchObject({
      designId: "design_goodbye",
    });
  });

  it("has no action left writing the unscoped navigate key", () => {
    const actionsDir = import.meta.dirname;
    const offenders = readdirSync(actionsDir)
      .filter(
        (file) => file.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(file),
      )
      .filter((file) =>
        /writeAppState\(\s*"navigate"/.test(
          readFileSync(join(actionsDir, file), "utf8"),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
