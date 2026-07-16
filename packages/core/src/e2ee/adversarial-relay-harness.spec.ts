import { describe, expect, it } from "vitest";

import {
  AdversarialRelayHarness,
  type RelayHarnessEnvelope,
} from "./adversarial-relay-harness.js";

function fixture(
  id: string,
  sequence: number,
  jobId?: string,
): RelayHarnessEnvelope {
  return {
    id,
    kind: jobId ? "result" : "log-entry",
    sequence,
    bytes: Uint8Array.of(sequence + 1, sequence + 2),
    ...(jobId ? { jobId } : {}),
  };
}

describe("adversarial relay harness", () => {
  it("emits withholding, replay, rollback, and fork scenarios", () => {
    const relay = new AdversarialRelayHarness();
    relay.append(fixture("entry-0", 0));
    relay.append(fixture("entry-1", 1));

    expect(
      relay.serve({ attack: "withhold", envelopeId: "entry-1" }),
    ).toHaveLength(1);
    expect(
      relay.serve({ attack: "replay", envelopeId: "entry-0" }),
    ).toHaveLength(3);
    expect(
      relay.serve({ attack: "rollback", maximumSequence: 0 }),
    ).toHaveLength(1);
    expect(
      relay.serve({
        attack: "fork",
        sequence: 1,
        replacement: { ...fixture("fork-1", 1), bytes: Uint8Array.of(99) },
      })[1],
    ).toMatchObject({ id: "fork-1", sequence: 1 });
  });

  it("swaps opaque result bodies without changing their claimed job IDs", () => {
    const relay = new AdversarialRelayHarness();
    relay.append(fixture("result-a", 1, "job-a"));
    relay.append(fixture("result-b", 2, "job-b"));

    const original = relay.snapshot();
    const attacked = relay.serve({
      attack: "swap-results",
      leftJobId: "job-a",
      rightJobId: "job-b",
    });
    expect(attacked[0].jobId).toBe("job-a");
    expect(attacked[0].bytes).toEqual(original[1].bytes);
    expect(attacked[1].jobId).toBe("job-b");
    expect(attacked[1].bytes).toEqual(original[0].bytes);
  });

  it("injects unsigned endpoint material for verifier rejection tests", () => {
    const relay = new AdversarialRelayHarness();
    const injected = {
      ...fixture("unsigned-endpoint", 0),
      kind: "endpoint",
    };
    expect(
      relay.serve({
        attack: "inject-unsigned-endpoint",
        envelope: injected,
      }),
    ).toEqual([injected]);
  });

  it("clones opaque bytes so tests cannot mutate relay state accidentally", () => {
    const relay = new AdversarialRelayHarness();
    relay.append(fixture("entry-0", 0));
    const first = relay.snapshot();
    first[0].bytes[0] = 255;
    expect(relay.snapshot()[0].bytes[0]).toBe(1);
  });
});
