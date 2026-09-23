import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRAIN_SETTINGS } from "../../shared/types.js";
import { sanitizeCaptureForStorage } from "./capture-sanitization.js";
import {
  classifyWithJev,
  clearJevScoreCache,
  jevSensitivityDecision,
  requestJevSensitivityScores,
  resolveClassifierPreference,
  resolveJevAuth,
  runJevClassification,
  WORKSPACE_RULE_QUESTION,
  type JevAuth,
  type JevCategoryScores,
} from "./jev-classifier.js";
import { BRAIN_SENSITIVITY_CATEGORIES } from "./search-index-contracts.js";

const resolveSourceCredential = vi.hoisted(() => vi.fn());
const resolveBuilderGatewayAuth = vi.hoisted(() => vi.fn());
const getCredentialContext = vi.hoisted(() => vi.fn());
const getBuilderProxyOrigin = vi.hoisted(() => vi.fn());
const runWithRequestContext = vi.hoisted(() =>
  vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
);

vi.mock("./source-credentials.js", () => ({ resolveSourceCredential }));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext,
  resolveBuilderGatewayAuth,
  getBuilderProxyOrigin,
  runWithRequestContext,
}));

const CAPTURED_AT = "2026-05-20T15:00:00.000Z";
const CLEAN_BODY = "Decision: ship the retrieval API before the launch review.";

function scoresWith(overrides: JevCategoryScores = {}): JevCategoryScores {
  return Object.fromEntries(
    BRAIN_SENSITIVITY_CATEGORIES.map((category) => [
      category,
      overrides[category] ?? 0.01,
    ]),
  );
}

function fetchCallArgs(mock: { mock: { calls: unknown[][] } }) {
  const [url, init] = mock.mock.calls[0] ?? [];
  if (typeof url !== "string" || !init) {
    throw new Error("fetch was not called");
  }
  return { url, init: init as RequestInit };
}

function jevResponse(scores: JevCategoryScores) {
  return {
    ok: true,
    json: async () => ({
      answers: Object.fromEntries(
        Object.entries(scores).map(([category, noul]) => [category, { noul }]),
      ),
    }),
  } as unknown as Response;
}

