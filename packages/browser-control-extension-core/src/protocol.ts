export type BrowserTarget = {
  observationId: string;
  backendNodeId: number;
};

export type BrowserKey =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "Backspace"
  | "Delete"
  | "End"
  | "Enter"
  | "Escape"
  | "Home"
  | "PageDown"
  | "PageUp"
  | "Space"
  | "Tab";

export type BrowserModifier = "alt" | "control" | "meta" | "shift";

export type BrowserCommand =
  | { type: "attach"; tabId: number; allowedOrigins: string[] }
  | { type: "detach" }
  | { type: "stop" }
  | {
      type: "observe";
      includeScreenshot?: boolean | undefined;
      maxNodes?: number | undefined;
    }
  | {
      type: "click";
      target: BrowserTarget;
      button?: "left" | "middle" | "right" | undefined;
    }
  | {
      type: "type";
      target: BrowserTarget;
      text: string;
      replace?: boolean | undefined;
    }
  | { type: "key"; key: BrowserKey; modifiers?: BrowserModifier[] }
  | { type: "navigate"; url: string }
  | { type: "open-tab"; url: string }
  | {
      type: "scroll";
      deltaX: number;
      deltaY: number;
      x?: number | undefined;
      y?: number | undefined;
    };

export type NativeRequest = {
  id: string;
  taskId: string;
  command: BrowserCommand;
};

export type NativeResponse =
  | { id: string; ok: true; result?: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

export type NativeHeartbeat = {
  type: "heartbeat";
  activeTasks: number;
  timestamp: string;
};
