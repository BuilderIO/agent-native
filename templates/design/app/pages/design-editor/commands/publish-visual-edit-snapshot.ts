import { isStandaloneHttpUrl } from "@shared/html-content";

export interface VisualEditSnapshotPublicationState {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  latest: Map<string, string>;
  latestReservationTokens: Map<string, string>;
  published: Map<string, string>;
  queue: Promise<void>;
}

export function createVisualEditSnapshotPublicationState(): VisualEditSnapshotPublicationState {
  return {
    timers: new Map(),
    latest: new Map(),
    latestReservationTokens: new Map(),
    published: new Map(),
    queue: Promise.resolve(),
  };
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
  if (args.reservationToken) {
    state.latestReservationTokens.set(fileId, args.reservationToken);
  } else {
    state.latestReservationTokens.delete(fileId);
  }
  const currentTimer = state.timers.get(fileId);
  if (currentTimer !== undefined) clearTimeout(currentTimer);
  state.timers.set(
    fileId,
    setTimeout(() => {
      state.timers.delete(fileId);
      state.queue = state.queue
        .catch(() => {})
        .then(async () => {
          const latestHtml = state.latest.get(fileId);
          if (!latestHtml || state.published.get(fileId) === latestHtml) return;

          const reservationToken = state.latestReservationTokens.get(fileId);
          if (!reservationToken) {
            args.showError(
              fileId,
              new Error("Visual Edit snapshot has no capture reservation"),
            );
            args.setFailed(true);
            return;
          }
          const result = await args.publish({
            designId,
            fileId,
            html: latestHtml,
            reservationToken,
          });
          if (result.published) state.published.set(fileId, latestHtml);
          args.setFailed(false);
        })
        .catch((error) => {
          args.showError(fileId, error);
          args.setFailed(true);
        });
    }, 250),
  );
}

export function runClearVisualEditSnapshotPublications(
  state: VisualEditSnapshotPublicationState,
): void {
  state.timers.forEach((timer) => clearTimeout(timer));
  state.timers.clear();
  state.latest.clear();
  state.latestReservationTokens.clear();
  state.published.clear();
}
