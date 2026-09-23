import { describe, expect, it, vi } from "vitest";

import {
  createRecordingFailureNotifier,
  type RecordingFailureNotification,
} from "./recording-failure-notifications";

const failure: RecordingFailureNotification = {
  kind: "upload",
  id: "example-clip-id",
  localCopyVerified: false,
  title: "Upload failed",
  body: "Open Clips to review recovery options.",
};

function setup() {
  const send = vi
    .fn()
    .mockResolvedValue({ status: "submitted", visibility: "unknown" });
  return { send, notify: createRecordingFailureNotifier({ send }) };
}

describe("recording failure notifications", () => {
  it.each(["start", "upload", "save"] as const)(
    "requests a native %s failure without exposing metadata",
    async (kind) => {
      const { send, notify } = setup();
      await expect(notify({ ...failure, kind })).resolves.toEqual({
        status: "submitted",
        visibility: "unknown",
      });
      expect(send).toHaveBeenCalledExactlyOnceWith({
        title: failure.title,
        body: failure.body,
      });
    },
  );

  it("deduplicates concurrent calls and polling for one stable attempt", async () => {
    const { send, notify } = setup();
    const results = await Promise.all([
      notify(failure),
      notify(failure),
      notify(failure),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "submitted",
      "duplicate",
      "duplicate",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not spam when the same clip changes failure kind", async () => {
    const { send, notify } = setup();
    await notify(failure);
    await expect(notify({ ...failure, kind: "save" })).resolves.toEqual({
      status: "duplicate",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows distinct recording attempts", async () => {
    const { send, notify } = setup();
    await notify(failure);
    await notify({ ...failure, id: "another-example-clip-id" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not notify later from polling after the user already saw the failure", async () => {
    const { send, notify } = setup();
    await expect(notify({ ...failure, visible: true })).resolves.toEqual({
      status: "suppressed",
    });
    await expect(notify(failure)).resolves.toEqual({ status: "duplicate" });
    expect(send).not.toHaveBeenCalled();
  });

  it("returns denial explicitly and does not retry it on polling", async () => {
    const { send, notify } = setup();
    send.mockResolvedValue({ status: "denied" });
    await expect(notify(failure)).resolves.toEqual({ status: "denied" });
    await expect(notify(failure)).resolves.toEqual({ status: "duplicate" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns backend failure without rejecting or retrying on polling", async () => {
    const { send, notify } = setup();
    send.mockResolvedValue({
      status: "failed",
      stage: "dispatch",
      reason: "backend",
    });
    await expect(notify(failure)).resolves.toEqual({
      status: "failed",
      stage: "dispatch",
      reason: "backend",
    });
    await expect(notify(failure)).resolves.toEqual({ status: "duplicate" });
  });

  it("contains unexpected sender rejection so recording cannot fail because of it", async () => {
    const { send, notify } = setup();
    send.mockRejectedValue(new Error("example transport failure"));
    await expect(notify(failure)).resolves.toEqual({
      status: "failed",
      reason: "unexpected",
    });
  });

  it("does not derive local safety or add a saved-copy claim", async () => {
    const { send, notify } = setup();
    await notify({ ...failure, localCopyVerified: false });
    expect(send.mock.calls[0][0]).toEqual({
      title: failure.title,
      body: failure.body,
    });
    await notify({
      ...failure,
      id: "verified-example",
      localCopyVerified: true,
      body: "Saved on this device. Open Clips to retry.",
    });
    expect(send.mock.calls[1][0].body).toBe(
      "Saved on this device. Open Clips to retry.",
    );
  });

  it.each([
    { kind: "success" },
    { id: " " },
    { title: "" },
    { body: "" },
    { localCopyVerified: undefined },
  ])("rejects invalid or success payloads: %j", async (invalid) => {
    const { send, notify } = setup();
    await expect(
      notify({ ...failure, ...invalid } as RecordingFailureNotification),
    ).resolves.toEqual({ status: "failed", reason: "invalid-request" });
    expect(send).not.toHaveBeenCalled();
  });
});
