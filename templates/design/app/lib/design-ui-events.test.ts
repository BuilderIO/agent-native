// @vitest-environment happy-dom

import { expect, it, vi } from "vitest";

import {
  DESIGN_UI_TOGGLE_EVENT,
  requestDesignUiToggle,
} from "./design-ui-events";

it("dispatches the Design UI toggle request", () => {
  const listener = vi.fn();
  window.addEventListener(DESIGN_UI_TOGGLE_EVENT, listener);

  requestDesignUiToggle();

  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(DESIGN_UI_TOGGLE_EVENT, listener);
});