beforeEach(() => {
  clearJevScoreCache();
  resolveSourceCredential.mockReset();
  resolveBuilderGatewayAuth.mockReset();
  getCredentialContext.mockReset().mockReturnValue(null);
  getBuilderProxyOrigin.mockReset().mockReturnValue("https://proxy.test/");
  runWithRequestContext
    .mockReset()
    .mockImplementation((_ctx: unknown, fn: () => unknown) => fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifier preference", () => {
  it("defaults to Jev and honours an explicit choice", () => {
    expect(resolveClassifierPreference(DEFAULT_BRAIN_SETTINGS)).toBe("jev");
    expect(resolveClassifierPreference({ ...DEFAULT_BRAIN_SETTINGS })).toBe(
      "jev",
    );
    expect(
      resolveClassifierPreference({
        ...DEFAULT_BRAIN_SETTINGS,
        privacyClassifier: "deterministic",
      }),
    ).toBe("deterministic");
    expect(
      resolveClassifierPreference({
        ...DEFAULT_BRAIN_SETTINGS,
        privacyClassifier: "model",
      }),
    ).toBe("model");
  });
});

describe("probability to disposition mapping", () => {
  it("allows a capture every category scores comfortably low", () => {
    const decision = jevSensitivityDecision(scoresWith(), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("allowed");
    expect(decision.categories).toEqual([]);
    expect(decision.confidenceBand).toBe("high");
    expect(decision.classifier).toBe("jev");
    expect(decision.safeContent).toContain("ship the retrieval API");
  });

  it("quarantines and names the category when one clears the block bar", () => {
    const decision = jevSensitivityDecision(scoresWith({ performance: 0.92 }), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("quarantined");
    expect(decision.categories).toEqual(["performance"]);
    expect(decision.confidenceBand).toBe("high");
    expect(decision.categoryScores?.performance).toBe(0.92);
  });

  it("reports medium confidence just above the block bar", () => {
    const decision = jevSensitivityDecision(scoresWith({ compensation: 0.7 }), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("quarantined");
    expect(decision.categories).toEqual(["compensation"]);
    expect(decision.confidenceBand).toBe("medium");
  });

  it("fails closed on the uncertain middle band without naming a category", () => {
    const decision = jevSensitivityDecision(scoresWith({ recruiting: 0.45 }), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("quarantined");
    expect(decision.categories).toEqual([]);
    expect(decision.confidenceBand).toBe("uncertain");
  });

  it("quarantines when the deterministic screen leaves no safe content", () => {
    const decision = jevSensitivityDecision(scoresWith(), {
      judgedContent: "api key: not-a-real-secret-value",
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("quarantined");
    expect(decision.safeContent).toBe("");
    expect(decision.safeSegments).toEqual([]);
  });
});

describe("review fixes", () => {
  const input = {
    title: "Planning transcript",
    content: CLEAN_BODY,
    capturedAt: CAPTURED_AT,
    settings: DEFAULT_BRAIN_SETTINGS,
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  };

  it("quarantines when the capture was too long for Jev to see in full", () => {
    const decision = jevSensitivityDecision(scoresWith(), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: true,
    });

    expect(decision.disposition).toBe("quarantined");
  });

  it("treats a score exactly on the allow bar as uncertain", () => {
    const decision = jevSensitivityDecision(scoresWith({ personal: 0.2 }), {
      judgedContent: CLEAN_BODY,
      capturedAt: CAPTURED_AT,
      truncated: false,
    });

    expect(decision.disposition).toBe("quarantined");
    expect(decision.confidenceBand).toBe("uncertain");
  });

  it("rejects an out-of-range probability instead of clamping it to safe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jevResponse(
          Object.fromEntries(
            BRAIN_SENSITIVITY_CATEGORIES.map((c) => [c, -1]),
          ) as JevCategoryScores,
        ),
      ),
    );

    await expect(
      requestJevSensitivityScores(
        { source: "stored-key", apiKey: "not-a-real-key" },
        { title: "Planning", body: CLEAN_BODY },
      ),
    ).rejects.toThrow(/out-of-range/);
  });

  it("resolves the credential with the capture owner, not the ambient request user", async () => {
    getCredentialContext.mockReturnValue({
      userEmail: "editor@example.com",
      orgId: "org-2",
    });
    resolveSourceCredential.mockResolvedValue("not-a-real-key");

    await resolveJevAuth({ ownerEmail: "owner@example.com", orgId: "org-1" });

    expect(resolveSourceCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: { userEmail: "owner@example.com", orgId: "org-1" },
      }),
    );
  });

  it("redacts contact details before the payload leaves the process", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    await runJevClassification({
      ...input,
      content: `${CLEAN_BODY}\nPing person@example.com or +1 (415) 555-1212 at https://internal.example.test/doc`,
    });

    const body = fetchCallArgs(fetchMock).init.body as string;
    expect(body).not.toContain("person@example.com");
    expect(body).not.toContain("555-1212");
    expect(body).not.toContain("internal.example.test");
    expect(body).toContain("ship the retrieval API");
  });

  it("redacts unlabelled provider credentials before sending", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    await runJevClassification({
      ...input,
      content: [
        CLEAN_BODY,
        "rotate xoxb-000000000000-000000000000-EXAMPLEEXAMPLEEX",
        // guard:allow-secret-literal — shape-only fixture proving redaction
        "and AKIAEXAMPLEEXAMPLE99",
        // guard:allow-secret-literal — shape-only fixture proving redaction
        "and AIzaEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPL0",
      ].join("\n"),
    });

    const body = fetchCallArgs(fetchMock).init.body as string;
    expect(body).not.toMatch(/xoxb-0/);
    expect(body).not.toMatch(/AKIAEXAMPLE/);
    expect(body).not.toMatch(/AIzaEXAMPLE/);
  });

  it("asks Jev the workspace's own restriction and quarantines when it trips", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    const fetchMock = vi.fn(async () =>
      jevResponse({ ...scoresWith(), [WORKSPACE_RULE_QUESTION]: 0.95 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await runJevClassification({
      ...input,
      settings: {
        ...DEFAULT_BRAIN_SETTINGS,
        sensitivityCustomInstructions:
          "Never retain unreleased pricing. Escalate to owner@example.com.",
      },
    });

    const body = JSON.parse(fetchCallArgs(fetchMock).init.body as string);
    const rule = body.questions[WORKSPACE_RULE_QUESTION].criteria.true;
    expect(rule).toContain("Never retain unreleased pricing.");
    expect(rule).not.toContain("owner@example.com");
    expect(outcome.decision?.disposition).toBe("quarantined");
    expect(outcome.decision?.categories).toEqual([]);
    expect(outcome.decision?.categoryScores?.[WORKSPACE_RULE_QUESTION]).toBe(
      0.95,
    );
  });
});

