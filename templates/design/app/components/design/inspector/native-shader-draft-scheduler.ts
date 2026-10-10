export class NativeShaderDraftScheduler<Result> {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly delayMs: number) {}

  schedule(
    task: (signal: AbortSignal) => Promise<Result>,
    onResult: (result: Result) => void,
    onError: (error: unknown) => void,
  ): void {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (controller.signal.aborted || generation !== this.generation) return;
      void task(controller.signal).then(
        (result) => {
          if (!controller.signal.aborted && generation === this.generation)
            onResult(result);
        },
        (error) => {
          if (!controller.signal.aborted && generation === this.generation)
            onError(error);
        },
      );
    }, this.delayMs);
  }

  cancel(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }
}
