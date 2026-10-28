import { vi } from "vitest";

const MOUSE_NUMBER_KEYS = ["clientX", "clientY", "screenX", "screenY"] as const;
const MOUSE_FLAG_KEYS = ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const;

/**
 * happy-dom's WheelEvent drops the MouseEvent half of its init (modifiers and
 * pointer coordinates); a browser keeps it. Install this where a test needs a
 * constructed wheel to carry them, and call `vi.unstubAllGlobals()` after.
 */
export function stubFaithfulWheelEvent() {
  class FaithfulWheelEvent extends WheelEvent {
    constructor(type: string, init: WheelEventInit = {}) {
      super(type, init);
      for (const key of MOUSE_NUMBER_KEYS) {
        Object.defineProperty(this, key, {
          value: init[key] ?? 0,
          configurable: true,
        });
      }
      for (const key of MOUSE_FLAG_KEYS) {
        Object.defineProperty(this, key, {
          value: init[key] ?? false,
          configurable: true,
        });
      }
    }
  }
  vi.stubGlobal("WheelEvent", FaithfulWheelEvent);
}
