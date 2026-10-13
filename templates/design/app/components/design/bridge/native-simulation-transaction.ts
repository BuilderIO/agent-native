export class NativeSimulationTransactionError extends Error {
  constructor(
    readonly code:
      | "simulation-transaction-invalid"
      | "simulation-transaction-closed"
      | "simulation-device-lost",
    cause?: unknown,
  ) {
    super(code);
    this.name = "NativeSimulationTransactionError";
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

export type NativeSimulationBank = 0 | 1 | 2;

export interface NativeSimulationBankStep {
  step: number;
  readBank: NativeSimulationBank;
  writeBank: NativeSimulationBank;
}

export interface NativeSimulationTransaction {
  readonly bankSteps: readonly NativeSimulationBankStep[];
  readonly finalBank: NativeSimulationBank;
  readonly finalStep: number;
  markSubmitted(): void;
  commit(validateBeforeCommit?: () => void): Promise<void>;
  abandon(): Promise<void>;
  rejectSubmitted(): Promise<void>;
}

export function createNativeSimulationTransaction(options: {
  committedBank: NativeSimulationBank;
  completedStep: number;
  steps: readonly number[];
  onSubmittedWorkDone(): Promise<void>;
  release(): void;
  promote(bank: NativeSimulationBank, step: number): void;
}): NativeSimulationTransaction {
  const { committedBank, completedStep, steps } = options;
  if (
    (committedBank !== 0 && committedBank !== 1 && committedBank !== 2) ||
    !Number.isSafeInteger(completedStep) ||
    completedStep < -1 ||
    steps.some(
      (step, index) =>
        !Number.isSafeInteger(step) ||
        step !== (index === 0 ? completedStep + 1 : steps[index - 1]! + 1),
    )
  )
    throw new NativeSimulationTransactionError(
      "simulation-transaction-invalid",
    );

  const workBanks = ([0, 1, 2] as const).filter(
    (bank) => bank !== committedBank,
  );
  let readBank: NativeSimulationBank = committedBank;
  const bankSteps = steps.map((step, index) => {
    const writeBank = workBanks[index % 2]!;
    const pair = { step, readBank, writeBank };
    readBank = writeBank;
    return pair;
  });
  const finalBank = readBank;
  const finalStep = steps.length ? steps[steps.length - 1]! : completedStep;
  let submitted = false;
  let closed = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    options.release();
  };
  const close = () => {
    if (closed)
      throw new NativeSimulationTransactionError(
        "simulation-transaction-closed",
      );
    closed = true;
  };
  return {
    bankSteps,
    finalBank,
    finalStep,
    markSubmitted() {
      if (closed || submitted)
        throw new NativeSimulationTransactionError(
          "simulation-transaction-closed",
        );
      submitted = true;
    },
    async commit(validateBeforeCommit) {
      if (!submitted || closed)
        throw new NativeSimulationTransactionError(
          "simulation-transaction-closed",
        );
      close();
      try {
        try {
          await options.onSubmittedWorkDone();
        } catch (cause) {
          throw new NativeSimulationTransactionError(
            "simulation-device-lost",
            cause,
          );
        }
        validateBeforeCommit?.();
        options.promote(finalBank, finalStep);
      } finally {
        release();
      }
    },
    async abandon() {
      if (closed) return;
      close();
      try {
        if (submitted) await options.onSubmittedWorkDone();
      } finally {
        release();
      }
    },
    async rejectSubmitted() {
      if (closed) return;
      close();
      try {
        if (submitted) await options.onSubmittedWorkDone();
      } finally {
        release();
      }
    },
  };
}
