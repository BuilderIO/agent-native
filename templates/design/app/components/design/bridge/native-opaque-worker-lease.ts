import { trustedOpaquePreviewParentOrigin } from "./native-preview-viewport-transport";
import type { NativeWorkerLease } from "./native-worker-broker";
import type {
  NativeWorkerFromGpu,
  NativeWorkerToGpu,
} from "./native-worker-protocol";

const READY = "native-public-worker-ready";
const CONNECT = "native-public-worker-connect";
const MESSAGE = "native-public-worker-message";
const FAILURE = "native-public-worker-failure";
const DISPOSE = "native-public-worker-dispose";
const PING = "native-public-worker-ping";
const PONG = "native-public-worker-pong";
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;

export function isOpaqueNativeWorkerPreview(): boolean {
  if (window.parent === window || location.origin !== "null") return false;
  return window.frameElement === null;
}

export function acquireOpaqueNativeWorkerLease(
  sceneId: string,
  listener: {
    message(message: NativeWorkerFromGpu): void;
    failure(code: string, message: string): void;
  },
): NativeWorkerLease {
  const nonce = document.querySelector<HTMLMetaElement>(
    'meta[name="an-native-public-worker-nonce"]',
  )?.content;
  if (!nonce || !NONCE.test(nonce))
    throw new Error("The public native GPU worker channel is unavailable.");
  const origin = trustedOpaquePreviewParentOrigin(document.referrer);
  let released = false;
  let connected: MessagePort | null = null;
  let queuedInit: {
    message: Extract<NativeWorkerToGpu, { type: "init" }>;
    transfer: Transferable[];
  } | null = null;
  const candidates = new Set<MessagePort>();
  let retry: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let loadListener: (() => void) | null = null;
  const clearHandshake = () => {
    if (retry !== null) clearInterval(retry);
    if (timeout !== null) clearTimeout(timeout);
    if (startTimer !== null) clearTimeout(startTimer);
    if (loadListener) window.removeEventListener("load", loadListener);
    retry = null;
    timeout = null;
    startTimer = null;
    loadListener = null;
    for (const candidate of candidates)
      if (candidate !== connected) candidate.close();
    candidates.clear();
  };
  const release = () => {
    if (released) return;
    released = true;
    clearHandshake();
    queuedInit = null;
    connected?.postMessage({ type: DISPOSE });
    connected?.close();
    connected = null;
  };
  const fail = (code: string, message: string) => {
    if (released) return;
    release();
    listener.failure(code, message);
  };
  const onMessage = (event: MessageEvent) => {
    if (released) return;
    const packet = event.data;
    if (packet?.type === PING && Number.isSafeInteger(packet.nonce)) {
      connected?.postMessage({ type: PONG, nonce: packet.nonce });
      return;
    }
    if (
      packet?.type === FAILURE &&
      typeof packet.code === "string" &&
      typeof packet.message === "string"
    ) {
      fail(packet.code, packet.message);
      return;
    }
    if (
      packet?.type !== MESSAGE ||
      !packet.message ||
      typeof packet.message !== "object" ||
      packet.message.sceneId !== sceneId
    ) {
      fail(
        "worker-public-response-invalid",
        "The public GPU worker response is invalid.",
      );
      return;
    }
    listener.message(packet.message as NativeWorkerFromGpu);
  };
  const sendReady = () => {
    if (released || connected || candidates.size >= 32) return;
    const channel = new MessageChannel();
    candidates.add(channel.port1);
    channel.port1.onmessage = (event: MessageEvent) => {
      if (released || connected) return;
      if (
        event.data?.type !== CONNECT ||
        event.data.nonce !== nonce ||
        event.data.sceneId !== sceneId
      )
        return;
      connected = channel.port1;
      connected.onmessage = onMessage;
      clearHandshake();
      if (queuedInit) {
        const pending = queuedInit;
        queuedInit = null;
        connected.postMessage(
          { type: MESSAGE, message: pending.message },
          pending.transfer,
        );
      }
    };
    channel.port1.start();
    try {
      window.parent.postMessage({ type: READY, nonce, sceneId }, origin, [
        channel.port2,
      ]);
    } catch {
      channel.port1.close();
      channel.port2.close();
      candidates.delete(channel.port1);
      fail(
        "worker-public-connect-failed",
        "The public GPU worker could not contact its host.",
      );
    }
  };
  const start = () => {
    if (released) return;
    sendReady();
    retry = setInterval(sendReady, 250);
    timeout = setTimeout(
      () =>
        fail(
          "worker-public-connect-timeout",
          "The public GPU worker did not connect to its host.",
        ),
      8_000,
    );
  };
  const afterLoad = () => {
    startTimer = setTimeout(start, 0);
  };
  if (document.readyState === "complete") afterLoad();
  else {
    loadListener = afterLoad;
    window.addEventListener("load", afterLoad, { once: true });
  }
  return {
    post(message, transfer = []) {
      if (released) throw new Error("The public GPU worker lease is closed.");
      if (connected) {
        connected.postMessage({ type: MESSAGE, message }, transfer);
        return;
      }
      if (message.type === "dispose") {
        release();
        return;
      }
      if (message.type !== "init" || queuedInit)
        throw new Error("The public GPU worker has not connected.");
      queuedInit = { message, transfer };
    },
    release,
  };
}
