import type {
  NativeWorkerFromGpu,
  NativeWorkerToGpu,
} from "./native-worker-protocol";

export class NativeWorkerBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeWorkerBrokerError";
  }
}

export function isNativeWorkerBrokerError(
  error: unknown,
): error is NativeWorkerBrokerError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NativeWorkerBrokerError" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.trim().length > 0 &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  );
}

export type NativeWorkerLease = {
  post(message: NativeWorkerToGpu, transfer?: Transferable[]): void;
  release(): void;
};

type Listener = {
  message(message: NativeWorkerFromGpu): void;
  failure(code: string, message: string): void;
};

type OwnerWindow = Window & typeof globalThis;

const BROKER_KEY = "__agentNativeDesignWorkerBrokerV1";

type BrokerWindow = OwnerWindow & {
  [BROKER_KEY]?: NativeWorkerBroker;
};

function addressedSceneId(message: NativeWorkerToGpu): string {
  return message.type === "scene" ? message.scene.sceneId : message.sceneId;
}

class WorkerPool {
  private readonly worker: Worker;
  private readonly url: string;
  private readonly listeners = new Map<string, Listener>();
  private closed = false;

  constructor(
    source: string,
    private readonly owner: OwnerWindow,
    private readonly onEmpty: () => void,
  ) {
    try {
      this.url = owner.URL.createObjectURL(
        new owner.Blob([source], { type: "text/javascript" }),
      );
    } catch (error) {
      throw new NativeWorkerBrokerError(
        "worker-start-failed",
        `The native GPU worker source could not be prepared: ${String(error)}`,
      );
    }
    try {
      this.worker = new owner.Worker(this.url);
    } catch (error) {
      owner.URL.revokeObjectURL(this.url);
      throw new NativeWorkerBrokerError(
        "worker-start-failed",
        `The native GPU worker could not start: ${String(error)}`,
      );
    }
    this.worker.onmessage = (event: MessageEvent<NativeWorkerFromGpu>) => {
      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        typeof message.sceneId !== "string" ||
        !message.sceneId
      ) {
        this.fail(
          "worker-response-unroutable",
          "The native GPU worker sent a response without a scene ID.",
        );
        return;
      }
      if (
        message.type === "error" &&
        (message.code === "gpu-device-lost" ||
          message.code === "gpu-uncaptured-error")
      ) {
        this.fail(message.code, message.message);
        return;
      }
      const listener = this.listeners.get(message.sceneId);
      // A released scene may reply after another scene has started using this worker.
      if (!listener) return;
      try {
        listener.message(message);
      } catch (error) {
        listener.failure(
          "worker-message-failed",
          `The native GPU worker response could not be handled: ${String(error)}`,
        );
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(
        "worker-failed",
        event.message || "The native GPU worker failed.",
      );
    };
    this.worker.onmessageerror = () => {
      this.fail(
        "worker-response-unroutable",
        "The native GPU worker sent an unreadable response.",
      );
    };
  }

  acquire(sceneId: string, listener: Listener): NativeWorkerLease {
    if (this.closed)
      throw new NativeWorkerBrokerError(
        "worker-disposed",
        "The native GPU worker is unavailable.",
      );
    if (this.listeners.has(sceneId))
      throw new NativeWorkerBrokerError(
        "worker-scene-duplicate",
        "The native GPU worker scene ID is already in use.",
      );
    this.listeners.set(sceneId, listener);
    let released = false;
    return {
      post: (message, transfer = []) => {
        if (released || this.closed)
          throw new NativeWorkerBrokerError(
            "worker-disposed",
            "The native GPU worker lease is unavailable.",
          );
        if (addressedSceneId(message) !== sceneId)
          throw new NativeWorkerBrokerError(
            "worker-scene-mismatch",
            "A native GPU worker message belongs to another scene.",
          );
        this.worker.postMessage(message, transfer);
      },
      release: () => {
        if (released) return;
        released = true;
        this.listeners.delete(sceneId);
        if (this.closed) return;
        if (!this.listeners.size) this.close();
      },
    };
  }

  private fail(code: string, message: string): void {
    if (this.closed) return;
    const listeners = [...this.listeners.values()];
    this.close();
    let callbackError: unknown;
    for (const listener of listeners)
      try {
        listener.failure(code, message);
      } catch (error) {
        callbackError ??= error;
      }
    if (callbackError !== undefined)
      this.owner.setTimeout(() => {
        throw callbackError;
      }, 0);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onEmpty();
    this.worker.terminate();
    this.owner.URL.revokeObjectURL(this.url);
    this.listeners.clear();
  }
}

export class NativeWorkerBroker {
  private readonly pools = new Map<string, WorkerPool>();

  constructor(private readonly owner: OwnerWindow) {}

  acquire(
    source: string,
    sceneId: string,
    listener: Listener,
  ): NativeWorkerLease {
    let pool = this.pools.get(source);
    if (!pool) {
      const created = new WorkerPool(source, this.owner, () => {
        if (this.pools.get(source) === created) this.pools.delete(source);
      });
      pool = created;
      this.pools.set(source, pool);
    }
    return pool.acquire(sceneId, listener);
  }
}

export function installNativeWorkerBroker(owner: OwnerWindow): void {
  const target = owner as BrokerWindow;
  if (target[BROKER_KEY]) return;
  Object.defineProperty(target, BROKER_KEY, {
    value: new NativeWorkerBroker(owner),
    configurable: true,
  });
}

export function acquireNativeWorkerLease(
  source: string,
  sceneId: string,
  listener: Listener,
): NativeWorkerLease {
  const owner = (window.frameElement?.ownerDocument.defaultView ??
    window) as BrokerWindow;
  const broker = owner[BROKER_KEY];
  return (broker ?? new NativeWorkerBroker(window)).acquire(
    source,
    sceneId,
    listener,
  );
}
