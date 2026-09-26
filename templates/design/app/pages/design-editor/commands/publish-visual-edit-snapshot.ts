import { isStandaloneHttpUrl } from "@shared/html-content";

export interface VisualEditSnapshotPublicationState {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  lastAttemptAt: Map<string, number>;
  latest: Map<string, string>;
  latestReservationTokens: Map<string, string>;
  published: Map<string, string>;
  generations: Map<string, number>;
  reservations: Map<string, Promise<void>>;
  queue: Promise<void>;
}

export function createVisualEditSnapshotPublicationState(): VisualEditSnapshotPublicationState {
  return {
    timers: new Map(),
    lastAttemptAt: new Map(),
    latest: new Map(),
    latestReservationTokens: new Map(),
    published: new Map(),
    generations: new Map(),
    reservations: new Map(),
    queue: Promise.resolve(),
  };
}

export function runReserveVisualEditSnapshotInOrder<T>(
  state: VisualEditSnapshotPublicationState,
  designId: string,
  fileId: string,
  reserve: () => Promise<T>,
): Promise<T> {
  const key = `${designId}:${fileId}`;
  const previous = state.reservations.get(key) ?? Promise.resolve();
  const request = previous.then(reserve);
  const queue = request.then(
    () => undefined,
    () => undefined,
  );
  state.reservations.set(key, queue);
  void queue.then(() => {
    if (state.reservations.get(key) === queue) {
      state.reservations.delete(key);
    }
  });
  return request;
}

export interface ScheduleVisualEditSnapshotPublicationArgs {
  canPublish: boolean;
  designId: string | null | undefined;
  fileId: string;
  html: string;
  reservationToken?: string;
  publish: (args: {
    designId: string;
    fileId: string;
    html: string;
    reservationToken: string;
  }) => Promise<{ published: boolean }>;
  setFailed: (failed: boolean) => void;
  showError: (fileId: string, error: unknown) => void;
  state: VisualEditSnapshotPublicationState;
}

export function runScheduleVisualEditSnapshotPublication(
  args: ScheduleVisualEditSnapshotPublicationArgs,
): void {
  const { canPublish, designId, fileId, html, state } = args;
  if (
    !designId ||
    !canPublish ||
    !html.trim() ||
    isStandaloneHttpUrl(html) ||
    state.published.get(fileId) === html
  ) {
    return;
  }

  state.latest.set(fileId, html);
  const generation = state.generations.get(fileId) ?? 0;
  if (args.reservationToken) {
    state.latestReservationTokens.set(fileId, args.reservationToken);
  } else {
    state.latestReservationTokens.delete(fileId);
  }
  const currentTimer = state.timers.get(fileId);
  if (currentTimer !== undefined) clearTimeout(currentTimer);
  const lastAttemptAt = state.lastAttemptAt.get(fileId);
  const throttleDelay =
    lastAttemptAt === undefined
      ? 0
      : Math.max(0, 2_000 - (Date.now() - lastAttemptAt));
  state.timers.set(
    fileId,
    setTimeout(
      () => {
        state.timers.delete(fileId);
        state.queue = state.queue
          .catch(() => {})
          .then(async () => {
            if ((state.generations.get(fileId) ?? 0) !== generation) return;
            const latestHtml = state.latest.get(fileId);
            if (!latestHtml || state.published.get(fileId) === latestHtml)
              return;

            const reservationToken = state.latestReservationTokens.get(fileId);
            if (!reservationToken) {
              args.showError(
                fileId,
                new Error("Visual Edit snapshot has no capture reservation"),
              );
              args.setFailed(true);
              return;
            }
            state.lastAttemptAt.set(fileId, Date.now());
            const result = await args.publish({
              designId,
              fileId,
              html: latestHtml,
              reservationToken,
            });
            if (
              result.published &&
              (state.generations.get(fileId) ?? 0) === generation
            ) {
              state.published.set(fileId, latestHtml);
            }
            args.setFailed(false);
          })
          .catch((error) => {
            args.showError(fileId, error);
            args.setFailed(true);
          });
      },
      Math.max(250, throttleDelay),
    ),
  );
}

export function runClearVisualEditSnapshotPublications(
  state: VisualEditSnapshotPublicationState,
): void {
  for (const fileId of new Set([
    ...state.timers.keys(),
    ...state.latest.keys(),
    ...state.published.keys(),
  ])) {
    state.generations.set(fileId, (state.generations.get(fileId) ?? 0) + 1);
  }
  state.timers.forEach((timer) => clearTimeout(timer));
  state.timers.clear();
  state.lastAttemptAt.clear();
  state.latest.clear();
  state.latestReservationTokens.clear();
  state.published.clear();
}

export function runInvalidateVisualEditSnapshotPublication(
  state: VisualEditSnapshotPublicationState,
  fileId: string,
): void {
  state.generations.set(fileId, (state.generations.get(fileId) ?? 0) + 1);
  const timer = state.timers.get(fileId);
  if (timer !== undefined) clearTimeout(timer);
  state.timers.delete(fileId);
  state.lastAttemptAt.delete(fileId);
  state.latest.delete(fileId);
  state.latestReservationTokens.delete(fileId);
  state.published.delete(fileId);
}
