import { afterEach, describe, expect, it, vi } from "vitest";

import { getJobRunner, hasJobRunner, registerJobRunner } from "./job-runner.js";

describe("job runner registry", () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
  });

  it("looks up a registered runner by id and forgets it once disposed", () => {
    const runner = vi.fn(async () => ({ status: "success" as const }));
    const dispose = registerJobRunner("workflow", runner);
    disposers.push(dispose);

    expect(hasJobRunner("workflow")).toBe(true);
    expect(getJobRunner("workflow")).toBe(runner);
    expect(hasJobRunner("other")).toBe(false);
    expect(getJobRunner("other")).toBeUndefined();

    dispose();
    expect(hasJobRunner("workflow")).toBe(false);
    expect(getJobRunner("workflow")).toBeUndefined();
  });

  it("replaces a repeated registration and disposes only its own callback", () => {
    const first = vi.fn(async () => ({ status: "success" as const }));
    const next = vi.fn(async () => ({ status: "success" as const }));
    const disposeFirst = registerJobRunner("workflow", first);
    const disposeNext = registerJobRunner("workflow", next);
    disposers.push(disposeFirst, disposeNext);

    expect(getJobRunner("workflow")).toBe(next);
    disposeFirst();
    expect(getJobRunner("workflow")).toBe(next);
    disposeNext();
    expect(hasJobRunner("workflow")).toBe(false);
  });

  it("rejects a blank id instead of registering an unreachable runner", () => {
    expect(() =>
      registerJobRunner("  ", async () => ({ status: "success" })),
    ).toThrow(/Job runner id is required/);
  });
});
