import { describe, expect, it } from "vitest";
import { captureCliOutput } from "./cli-capture.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cli-capture", () => {
  it("keeps concurrent capture buffers isolated", async () => {
    const [first, second] = await Promise.all([
      captureCliOutput(async () => {
        console.log("first:start");
        await delay(10);
        process.stdout.write("first:end");
      }),
      captureCliOutput(async () => {
        console.log("second:start");
        await delay(1);
        process.stdout.write("second:end");
      }),
    ]);

    expect(first).toContain("first:start");
    expect(first).toContain("first:end");
    expect(first).not.toContain("second:");
    expect(second).toContain("second:start");
    expect(second).toContain("second:end");
    expect(second).not.toContain("first:");
  });

  it("captures process.exit without terminating sibling captures", async () => {
    const [exited, sibling] = await Promise.all([
      captureCliOutput(async () => {
        console.log("before exit");
        process.exit(0);
      }),
      captureCliOutput(async () => {
        await delay(1);
        console.log("sibling survived");
      }),
    ]);

    expect(exited).toContain("before exit");
    expect(sibling).toContain("sibling survived");
  });
});
