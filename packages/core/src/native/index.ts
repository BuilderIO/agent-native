import type { NativeManifest } from "../app-config/schema.js";

export type NativeCapability = NativeManifest["uses"][number];
export type NativeUnavailable = { status: "unavailable"; reason: string };
export type NativeCallResult<T = unknown> =
  | { status: "ok"; value: T }
  | NativeUnavailable;
export type NativeSubscription =
  | { status: "ok"; unsubscribe(): void }
  | NativeUnavailable;

export interface NativeBridge {
  call<T = unknown>(
    capability: NativeCapability,
    method: string,
    args: unknown,
  ): Promise<NativeCallResult<T>>;
  on(
    capability: NativeCapability,
    event: string,
    callback: (value: unknown) => void,
  ): Promise<NativeSubscription>;
}

declare global {
  interface Window {
    agentNative?: { native: NativeBridge };
  }
}

const unavailable = (): NativeUnavailable => ({
  status: "unavailable",
  reason: "Desktop shell unavailable",
});

export const native: NativeBridge = {
  call: (capability, method, args) => {
    const bridge =
      typeof window === "undefined" ? undefined : window.agentNative?.native;
    return bridge
      ? bridge.call(capability, method, args)
      : Promise.resolve(unavailable());
  },
  on: (capability, event, callback) => {
    const bridge =
      typeof window === "undefined" ? undefined : window.agentNative?.native;
    return bridge
      ? bridge.on(capability, event, callback)
      : Promise.resolve(unavailable());
  },
};
