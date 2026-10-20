export type NativeFrameSlot = 0 | 1 | 2;

export interface NativePreparedScheduledFrame {
  validate: Promise<void>;
  publish(): Promise<void>;
  reject(error: unknown): Promise<void>;
}

export type NativeBoundedFrameOutcome =
  | { status: "fulfilled"; slot: NativeFrameSlot }
  | { status: "rejected"; slot: NativeFrameSlot; reason: unknown };

export class NativeBoundedFrameSchedulerError extends Error {
  constructor(
    readonly code:
      | "frame-scheduler-full"
      | "frame-scheduler-cancelled"
      | "frame-scheduler-invalid-front"
      | "frame-scheduler-cleanup-failed",
    readonly reason?: unknown,
    readonly cleanupReason?: unknown,
  ) {
    super(code);
    this.name = "NativeBoundedFrameSchedulerError";
  }
}

type Prepared =
  | {
      status: "fulfilled";
      frame: NativePreparedScheduledFrame;
      validation: Promise<
        { status: "fulfilled" } | { status: "rejected"; reason: unknown }
      >;
    }
  | { status: "rejected"; reason: unknown };

type Job = {
  slot: NativeFrameSlot;
  completion: Promise<NativeBoundedFrameOutcome>;
};

export class NativeBoundedFrameScheduler {
  private front: NativeFrameSlot;
  private readonly jobs = new Set<Job>();
  private outcomes: NativeBoundedFrameOutcome[] = [];
  private encodeTail: Promise<void> = Promise.resolve();
  private publishTail: Promise<void> = Promise.resolve();
  private cancelled: { reason: unknown } | null = null;
  private encodingCount = 0;

  constructor(initialFront: NativeFrameSlot = 0) {
    if (![0, 1, 2].includes(initialFront))
      throw new NativeBoundedFrameSchedulerError(
        "frame-scheduler-invalid-front",
      );
    this.front = initialFront;
  }

  get frontSlot(): NativeFrameSlot {
    return this.front;
  }
  get pendingCount(): number {
    return this.jobs.size;
  }
  get encoding(): boolean {
    return this.encodingCount > 0;
  }
  get canSubmit(): boolean {
    return this.cancelled === null && this.jobs.size + this.outcomes.length < 2;
  }

  submit(
    prepare: (slot: NativeFrameSlot) => Promise<NativePreparedScheduledFrame>,
  ): Promise<NativeBoundedFrameOutcome> {
    if (this.cancelled)
      throw new NativeBoundedFrameSchedulerError(
        "frame-scheduler-cancelled",
        this.cancelled.reason,
      );
    if (!this.canSubmit)
      throw new NativeBoundedFrameSchedulerError("frame-scheduler-full");
    const occupied = new Set<NativeFrameSlot>([
      this.front,
      ...[...this.jobs].map((job) => job.slot),
    ]);
    const slot = ([0, 1, 2] as const).find((value) => !occupied.has(value));
    if (slot === undefined)
      throw new NativeBoundedFrameSchedulerError("frame-scheduler-full");
    let resolve!: (outcome: NativeBoundedFrameOutcome) => void;
    const completion = new Promise<NativeBoundedFrameOutcome>((done) => {
      resolve = done;
    });
    const job: Job = { slot, completion };
    this.jobs.add(job);
    let prepared!: Prepared;
    const encoded = this.encodeTail.then(async () => {
      this.encodingCount++;
      try {
        if (this.cancelled)
          throw new NativeBoundedFrameSchedulerError(
            "frame-scheduler-cancelled",
            this.cancelled.reason,
          );
        const frame = await prepare(slot);
        const validation = frame.validate.then(
          () => ({ status: "fulfilled" as const }),
          (reason) => ({ status: "rejected" as const, reason }),
        );
        prepared = { status: "fulfilled", frame, validation };
      } catch (reason) {
        prepared = { status: "rejected", reason };
      } finally {
        this.encodingCount--;
      }
    });
    this.encodeTail = encoded;
    this.publishTail = this.publishTail.then(async () => {
      await encoded;
      let outcome: NativeBoundedFrameOutcome;
      try {
        if (prepared.status === "rejected") throw prepared.reason;
        const validation = await prepared.validation;
        if (validation.status === "rejected") throw validation.reason;
        if (this.cancelled)
          throw new NativeBoundedFrameSchedulerError(
            "frame-scheduler-cancelled",
            this.cancelled.reason,
          );
        // Publication is FIFO; its atomic commit cannot be preempted once invoked.
        await prepared.frame.publish();
        this.front = slot;
        outcome = { status: "fulfilled", slot };
      } catch (reason) {
        if (prepared.status === "fulfilled") {
          try {
            await prepared.frame.reject(reason);
          } catch (cleanupReason) {
            reason = new NativeBoundedFrameSchedulerError(
              "frame-scheduler-cleanup-failed",
              reason,
              cleanupReason,
            );
          }
        }
        outcome = { status: "rejected", slot, reason };
      }
      this.jobs.delete(job);
      this.outcomes.push(outcome);
      resolve(outcome);
    });
    return completion;
  }

  takeOutcomes(): readonly NativeBoundedFrameOutcome[] {
    const outcomes = this.outcomes;
    this.outcomes = [];
    return outcomes;
  }

  // Concurrent takeOutcomes consumers own reporting; drain returns only uncollected outcomes.
  async drain(): Promise<readonly NativeBoundedFrameOutcome[]> {
    await Promise.all([...this.jobs].map((job) => job.completion));
    return this.takeOutcomes();
  }

  cancel(reason: unknown): void {
    if (this.cancelled === null) this.cancelled = { reason };
  }
}
