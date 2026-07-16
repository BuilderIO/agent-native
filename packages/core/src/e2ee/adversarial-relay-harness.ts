/**
 * Deterministic malicious hosted-relay harness for E2EE protocol tests.
 * It never interprets plaintext or keys; it only mutates opaque envelopes in
 * the ways the endpoint verifier must detect or fail closed against.
 */
export interface RelayHarnessEnvelope {
  readonly id: string;
  readonly kind: string;
  readonly sequence: number;
  readonly bytes: Uint8Array;
  readonly jobId?: string;
}

export type RelayAttackScenario =
  | { readonly attack: "withhold"; readonly envelopeId: string }
  | { readonly attack: "replay"; readonly envelopeId: string }
  | { readonly attack: "rollback"; readonly maximumSequence: number }
  | {
      readonly attack: "fork";
      readonly sequence: number;
      readonly replacement: RelayHarnessEnvelope;
    }
  | {
      readonly attack: "swap-results";
      readonly leftJobId: string;
      readonly rightJobId: string;
    }
  | {
      readonly attack: "inject-unsigned-endpoint";
      readonly envelope: RelayHarnessEnvelope;
    };

function cloneEnvelope(envelope: RelayHarnessEnvelope): RelayHarnessEnvelope {
  return {
    ...envelope,
    bytes: new Uint8Array(envelope.bytes),
  };
}

export class AdversarialRelayHarness {
  readonly #envelopes: RelayHarnessEnvelope[] = [];

  append(envelope: RelayHarnessEnvelope): void {
    if (
      !envelope.id ||
      !envelope.kind ||
      !Number.isSafeInteger(envelope.sequence) ||
      envelope.sequence < 0 ||
      envelope.bytes.byteLength === 0
    ) {
      throw new Error("Relay harness envelope is invalid");
    }
    this.#envelopes.push(cloneEnvelope(envelope));
  }

  snapshot(): RelayHarnessEnvelope[] {
    return this.#envelopes.map(cloneEnvelope);
  }

  serve(scenario?: RelayAttackScenario): RelayHarnessEnvelope[] {
    const served = this.snapshot();
    if (!scenario) return served;
    switch (scenario.attack) {
      case "withhold":
        return served.filter((entry) => entry.id !== scenario.envelopeId);
      case "replay": {
        const target = served.find((entry) => entry.id === scenario.envelopeId);
        return target ? [...served, cloneEnvelope(target)] : served;
      }
      case "rollback":
        return served.filter(
          (entry) => entry.sequence <= scenario.maximumSequence,
        );
      case "fork":
        return served.map((entry) =>
          entry.sequence === scenario.sequence
            ? cloneEnvelope(scenario.replacement)
            : entry,
        );
      case "swap-results": {
        const left = served.find((entry) => entry.jobId === scenario.leftJobId);
        const right = served.find(
          (entry) => entry.jobId === scenario.rightJobId,
        );
        if (!left || !right) return served;
        return served.map((entry) => {
          if (entry.id === left.id) return { ...entry, bytes: right.bytes };
          if (entry.id === right.id) return { ...entry, bytes: left.bytes };
          return entry;
        });
      }
      case "inject-unsigned-endpoint":
        return [...served, cloneEnvelope(scenario.envelope)];
    }
  }
}
