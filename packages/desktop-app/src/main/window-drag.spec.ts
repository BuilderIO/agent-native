import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import {
  createWindowDragController,
  installWindowDragController,
  WINDOW_DRAG_REGION_HEIGHT,
  WINDOW_DRAG_REGION_TOP,
} from "./window-drag.js";

type EventListener = (...args: unknown[]) => void;

function createEventTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  const onceWrappers = new Map<EventListener, EventListener>();

  return {
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    isDestroyed: vi.fn(() => false),
    on: vi.fn((event: string, listener: EventListener) => {
      const eventListeners = listeners.get(event) ?? new Set<EventListener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    once: vi.fn((event: string, listener: EventListener) => {
      const onceListener: EventListener = (...args) => {
        listeners.get(event)?.delete(onceListener);
        onceWrappers.delete(listener);
        listener(...args);
      };
      onceWrappers.set(listener, onceListener);
      const eventListeners = listeners.get(event) ?? new Set<EventListener>();
      eventListeners.add(onceListener);
      listeners.set(event, eventListeners);
    }),
    removeListener: vi.fn((event: string, listener: EventListener) => {
      listeners.get(event)?.delete(listener);
      const onceListener = onceWrappers.get(listener);
      if (onceListener) {
        listeners.get(event)?.delete(onceListener);
        onceWrappers.delete(listener);
      }
    }),
  };
}

function createWindow() {
  return {
    getContentBounds: vi.fn(() => ({ y: 100 })),
    getPosition: vi.fn(() => [40, 60] as [number, number]),
    isDestroyed: vi.fn(() => false),
    setPosition: vi.fn(),
  };
}

function mouseEvent() {
  return { preventDefault: vi.fn() };
}

describe("window drag gesture", () => {
  it("leaves a click in the top region available to the page", () => {
    const window = createWindow();
    const controller = createWindowDragController(window, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    });
    const event = mouseEvent();

    controller.handleBeforeMouseEvent(event, {
      type: "mouseDown",
      button: "left",
      globalX: 120,
      globalY: 110,
    });
    controller.handleBeforeMouseEvent(event, {
      type: "mouseUp",
      button: "left",
      globalX: 120,
      globalY: 110,
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.setPosition).not.toHaveBeenCalled();
  });

  it("starts moving after the threshold and suppresses the drag tail", () => {
    const window = createWindow();
    const controller = createWindowDragController(window, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    });
    const down = mouseEvent();
    const move = mouseEvent();
    const up = mouseEvent();

    controller.handleBeforeMouseEvent(down, {
      type: "mouseDown",
      button: "left",
      globalX: 120,
      globalY: 100 + WINDOW_DRAG_REGION_TOP + WINDOW_DRAG_REGION_HEIGHT / 2,
    });
    controller.handleBeforeMouseEvent(move, {
      type: "mouseMove",
      globalX: 127,
      globalY: 135,
    });
    controller.handleBeforeMouseEvent(up, {
      type: "mouseUp",
      button: "left",
      globalX: 127,
      globalY: 135,
    });

    expect(move.preventDefault).toHaveBeenCalledOnce();
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(window.setPosition).toHaveBeenCalledWith(47, 67, false);
  });

  it("does not capture clicks outside the top region", () => {
    const window = createWindow();
    const controller = createWindowDragController(window, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    });
    const event = mouseEvent();

    controller.handleBeforeMouseEvent(event, {
      type: "mouseDown",
      button: "left",
      globalX: 120,
      globalY: 119,
    });
    controller.handleBeforeMouseEvent(event, {
      type: "mouseMove",
      globalX: 140,
      globalY: 140,
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.setPosition).not.toHaveBeenCalled();
  });

  it("keeps the same gesture available when a native webview owns the edge", () => {
    const host = createEventTarget();
    const guest = createEventTarget();
    const windowEvents = createEventTarget();
    const window = {
      getContentBounds: vi.fn(() => ({ y: 100 })),
      getPosition: vi.fn(() => [40, 60] as [number, number]),
      isDestroyed: vi.fn(() => false),
      on: windowEvents.on,
      removeListener: windowEvents.removeListener,
      setPosition: vi.fn(),
      webContents: host as unknown as WebContents,
    } as unknown as BrowserWindow;
    const event = mouseEvent();
    const cleanup = installWindowDragController(window, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    });

    host.emit("did-attach-webview", {}, guest as unknown as WebContents);
    guest.emit("before-mouse-event", event, {
      type: "mouseDown",
      button: "left",
      globalX: 120,
      globalY: 128,
    });
    guest.emit("before-mouse-event", event, {
      type: "mouseMove",
      globalX: 127,
      globalY: 135,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.setPosition).toHaveBeenCalledWith(47, 67, false);

    cleanup();
    expect(guest.removeListener).toHaveBeenCalledWith(
      "before-mouse-event",
      expect.any(Function),
    );
  });

  it("releases a destroyed guest webview listener", () => {
    const host = createEventTarget();
    const guest = createEventTarget();
    const windowEvents = createEventTarget();
    const window = {
      getContentBounds: vi.fn(() => ({ y: 100 })),
      getPosition: vi.fn(() => [40, 60] as [number, number]),
      isDestroyed: vi.fn(() => false),
      on: windowEvents.on,
      removeListener: windowEvents.removeListener,
      setPosition: vi.fn(),
      webContents: host as unknown as WebContents,
    } as unknown as BrowserWindow;
    const cleanup = installWindowDragController(window, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    });

    host.emit("did-attach-webview", {}, guest as unknown as WebContents);
    const down = mouseEvent();
    guest.emit("before-mouse-event", down, {
      type: "mouseDown",
      button: "left",
      globalX: 120,
      globalY: 128,
    });
    guest.isDestroyed.mockReturnValue(true);
    guest.emit("destroyed");

    const move = mouseEvent();
    host.emit("before-mouse-event", move, {
      type: "mouseMove",
      globalX: 140,
      globalY: 148,
    });

    expect(guest.removeListener).toHaveBeenCalledWith(
      "before-mouse-event",
      expect.any(Function),
    );
    expect(move.preventDefault).not.toHaveBeenCalled();
    expect(window.setPosition).not.toHaveBeenCalled();

    cleanup();
  });
});
