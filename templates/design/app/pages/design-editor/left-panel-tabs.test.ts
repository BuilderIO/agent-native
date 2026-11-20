import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESIGN_LEFT_PANEL,
  isLeftPanelTab,
  nextDesignLeftPanel,
  showsLeftPanelTabs,
  visibleLeftPanel,
} from "./left-panel-tabs";
import { normalizeDesignLeftPanel } from "./tool-state";

describe("left panel tabs", () => {
  it("opens Design on the File tab and Interact on the chat", () => {
    expect(DEFAULT_DESIGN_LEFT_PANEL).toBe("file");
    expect(visibleLeftPanel("edit", DEFAULT_DESIGN_LEFT_PANEL)).toBe("file");
    expect(visibleLeftPanel("interact", DEFAULT_DESIGN_LEFT_PANEL)).toBe(
      "agent",
    );
  });

  it("shows the tab row in Design and comment mode, not in Interact", () => {
    expect(showsLeftPanelTabs("edit")).toBe(true);
    expect(showsLeftPanelTabs("comment")).toBe(true);
    expect(showsLeftPanelTabs("interact")).toBe(false);
  });

  it("keeps Design's tab across a trip to Interact", () => {
    // Asking for the chat in Interact is already satisfied there.
    expect(nextDesignLeftPanel("interact", "library", "agent")).toBe("library");
    expect(visibleLeftPanel("edit", "library")).toBe("library");
  });

  it("lets a request made in Interact set the tab Design returns to", () => {
    expect(nextDesignLeftPanel("interact", "agent", "file")).toBe("file");
    expect(nextDesignLeftPanel("edit", "file", "agent")).toBe("agent");
  });

  it("accepts only the three tab ids from the tab row", () => {
    expect(isLeftPanelTab("agent")).toBe(true);
    expect(isLeftPanelTab("file")).toBe(true);
    expect(isLeftPanelTab("library")).toBe(true);
    expect(isLeftPanelTab("tokens")).toBe(false);
    expect(isLeftPanelTab("threads")).toBe(false);
  });

  it("reads the old tokens id as the Library tab", () => {
    expect(normalizeDesignLeftPanel("tokens")).toBe("library");
    expect(normalizeDesignLeftPanel("library")).toBe("library");
  });
});
