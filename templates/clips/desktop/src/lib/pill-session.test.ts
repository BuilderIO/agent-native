import { describe, expect, it } from "vitest";

import { toolbarEnabledEffect } from "./pill-session";

describe("toolbarEnabledEffect", () => {
  it("retires a finished take's card when a live session takes the window", () => {
    expect(toolbarEnabledEffect(true, "done")).toBe("adopt-new-session");
  });

  it("keeps an open confirm through a toolbar-ready re-emit", () => {
    expect(toolbarEnabledEffect(true, "confirm")).toBe("keep");
  });

  it("leaves a live pill alone when enable is re-announced", () => {
    expect(toolbarEnabledEffect(true, "recording")).toBe("keep");
  });

  it("snaps back to rest when no session owns the pill", () => {
    expect(toolbarEnabledEffect(false, "recording")).toBe("reset-to-rest");
    expect(toolbarEnabledEffect(false, "confirm")).toBe("reset-to-rest");
  });

  it("keeps the completion card up while the controls are disabled", () => {
    expect(toolbarEnabledEffect(false, "done")).toBe("keep");
  });
});
