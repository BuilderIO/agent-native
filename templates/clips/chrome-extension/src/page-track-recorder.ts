import {
  SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
  SESSION_REPLAY_DEFAULT_IGNORE_SELECTOR,
  SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS,
  SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR,
} from "@agent-native/core/client/session-replay-privacy";
import { record } from "@rrweb/record";

import type { PageTrackCommand, PageTrackRecorderConfig } from "./page-track";
import { blockedFrameFilter } from "./page-track-frames";
import {
  describeTarget,
  viewportInCapture,
  type PageTargetPrivacy,
} from "./page-track-target";

type RecorderCommand = PageTrackCommand | { kind: "hello" };

(function clipsPageTrackRecorder() {
  const installedFlag = "__clipsPageTrackRecorderInstalled";
  const page = window as unknown as Record<string, unknown>;
  if (page[installedFlag]) return;
  page[installedFlag] = true;

  const COMMAND_EVENT = "clips-page-track:command";
  const STATUS_EVENT = "clips-page-track:status";
  const EVENTS_EVENT = "clips-page-track:events";
  const FLUSH_INTERVAL_MS = 1_000;
  const GEOMETRY_INTERVAL_MS = 1_000;
  const MAX_PENDING_LINES = 500;
  const FULL_SNAPSHOT = 2;
  const privacy: PageTargetPrivacy = {
    blockSelector: SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
    maskTextClass: SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS,
    maskTextSelector: SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR,
  };

  let config: PageTrackRecorderConfig | null = null;
  let stopRecording: (() => void) | null = null;
  let lines: string[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let geometryTimer: ReturnType<typeof setInterval> | null = null;
  let lastViewport = "";

  const status = (kind: "ready" | "stopped"): void => {
    window.dispatchEvent(
      new CustomEvent(STATUS_EVENT, { detail: JSON.stringify({ kind }) }),
    );
  };

  const flush = (): void => {
    if (lines.length === 0) return;
    const batch = lines.join("\n");
    lines = [];
    window.dispatchEvent(new CustomEvent(EVENTS_EVENT, { detail: batch }));
  };

  const keepEvent = blockedFrameFilter(privacy.blockSelector, (id) =>
    record.mirror.getNode(id),
  );

  const emit = (event: { type: number; data?: unknown }): void => {
    if (!keepEvent(event)) return;
    lines.push(JSON.stringify(event));
    if (event.type === FULL_SNAPSHOT || lines.length >= MAX_PENDING_LINES) {
      flush();
    }
  };

  const custom = (tag: string, payload: Record<string, unknown>): void => {
    if (!stopRecording) return;
    try {
      record.addCustomEvent(tag, payload);
    } catch (error) {
      console.warn("[clips-page-track] custom event failed", tag, error);
    }
  };

  const emitViewport = (force: boolean): void => {
    if (!config) return;
    const screenWithOrigin = window.screen as Screen & {
      left?: number;
      top?: number;
    };
    const geometry = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      screenLeft:
        typeof screenWithOrigin.left === "number" ? screenWithOrigin.left : 0,
      screenTop:
        typeof screenWithOrigin.top === "number" ? screenWithOrigin.top : 0,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      devicePixelRatio: window.devicePixelRatio,
    };
    const viewport = viewportInCapture(
      config.capture,
      config.captureWidthPx,
      config.captureHeightPx,
      geometry,
    );
    const payload = {
      ...viewport,
      zoom: window.visualViewport?.scale ?? 1,
      window: geometry,
    };
    const key = JSON.stringify(payload);
    if (!force && key === lastViewport) return;
    lastViewport = key;
    custom("clips.viewport", payload);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!stopRecording) return;
    const path = event.composedPath();
    const first = path.length > 0 ? path[0] : event.target;
    if (!(first instanceof Element)) return;
    custom("clips.target", {
      ...describeTarget(first, (node) => record.mirror.getId(node), privacy),
      pointer: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      button: event.button,
      pointerType: event.pointerType,
    });
  };

  const onVisibilityChange = (): void => {
    custom(
      document.visibilityState === "hidden" ? "clips.hidden" : "clips.shown",
      {},
    );
  };

  const onResize = (): void => emitViewport(false);

  const start = (): void => {
    if (stopRecording || !config) return;
    const stop = record({
      emit,
      checkoutEveryNms: config.checkoutMs,
      blockSelector: SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
      ignoreSelector: SESSION_REPLAY_DEFAULT_IGNORE_SELECTOR,
      maskTextClass: SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS,
      maskTextSelector: SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR,
      maskAllInputs: false,
      maskInputOptions: { password: true },
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      sampling: { mousemove: 20, scroll: 100, media: 800, input: "last" },
    });
    if (typeof stop !== "function") return;
    stopRecording = stop;
    lastViewport = "";
    emitViewport(true);
    if (document.visibilityState === "hidden") custom("clips.hidden", {});
    flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    geometryTimer = setInterval(
      () => emitViewport(false),
      GEOMETRY_INTERVAL_MS,
    );
  };

  const halt = (): void => {
    if (flushTimer !== null) clearInterval(flushTimer);
    if (geometryTimer !== null) clearInterval(geometryTimer);
    flushTimer = null;
    geometryTimer = null;
    if (stopRecording) {
      stopRecording();
      stopRecording = null;
    }
    flush();
  };

  const parseCommand = (detail: unknown): RecorderCommand | null => {
    if (typeof detail !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(detail);
      return parsed && typeof parsed === "object"
        ? (parsed as RecorderCommand)
        : null;
    } catch {
      // coercion-ok: a message that isn't a command is ignored.
      return null;
    }
  };

  window.addEventListener(COMMAND_EVENT, (event) => {
    const command = parseCommand((event as CustomEvent<unknown>).detail);
    if (!command) return;
    switch (command.kind) {
      case "hello":
        status("ready");
        break;
      case "start":
        config = command.config;
        if (!command.paused) start();
        break;
      case "pause":
        halt();
        break;
      case "resume":
        start();
        break;
      case "stop":
        halt();
        config = null;
        status("stopped");
        break;
    }
  });

  document.addEventListener("pointerdown", onPointerDown, {
    capture: true,
    passive: true,
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", flush);
  status("ready");
})();
