import { describe, expect, it } from "vitest";

import { visibleQueuedRows } from "./queued-row-visibility";

const row = (id: string, text: string, delivery?: string) => ({
  id,
  text,
  ...(delivery ? { delivery } : {}),
});

describe("visibleQueuedRows", () => {
  it("hides a delivered Send now row once no run is active", () => {
    // the row outlived its run because nothing reconciled the queue snapshot with the
    // transcript. This is the display-layer guard, keyed on the transcript that proves delivery.
    const visible = visibleQueuedRows({
      active: false,
      queuedMessages: [row("queued-1", "Follow up", "steering")],
      messages: [{ role: "user", text: "Follow up" }],
    });
    expect(visible).toEqual([]);
  });

  it("keeps every row while a run is active", () => {
    const visible = visibleQueuedRows({
      active: true,
      queuedMessages: [row("queued-1", "Follow up", "steering")],
      messages: [{ role: "user", text: "Follow up" }],
    });
    expect(visible.map((entry) => entry.id)).toEqual(["queued-1"]);
  });

  it("keeps a row that is explicitly waiting for after_reply", () => {
    const visible = visibleQueuedRows({
      active: false,
      queuedMessages: [row("queued-1", "Follow up", "after_reply")],
      messages: [{ role: "user", text: "Follow up" }],
    });
    expect(visible.map((entry) => entry.id)).toEqual(["queued-1"]);
  });

  it("keeps a row whose text is not in the transcript", () => {
    const visible = visibleQueuedRows({
      active: false,
      queuedMessages: [row("queued-1", "Never sent", "steering")],
      messages: [{ role: "user", text: "Something else" }],
    });
    expect(visible.map((entry) => entry.id)).toEqual(["queued-1"]);
  });

  it("does not treat an assistant message as proof of delivery", () => {
    const visible = visibleQueuedRows({
      active: false,
      queuedMessages: [row("queued-1", "Follow up", "steering")],
      messages: [{ role: "assistant", text: "Follow up" }],
    });
    expect(visible.map((entry) => entry.id)).toEqual(["queued-1"]);
  });
});
