type Publication = {
  assert: () => void;
  commit: () => void;
  rollback: () => void;
  retire: () => void;
};
type Completion = { ok: true } | { ok: false; error: unknown };
type Job = {
  ready: Promise<void>;
  markReady: () => void;
  completion: Promise<Completion>;
  complete: (result: Completion) => void;
  publication?: Publication;
  failure?: { error: unknown };
};

export class NativeStatelessFrameTransactionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failures: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "NativeStatelessFrameTransactionError";
  }
}

export class NativeStatelessFrameRetirementError extends Error {
  readonly code = "stateless-frame-retirement-failed";
  readonly phase = "retirement";
  readonly published = true;
  constructor(readonly failures: readonly unknown[]) {
    super(
      "The frame was published, but its prior resources could not all retire.",
    );
    this.name = "NativeStatelessFrameRetirementError";
  }
}

export class NativeStatelessFrameTransaction<Candidate> {
  private readonly jobs = new Map<string, Job>();
  private readonly candidates = new Map<string, Candidate>();
  private finishing: Promise<void> | null = null;

  register(id: string): void {
    if (this.finishing || this.jobs.has(id))
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-registration-invalid",
        "The frame job is duplicate or registration has closed.",
      );
    let markReady!: () => void;
    let complete!: (result: Completion) => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const completion = new Promise<Completion>((resolve) => {
      complete = resolve;
    });
    this.jobs.set(id, { ready, markReady, completion, complete });
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-job-missing",
        "The frame job was not registered.",
      );
    return job;
  }

  stage(id: string, candidates: ReadonlyMap<string, Candidate>): void {
    const job = this.job(id);
    if (job.publication || job.failure)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-stage-closed",
        "The frame job can no longer stage candidates.",
      );
    for (const [alias, candidate] of candidates) {
      if (
        this.candidates.has(alias) &&
        this.candidates.get(alias) !== candidate
      )
        throw new NativeStatelessFrameTransactionError(
          "stateless-frame-candidate-conflict",
          "Two frame jobs staged different outputs for the same dependency.",
        );
    }
    for (const [alias, candidate] of candidates)
      this.candidates.set(alias, candidate);
  }

  candidate(id: string): Candidate | undefined {
    return this.candidates.get(id);
  }
  hasCandidate(id: string): boolean {
    return this.candidates.has(id);
  }

  prepare(id: string, publication: Publication): Promise<void> {
    const job = this.job(id);
    if (job.failure)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-prepare-closed",
        "A failed frame job cannot prepare a successful publication.",
        [job.failure.error],
      );
    if (job.publication)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-prepare-duplicate",
        "The frame job already prepared its publication.",
      );
    job.publication = publication;
    job.markReady();
    return job.completion.then((result) => {
      if (!result.ok) throw result.error;
    });
  }

  fail(id: string, error: unknown): void {
    const job = this.job(id);
    if (!job.failure) job.failure = { error };
    job.markReady();
  }

  finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    const jobs = [...this.jobs.values()];
    this.finishing = (async () => {
      await Promise.all(jobs.map((job) => job.ready));
      try {
        for (const job of jobs) {
          if (job.failure) throw job.failure.error;
          if (!job.publication)
            throw new NativeStatelessFrameTransactionError(
              "stateless-frame-publication-missing",
              "A ready frame job has no publication candidate.",
            );
        }
        for (const job of jobs) job.publication!.assert();
        for (const job of jobs) job.publication!.commit();
      } catch (error) {
        const rollbackFailures: unknown[] = [];
        for (const job of [...jobs].reverse()) {
          if (!job.publication) continue;
          try {
            job.publication.rollback();
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        const failure = rollbackFailures.length
          ? new NativeStatelessFrameTransactionError(
              "stateless-frame-rollback-failed",
              "The rejected frame could not restore all retained outputs.",
              [error, ...rollbackFailures],
            )
          : error;
        for (const job of jobs) job.complete({ ok: false, error: failure });
        throw failure;
      }
      const retirementFailures: unknown[] = [];
      for (const job of jobs) {
        try {
          job.publication!.retire();
        } catch (error) {
          retirementFailures.push(error);
        }
      }
      if (retirementFailures.length) {
        const failure = new NativeStatelessFrameRetirementError(
          retirementFailures,
        );
        for (const job of jobs) job.complete({ ok: false, error: failure });
        throw failure;
      }
      for (const job of jobs) job.complete({ ok: true });
    })();
    return this.finishing;
  }
}
