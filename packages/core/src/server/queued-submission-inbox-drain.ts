export function scheduleQueuedSubmissionInboxDrain(input: {
  threadId: string;
  turnContinues: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  drain: (input: { threadId: string }) => Promise<unknown>;
  onError: (error: unknown) => void;
}): void {
  if (input.turnContinues) return;
  const drain = Promise.resolve()
    .then(() => input.drain({ threadId: input.threadId }))
    .catch(input.onError);
  if (input.waitUntil) input.waitUntil(drain);
  else void drain;
}
