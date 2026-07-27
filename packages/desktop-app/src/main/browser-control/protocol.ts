export type BrowserTarget = { observationId: string; backendNodeId: number };

export type BrowserCommand =
  | { type: "attach"; tabId: number; allowedOrigins: string[] }
  | { type: "detach" }
  | { type: "stop" }
  | { type: "observe"; includeScreenshot?: boolean; maxNodes?: number }
  | {
      type: "click";
      target: BrowserTarget;
      button?: "left" | "middle" | "right";
    }
  | { type: "type"; target: BrowserTarget; text: string; replace?: boolean }
  | {
      type: "key";
      key:
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
      modifiers?: Array<"alt" | "control" | "meta" | "shift">;
    }
  | { type: "navigate"; url: string }
  | {
      type: "scroll";
      deltaX: number;
      deltaY: number;
      x?: number;
      y?: number;
    };

export type BrowserNativeRequest = {
  id: string;
  taskId: string;
  command: BrowserCommand;
};

export type BrowserNativeResponse =
  | { id: string; ok: true; result?: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

export type BrowserNativeHeartbeat = {
  type: "heartbeat";
  activeTasks: number;
  timestamp: string;
};

export type BrowserTaskRegistration = {
  taskId: string;
  taskToken: string;
};

export type BrowserHostBridgeRegistration = {
  baseUrl: string;
  bearerToken: string;
};
