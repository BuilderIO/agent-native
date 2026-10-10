import { describe, expect, it } from "vitest";

import { createNativeRuntimeEpoch } from "./native-runtime-epoch";

describe("createNativeRuntimeEpoch", () => {
  it("starts without randomUUID when getRandomValues exists", () => {
    let calls = 0;
    const source = {
      getRandomValues(values: Uint8Array): Uint8Array {
        calls += 1;
        values.fill(0xab);
        return values;
      },
    } as unknown as Partial<Pick<Crypto, "randomUUID" | "getRandomValues">>;
    expect(createNativeRuntimeEpoch(source)).toBe(`local-${"ab".repeat(16)}`);
    expect(calls).toBe(1);
  });

  it("keeps separate bounded correlation ids without Web Crypto", () => {
    const first = createNativeRuntimeEpoch(null);
    const second = createNativeRuntimeEpoch(null);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(80);
    expect(second.length).toBeLessThan(80);
  });
});
