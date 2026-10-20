export class NativeSubmissionPipeline {
  private readonly tasks = new Map<
    string,
    { completion: Promise<void>; outcome: Promise<PromiseSettledResult<void>> }
  >();
  private lane = Promise.resolve();

  async acquireCommit(): Promise<() => void> {
    const previous = this.lane;
    let unlock!: () => void;
    this.lane = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        unlock();
      }
    };
  }

  pending(id: string): Promise<void> | undefined {
    return this.tasks.get(id)?.completion;
  }

  async submit(
    id: string,
    render: (submitted: () => void) => Promise<void>,
  ): Promise<void> {
    if (this.tasks.has(id)) throw new Error("native-submission-duplicate");
    let release!: () => void;
    const stage = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = Promise.resolve().then(async () => {
      const unlock = await this.acquireCommit();
      const submitted = () => {
        unlock();
        release();
      };
      try {
        await render(submitted);
      } finally {
        submitted();
      }
    });
    const outcome = task.then<
      PromiseSettledResult<void>,
      PromiseSettledResult<void>
    >(
      () => ({ status: "fulfilled", value: undefined }),
      (reason) => ({ status: "rejected", reason }),
    );
    this.tasks.set(id, { completion: task, outcome });
    await stage;
  }

  async flush(): Promise<PromiseSettledResult<void>[]> {
    const results = await Promise.all(
      [...this.tasks.values()].map((task) => task.outcome),
    );
    this.tasks.clear();
    return results;
  }
}