describe("Jev transport", () => {
  it("asks every category in a single request against the stored-key endpoint", async () => {
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    const scores = await requestJevSensitivityScores(
      { source: "stored-key", apiKey: "not-a-real-key" },
      { title: "Planning", body: CLEAN_BODY },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = fetchCallArgs(fetchMock);
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer not-a-real-key",
    );
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body.questions)).toEqual([
      ...BRAIN_SENSITIVITY_CATEGORIES,
    ]);
    expect(body.questions.performance.type).toBe("noul");
    expect(Object.keys(scores)).toHaveLength(
      BRAIN_SENSITIVITY_CATEGORIES.length,
    );
  });

  it("routes gateway auth through the Builder proxy with its identity headers", async () => {
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    const auth: JevAuth = {
      source: "builder-gateway",
      origin: "https://proxy.test",
      authorization: "Bearer gateway-token",
      spaceId: "space-1",
      userId: "user-1",
    };
    await requestJevSensitivityScores(auth, {
      title: "Planning",
      body: CLEAN_BODY,
    });

    const { url, init } = fetchCallArgs(fetchMock);
    expect(url).toBe("https://proxy.test/agent-native/jev/v1/system-one");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-builder-api-key"]).toBe("space-1");
    expect(headers["x-builder-user-id"]).toBe("user-1");
  });

  it("treats a partial answer set as an outage rather than a zero score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jevResponse({ performance: 0.02 })),
    );

    await expect(
      requestJevSensitivityScores(
        { source: "stored-key", apiKey: "not-a-real-key" },
        { title: "Planning", body: CLEAN_BODY },
      ),
    ).rejects.toThrow(/omitted a probability/);
  });

  it("surfaces a non-OK response as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );

    await expect(
      requestJevSensitivityScores(
        { source: "stored-key", apiKey: "not-a-real-key" },
        { title: "Planning", body: CLEAN_BODY },
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("credential ladder", () => {
  const identity = { ownerEmail: "owner@example.com", orgId: "org-1" };

  it("prefers the workspace's own stored key", async () => {
    resolveSourceCredential.mockResolvedValue("  not-a-real-key  ");

    await expect(resolveJevAuth(identity)).resolves.toEqual({
      source: "stored-key",
      apiKey: "not-a-real-key",
    });
    expect(resolveBuilderGatewayAuth).not.toHaveBeenCalled();
    expect(resolveSourceCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "JEV_API_KEY",
        ctx: { userEmail: "owner@example.com", orgId: "org-1" },
      }),
    );
  });

  it("falls back to the Builder gateway when no key is stored", async () => {
    resolveSourceCredential.mockResolvedValue(undefined);
    resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer gateway-token",
      spaceId: "space-1",
      userId: null,
    });

    await expect(resolveJevAuth(identity)).resolves.toEqual({
      source: "builder-gateway",
      origin: "https://proxy.test",
      authorization: "Bearer gateway-token",
      spaceId: "space-1",
      userId: null,
    });
  });

  it("binds the gateway lookup to the capture owner, not the ambient user", async () => {
    getCredentialContext.mockReturnValue({
      userEmail: "editor@example.com",
      orgId: "org-2",
    });
    resolveSourceCredential.mockResolvedValue(undefined);
    resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer gateway-token",
      spaceId: null,
      userId: null,
    });

    await resolveJevAuth(identity);

    expect(runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
  });

  it("reports no auth when neither path is available", async () => {
    resolveSourceCredential.mockResolvedValue(undefined);
    resolveBuilderGatewayAuth.mockResolvedValue(null);

    await expect(resolveJevAuth(identity)).resolves.toBeNull();
  });
});

