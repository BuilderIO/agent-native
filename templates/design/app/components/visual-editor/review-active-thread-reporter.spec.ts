import { describe, expect, it, vi } from "vitest";

import { createReviewActiveThreadReporter } from "./review-active-thread-reporter";

describe("createReviewActiveThreadReporter", () => {
  const setup = () => {
    const publish = vi.fn();
    return { publish, report: createReviewActiveThreadReporter(publish) };
  };

  it("publishes the thread a reporter opens, and null when it closes", () => {
    const { publish, report } = setup();

    report("thread-a", "overlay-a");
    expect(publish).toHaveBeenLastCalledWith("thread-a");

    report(null, "overlay-a");
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it("ignores a reporter closing a thread another reporter opened after it", () => {
    const { publish, report } = setup();
    report("thread-a", "overlay-a");
    report("thread-b", "overlay-b");

    report(null, "overlay-a");

    expect(publish).toHaveBeenLastCalledWith("thread-b");
    expect(publish.mock.calls.map(([id]) => id)).not.toContain(null);

    report(null, "overlay-b");
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it("falls back to the thread still open elsewhere", () => {
    const { publish, report } = setup();
    report("thread-a", "overlay-a");
    report("thread-b", "overlay-b");

    report(null, "overlay-b");

    expect(publish).toHaveBeenLastCalledWith("thread-a");
  });

  it("lets a reporter that switches threads take the latest place again", () => {
    const { publish, report } = setup();
    report("thread-a", "overlay-a");
    report("thread-b", "overlay-b");

    report("thread-c", "overlay-a");
    expect(publish).toHaveBeenLastCalledWith("thread-c");

    report(null, "overlay-a");
    expect(publish).toHaveBeenLastCalledWith("thread-b");
  });

  it("keeps another reporter's thread when a reporter that never opened one reports null", () => {
    const { publish, report } = setup();
    report("thread-a", "overlay-a");

    report(null, "overlay-idle");

    expect(publish).toHaveBeenLastCalledWith("thread-a");
  });
});
