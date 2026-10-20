export class NativeParameterPreviewQueue {
  private pending = new Map<string, Record<string, unknown>>();
  private running = false;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly validate: (
      instanceId: string,
      params: Record<string, unknown>,
    ) => void,
    private readonly apply: (
      instanceId: string,
      params: Record<string, unknown>,
      isCurrent: () => boolean,
    ) => Promise<void>,
    private readonly onFailure: (instanceId: string, error: unknown) => void,
  ) {}

  enqueue(instanceId: string, params: Record<string, unknown>): void {
    if (this.disposed) return;
    try {
      this.validate(instanceId, params);
    } catch (error) {
      this.onFailure(instanceId, error);
      return;
    }
    this.pending.set(instanceId, {
      ...this.pending.get(instanceId),
      ...params,
    });
    void this.drain();
  }

  reset(): void {
    this.generation += 1;
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed && this.pending.size) {
        const [instanceId, params] = this.pending.entries().next().value!;
        this.pending.delete(instanceId);
        const generation = this.generation;
        const isCurrent = () =>
          !this.disposed && this.generation === generation;
        try {
          this.validate(instanceId, params);
          await this.apply(instanceId, params, isCurrent);
        } catch (error) {
          if (isCurrent()) this.onFailure(instanceId, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
