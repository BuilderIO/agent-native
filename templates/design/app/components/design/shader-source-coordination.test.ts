import { describe, expect, it } from "vitest";

import {
  isShaderWriteInFlight,
  waitForShaderWriteToSettle,
  withShaderWriteLock,
} from "./shader-source-coordination";

describe("shader source write coordination", () => {
  it("serializes writes to the same file and settles the lock after a rejected write", async () => {
    const fileId = "shader-source-coordination-test";
    const events: string[] = [];
    let rejectFirst: (reason: Error) => void = () => undefined;
    const first = withShaderWriteLock(fileId, async () => {
      events.push("first-start");
      await new Promise<never>((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const second = withShaderWriteLock(fileId, async () => {
      events.push("second-start");
      return "saved";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    expect(isShaderWriteInFlight(fileId)).toBe(true);
    const settled = waitForShaderWriteToSettle(fileId);
    rejectFirst(new Error("write failed"));
    await expect(first).rejects.toThrow("write failed");
    await expect(second).resolves.toBe("saved");
    await settled;
    expect(events).toEqual(["first-start", "second-start"]);
    expect(isShaderWriteInFlight(fileId)).toBe(false);
  });
});
