import type { EffectTransform2D } from "@shared/native-effects";
import type {
  NativeInstancePreviewRequest,
  NativeInstancePreviewResult,
} from "@shared/native-instance-preview-contract";

type Identity = {
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  baseExecutionHash: string;
  baseInstanceSignature: string;
};

type Send = (
  request: NativeInstancePreviewRequest,
  signal: AbortSignal,
) => Promise<NativeInstancePreviewResult>;

let lastSequence = 0;

function nextSequence(): number {
  lastSequence = Math.max(lastSequence + 1, Date.now() * 1000);
  return lastSequence;
}

export class NativeInstanceScrubSession {
  private generation = 0;
  private pending: AbortController | null = null;
  private disposed = false;

  constructor(
    private readonly identity: Promise<Identity>,
    private readonly send: Send,
    private readonly onFailure: (
      error: unknown,
      type: NativeInstancePreviewRequest["type"],
    ) => void,
  ) {}

  preview(patch: {
    transform: EffectTransform2D | null;
    opacity: number;
  }): void {
    this.dispatch("native-effect-set-instance", patch);
  }

  clear(): void {
    this.dispatch("native-effect-clear-instance");
  }

  dispose(): void {
    if (this.disposed) return;
    this.dispatch("native-effect-clear-instance", undefined, true);
    this.disposed = true;
  }

  private dispatch(
    type: NativeInstancePreviewRequest["type"],
    patch?: { transform: EffectTransform2D | null; opacity: number },
    disposing = false,
  ): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    void this.identity
      .then(
        (identity) => {
          if (generation !== this.generation || controller.signal.aborted)
            return;
          const sequence = nextSequence();
          const common = {
            schemaVersion: 1 as const,
            requestId: `instance_${sequence}`,
            sequence,
            ...identity,
          };
          const request: NativeInstancePreviewRequest =
            type === "native-effect-set-instance"
              ? {
                  ...common,
                  type,
                  transform: patch!.transform,
                  opacity: patch!.opacity,
                }
              : { ...common, type };
          return this.send(request, controller.signal).then((result) => {
            if (
              generation === this.generation &&
              !this.disposed &&
              result.status === "error"
            )
              this.onFailure(result, type);
          });
        },
        (error) => {
          if (generation === this.generation && !this.disposed)
            this.onFailure(error, type);
        },
      )
      .catch((error: unknown) => {
        if (
          generation === this.generation &&
          !controller.signal.aborted &&
          !disposing &&
          !this.disposed
        )
          this.onFailure(error, type);
      });
  }
}
