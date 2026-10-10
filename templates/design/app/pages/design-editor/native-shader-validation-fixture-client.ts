import { hashEffectDefinition } from "@shared/native-effect-trust";
import type {
  NativeShaderValidationCaseResult,
  NativeShaderValidationState,
} from "@shared/native-shader-validation";

import type {
  NativeValidationItem,
  NativeValidationResult,
} from "@/components/design/native-thumbnail-plan";

type ValidationCase = NativeShaderValidationState["cases"][number];

export interface PreparedNativeValidationFixtures {
  approvedExecutionHashes: string[];
  items: NativeValidationItem[];
}

export class NativeValidationFixtureClientError extends Error {
  constructor(
    readonly code: string,
    readonly originalError?: unknown,
  ) {
    super(code);
    this.name = "NativeValidationFixtureClientError";
  }
}

export class NativeValidationFixtureCleanupError extends NativeValidationFixtureClientError {
  constructor(
    readonly validationError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("validation-cleanup-failed");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function parsePreparedNativeValidationFixtures(
  raw: unknown,
  cases: readonly ValidationCase[],
  expectedVersionHash: string,
): Promise<PreparedNativeValidationFixtures> {
  if (
    !record(raw) ||
    !Array.isArray(raw.items) ||
    !Array.isArray(raw.approvedExecutionHashes) ||
    raw.items.length !== cases.filter((item) => item.fixture).length ||
    raw.items.length > 4 ||
    raw.approvedExecutionHashes.length > 32 ||
    !raw.approvedExecutionHashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new NativeValidationFixtureClientError("fixture-response-unreadable");
  const byId = new Map(cases.map((item) => [item.caseId, item]));
  const seen = new Set<string>();
  for (const rawItem of raw.items) {
    if (!record(rawItem) || typeof rawItem.id !== "string")
      throw new NativeValidationFixtureClientError(
        "fixture-response-unreadable",
      );
    const requested = byId.get(rawItem.id);
    if (
      !requested?.fixture ||
      seen.has(rawItem.id) ||
      !record(rawItem.definition)
    )
      throw new NativeValidationFixtureClientError("fixture-response-mismatch");
    seen.add(rawItem.id);
    let preparedHash: string;
    try {
      preparedHash = await hashEffectDefinition(
        rawItem.definition as unknown as NativeValidationItem["definition"],
      );
    } catch (error) {
      throw new NativeValidationFixtureClientError(
        "fixture-response-unreadable",
        error,
      );
    }
    if (
      rawItem.definition.id !== requested.definitionId ||
      rawItem.definition.version !== requested.definitionVersion ||
      preparedHash !== requested.executionHash ||
      !Array.isArray(rawItem.definition.placements) ||
      !rawItem.definition.placements.includes(rawItem.placement) ||
      rawItem.seed !== requested.fixture.seed ||
      rawItem.timeSeconds !== requested.timeSeconds ||
      rawItem.sourceRevision !== expectedVersionHash ||
      !record(rawItem.params) ||
      !record(rawItem.fixture) ||
      rawItem.fixture.sourceKind !== requested.fixture.sourceKind ||
      rawItem.fixture.aspect !== requested.fixture.aspect ||
      rawItem.fixture.alpha !== requested.fixture.alpha ||
      rawItem.fixture.rounded !== requested.fixture.rounded ||
      rawItem.fixture.coverageExpectation !==
        requested.fixture.coverageExpectation ||
      JSON.stringify(rawItem.expectedLinearSamples) !==
        JSON.stringify(requested.expectedLinearSamples)
    )
      throw new NativeValidationFixtureClientError("fixture-response-mismatch");
  }
  return raw as unknown as PreparedNativeValidationFixtures;
}

function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return crypto.subtle
    .digest("SHA-256", copy)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
}

export async function summarizeNativeValidationPixels(
  item: ValidationCase,
  result: NativeValidationResult,
): Promise<NativeShaderValidationCaseResult> {
  if (result.id !== item.caseId || result.executionHash !== item.executionHash)
    throw new NativeValidationFixtureClientError("fixture-result-mismatch");
  const common = {
    caseId: item.caseId,
    definitionId: item.definitionId,
    definitionVersion: item.definitionVersion,
    executionHash: item.executionHash,
  };
  if (result.status !== "ready")
    return {
      ...common,
      backend: result.backend,
      status:
        result.status === "approval-required" ? "unavailable" : result.status,
      code: result.code.slice(0, 80),
      message: result.message.slice(0, 300),
      sourceCaptures: 0,
      frames: 0,
      estimatedResourceBytes: 0,
    };
  if (
    result.width !== 160 ||
    result.height !== 100 ||
    result.colorSpace !== "srgb" ||
    result.alpha !== "straight" ||
    result.rgba.length !== result.width * result.height * 4 ||
    result.frames < 1
  )
    throw new NativeValidationFixtureClientError("fixture-pixels-invalid");
  let nonTransparentPixels = 0;
  for (let index = 3; index < result.rgba.length; index += 4)
    if (result.rgba[index] > 0) nonTransparentPixels += 1;
  const pixelSha256 = await sha256(result.rgba);
  const coverageMismatch =
    (item.fixture?.coverageExpectation === "nonzero" &&
      nonTransparentPixels === 0) ||
    (item.fixture?.coverageExpectation === "zero" &&
      nonTransparentPixels !== 0);
  if (coverageMismatch)
    return {
      ...common,
      backend: "webgpu",
      status: "error",
      code: "validation-coverage-mismatch",
      message: "validation-coverage-mismatch",
      pixelSha256,
      pixelWidth: result.width,
      pixelHeight: result.height,
      nonTransparentPixels,
      sourceCaptures: result.sourceCaptures,
      frames: result.frames,
      estimatedResourceBytes: result.estimatedResourceBytes,
    };
  if (item.expectedLinearSamples) {
    if (
      !result.linearGolden ||
      result.linearGolden.sampleCount !== item.expectedLinearSamples.length
    )
      throw new NativeValidationFixtureClientError(
        "fixture-linear-golden-unreadable",
      );
    if (!result.linearGolden.passed)
      return {
        ...common,
        backend: "webgpu",
        status: "error",
        code: "linear-golden-mismatch",
        message: "linear-golden-mismatch",
        linearGolden: result.linearGolden,
        pixelSha256,
        pixelWidth: result.width,
        pixelHeight: result.height,
        nonTransparentPixels,
        sourceCaptures: result.sourceCaptures,
        frames: result.frames,
        estimatedResourceBytes: result.estimatedResourceBytes,
      };
  } else if (result.linearGolden) {
    throw new NativeValidationFixtureClientError(
      "fixture-linear-golden-unexpected",
    );
  }
  return {
    ...common,
    backend: "webgpu",
    status: "ready",
    pixelSha256,
    pixelWidth: result.width,
    pixelHeight: result.height,
    nonTransparentPixels,
    ...(result.linearGolden ? { linearGolden: result.linearGolden } : {}),
    sourceCaptures: result.sourceCaptures,
    frames: result.frames,
    estimatedResourceBytes: result.estimatedResourceBytes,
    ...(result.renderWallMs === undefined
      ? {}
      : { renderWallMs: result.renderWallMs }),
  };
}

export async function validateNativeCleanFixtures(args: {
  cases: readonly ValidationCase[];
  prepared: PreparedNativeValidationFixtures;
  signal: AbortSignal;
}): Promise<NativeShaderValidationCaseResult[]> {
  const { NativeThumbnailService } =
    await import("@/components/design/native-thumbnail-service");
  const service = new NativeThumbnailService();
  let validationError: unknown;
  let results: NativeShaderValidationCaseResult[] | undefined;
  try {
    const rendered = await service.renderValidationBatch({
      items: args.prepared.items,
      approvedExecutionHashes: args.prepared.approvedExecutionHashes,
      signal: args.signal,
    });
    const cases = new Map(args.cases.map((item) => [item.caseId, item]));
    const seen = new Set<string>();
    results = [];
    for (const result of rendered) {
      const item = cases.get(result.id);
      if (!item?.fixture || seen.has(result.id))
        throw new NativeValidationFixtureClientError("fixture-result-mismatch");
      seen.add(result.id);
      results.push(await summarizeNativeValidationPixels(item, result));
    }
    if (results.length !== args.prepared.items.length)
      throw new NativeValidationFixtureClientError(
        "fixture-results-incomplete",
      );
  } catch (error) {
    validationError = error;
  }
  try {
    await service.dispose();
  } catch (cleanupError) {
    if (validationError)
      throw new NativeValidationFixtureCleanupError(
        validationError,
        cleanupError,
      );
    throw cleanupError;
  }
  if (validationError) throw validationError;
  return results!;
}
