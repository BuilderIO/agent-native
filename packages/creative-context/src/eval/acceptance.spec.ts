import { describe, expect, it } from "vitest";

import { CREATIVE_CONTEXT_ACCEPTANCE_CASES } from "./acceptance-fixtures.js";
import {
  assertContextAcceptanceGates,
  ContextAcceptanceReportSchema,
  createBlindPreferencePacket,
  runContextAcceptanceEvaluation,
  scoreBlindPreferences,
} from "./acceptance.js";

describe("deterministic context-on versus context-off acceptance", () => {
  it("emits a stable schema-valid report and passes correctness gates", () => {
    const input = {
      corpusId: "creative-context-realistic-v1",
      cases: CREATIVE_CONTEXT_ACCEPTANCE_CASES,
    };
    const first = runContextAcceptanceEvaluation(input);
    const repeated = runContextAcceptanceEvaluation(input);

    expect(repeated).toEqual(first);
    expect(ContextAcceptanceReportSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      runId: expect.stringMatching(/^cc-eval-[a-f0-9]{16}$/),
      summary: {
        caseCount: 4,
        contextOnWins: 4,
        contextOffWins: 0,
        ties: 0,
        contextOnWinRate: 1,
        contextOnRequiredTermCoverage: 1,
        forbiddenOutputHits: 0,
        missingContextPacks: 0,
        missingProvenance: 0,
        optOutContamination: 0,
      },
      gates: { passed: true, failures: [] },
      manualBlindPreference: {
        status: "pending",
        scoredTrials: 0,
        contextOnPreferenceRate: null,
      },
    });
    expect(() => assertContextAcceptanceGates(first)).not.toThrow();
  });

  it("fails on injection output, missing provenance, or context-off contamination", () => {
    const broken = structuredClone(CREATIVE_CONTEXT_ACCEPTANCE_CASES);
    broken[0]!.contextOn.output += " INJECTION_EXECUTED";
    broken[1]!.contextOn.provenanceKeys = [];
    broken[2]!.contextOff.usedContextKeys = ["notion:leaked-context"];
    const report = runContextAcceptanceEvaluation({
      corpusId: "creative-context-adversarial-failure",
      cases: broken,
      thresholds: { minimumContextOnWinRate: 0 },
    });

    expect(report.gates).toMatchObject({ passed: false });
    expect(report.gates.failures).toEqual(
      expect.arrayContaining([
        "forbidden output was emitted",
        "provenance is incomplete",
        "context-off contains context evidence",
      ]),
    );
    expect(() => assertContextAcceptanceGates(report)).toThrow(
      /forbidden output.*provenance.*context-off/i,
    );
  });

  it("creates a repeatable blind packet while keeping the answer key separate", () => {
    const packet = createBlindPreferencePacket(
      CREATIVE_CONTEXT_ACCEPTANCE_CASES,
    );
    expect(
      createBlindPreferencePacket(CREATIVE_CONTEXT_ACCEPTANCE_CASES),
    ).toEqual(packet);
    expect(packet.worksheet).toHaveLength(4);
    expect(packet.answerKey).toHaveLength(4);
    expect(JSON.stringify(packet.worksheet)).not.toContain(
      "contextOnCandidate",
    );
    const preferences = Object.fromEntries(
      packet.answerKey.map((entry) => [entry.caseId, entry.contextOnCandidate]),
    );
    expect(scoreBlindPreferences(packet.answerKey, preferences)).toEqual({
      scoredTrials: 4,
      contextOnPreferenceRate: 1,
    });
  });
});
