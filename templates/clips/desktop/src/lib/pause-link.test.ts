import { beforeEach, describe, expect, it, vi } from "vitest";

const { emit, invoke, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { listenForPauseLinks, takePauseLinkOnInstall } from "./pause-link";

describe("clips://pause links", () => {
  beforeEach(() => {
    emit.mockReset().mockResolvedValue(undefined);
    invoke.mockReset();
    listen.mockReset();
  });

  it.each([
    { waiting: "pause", event: "clips:recorder-pause" },
    { waiting: "resume", event: "clips:recorder-resume" },
    { waiting: "toggle", event: "clips:recorder-toggle-pause" },
  ])(
    "a $waiting link held while the recorder set up is delivered once its listeners are",
    async ({ waiting, event }) => {
      invoke.mockResolvedValueOnce(waiting).mockResolvedValue(null);
      takePauseLinkOnInstall();
      await vi.waitFor(() => expect(emit).toHaveBeenCalledWith(event));
      expect(invoke).toHaveBeenCalledWith("take_pending_pause_link");
    },
  );

  it("takes a link from its event, and delivers nothing when none waits", async () => {
    let deliver!: () => void;
    listen.mockImplementation(async (_event: string, handler: () => void) => {
      deliver = handler;
      return vi.fn();
    });
    await listenForPauseLinks();
    expect(listen).toHaveBeenCalledWith(
      "clips:pause-link",
      expect.any(Function),
    );

    invoke.mockResolvedValueOnce("pause").mockResolvedValue(null);
    deliver();
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("clips:recorder-pause"),
    );
    deliver();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
