// @vitest-environment happy-dom

import { expect, it, vi } from "vitest";

import {
  DESIGN_HISTORY_OPEN_EVENT,
  DESIGN_UI_TOGGLE_EVENT,
  requestDesignHistoryOpen,
  requestDesignUiToggle,
} from "./design-ui-events";

it("dispatches the Design UI toggle request", () => {
  const listener = vi.fn();
  window.addEventListener(DESIGN_UI_TOGGLE_EVENT, listener);

  requestDesignUiToggle();

  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(DESIGN_UI_TOGGLE_EVENT, listener);
});

it("dispatches the Design history open request", () => {
  const listener = vi.fn();
  window.addEventListener(DESIGN_HISTORY_OPEN_EVENT, listener);

  requestDesignHistoryOpen();

  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(DESIGN_HISTORY_OPEN_EVENT, listener);
});