describe("end to end classification", () => {
  const input = {
    title: "Planning transcript",
    content: CLEAN_BODY,
    capturedAt: CAPTURED_AT,
    settings: DEFAULT_BRAIN_SETTINGS,
    ownerEmail: "owner@example.com",
  };

  it("returns a Jev verdict and reports which credential answered", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jevResponse(scoresWith({ performance: 0.91 }))),
    );

    const outcome = await runJevClassification(input);

    expect(outcome.configured).toBe(true);
    expect(outcome.authSource).toBe("stored-key");
    expect(outcome.failureReason).toBeUndefined();
    expect(outcome.decision?.classifier).toBe("jev");
    expect(outcome.decision?.disposition).toBe("quarantined");
    expect(outcome.decision?.categories).toEqual(["performance"]);
  });

  it("never sends deterministically sensitive lines to Jev", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    await runJevClassification({
      ...input,
      content: `${CLEAN_BODY}\nHer salary and retention bonus were adjusted.`,
    });

    const body = JSON.parse(fetchCallArgs(fetchMock).init.body as string);
    expect(body.state.body).toContain("ship the retrieval API");
    expect(body.state.body).not.toContain("salary");
  });

  it("reuses the cached verdict for identical content", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    const fetchMock = vi.fn(async () => jevResponse(scoresWith()));
    vi.stubGlobal("fetch", fetchMock);

    await runJevClassification(input);
    await runJevClassification(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a transport failure instead of a clean verdict", async () => {
    resolveSourceCredential.mockResolvedValue("not-a-real-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    const outcome = await runJevClassification(input);

    expect(outcome.configured).toBe(true);
    expect(outcome.decision).toBeUndefined();
    expect(outcome.failureReason).toMatch(/HTTP 500/);
  });

  it("stays out of the way when the workspace picked another classifier", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runJevClassification({
        ...input,
        settings: { ...DEFAULT_BRAIN_SETTINGS, privacyClassifier: "model" },
      }),
    ).resolves.toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("degrading to the existing chain", () => {
  it("reports not-configured under test so the existing classifiers run", async () => {
    await expect(
      classifyWithJev({
        title: "Planning transcript",
        content: CLEAN_BODY,
        capturedAt: CAPTURED_AT,
        settings: DEFAULT_BRAIN_SETTINGS,
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({ configured: false });
  });

  it("still suppresses sensitive captures when Jev never answers", async () => {
    const result = await sanitizeCaptureForStorage({
      kind: "transcript",
      title: "Planning transcript",
      capturedAt: CAPTURED_AT,
      source: {
        id: "source-1",
        title: "Clips",
        provider: "clips",
        ownerEmail: "owner@example.com",
      },
      settings: DEFAULT_BRAIN_SETTINGS,
      content: "Her salary and retention bonus are being adjusted this cycle.",
    });

    expect(result.decision?.disposition).toBe("suppressed");
    expect(result.decision?.classifier).toBe("deterministic");
    expect(result.content).not.toContain("salary");
  });

  it("stores deterministic-clean captures when no classifier is reachable", async () => {
    const result = await sanitizeCaptureForStorage({
      kind: "note",
      title: "Retrieval plan",
      capturedAt: CAPTURED_AT,
      source: {
        id: "source-1",
        title: "Notes",
        provider: "manual",
        ownerEmail: "owner@example.com",
      },
      settings: DEFAULT_BRAIN_SETTINGS,
      content: CLEAN_BODY,
    });

    expect(result.decision?.disposition).toBe("allowed");
    expect(result.content).toContain("ship the retrieval API");
  });
});
