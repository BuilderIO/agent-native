import { afterEach, describe, expect, it, vi } from "vitest";

const deliverMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./remote-push-delivery.js", () => ({
  deliverPendingRemotePushNotifications: deliverMock,
}));

async function loadJob() {
  vi.resetModules();
  return import("./remote-push-delivery-job.js");
}

describe("remote push delivery job", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the delayed start on stop so later ticks do not run", async () => {
    vi.useFakeTimers();
    const { startRemotePushDeliveryJob, stopRemotePushDeliveryJob } =
      await loadJob();

    startRemotePushDeliveryJob();
    stopRemotePushDeliveryJob();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("stops an already-started interval so it cannot keep the process alive", async () => {
    vi.useFakeTimers();
    const { startRemotePushDeliveryJob, stopRemotePushDeliveryJob } =
      await loadJob();

    startRemotePushDeliveryJob();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    expect(deliverMock).toHaveBeenCalled();

    deliverMock.mockClear();
    stopRemotePushDeliveryJob();
    await vi.advanceTimersByTimeAsync(180_000);
    await Promise.resolve();

    expect(deliverMock).not.toHaveBeenCalled();
  });
});
