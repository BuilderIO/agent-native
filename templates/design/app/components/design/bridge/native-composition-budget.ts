export type NativeCompositionBudgetFamily =
  | "resource"
  | "feedback"
  | "source"
  | "asset"
  | "isolation"
  | "compute";

type NativeCompositionBudgetCounts = {
  requestedBytes: number;
  limitBytes: number;
  knownBytes: number;
  missingTextures: number;
  familyKnownBytes: Record<NativeCompositionBudgetFamily, number>;
  familyTextures: Record<NativeCompositionBudgetFamily, number>;
  familyMissingTextures: Record<NativeCompositionBudgetFamily, number>;
};

export type NativeCompositionBudgetSummary = NativeCompositionBudgetCounts &
  (
    | { status: "complete"; currentBytes: number; exceeds: boolean }
    | { status: "incomplete"; currentBytes: null; exceeds: null }
  );

export function summarizeNativeCompositionBudget<Texture extends object>(
  families: Omit<
    Record<NativeCompositionBudgetFamily, Iterable<Texture>>,
    "compute"
  > & { compute?: Iterable<Texture> },
  textureBytes: ReadonlyMap<Texture, number>,
  requestedBytes: number,
  limitBytes: number,
): NativeCompositionBudgetSummary {
  const seen = new Set<Texture>();
  const familyKnownBytes: Record<NativeCompositionBudgetFamily, number> = {
    resource: 0,
    feedback: 0,
    source: 0,
    asset: 0,
    isolation: 0,
    compute: 0,
  };
  const familyTextures: Record<NativeCompositionBudgetFamily, number> = {
    resource: 0,
    feedback: 0,
    source: 0,
    asset: 0,
    isolation: 0,
    compute: 0,
  };
  const familyMissingTextures: Record<NativeCompositionBudgetFamily, number> = {
    resource: 0,
    feedback: 0,
    source: 0,
    asset: 0,
    isolation: 0,
    compute: 0,
  };
  const add = (family: NativeCompositionBudgetFamily): void => {
    const entries =
      family === "compute"
        ? families.compute === undefined
          ? []
          : families.compute
        : families[family];
    for (const texture of entries) {
      if (seen.has(texture)) continue;
      seen.add(texture);
      familyTextures[family] += 1;
      const bytes = textureBytes.get(texture);
      if (bytes === undefined) familyMissingTextures[family] += 1;
      else familyKnownBytes[family] += bytes;
    }
  };
  add("resource");
  add("feedback");
  add("source");
  add("asset");
  add("isolation");
  add("compute");
  const knownBytes =
    familyKnownBytes.resource +
    familyKnownBytes.feedback +
    familyKnownBytes.source +
    familyKnownBytes.asset +
    familyKnownBytes.isolation +
    familyKnownBytes.compute;
  const missingTextures =
    familyMissingTextures.resource +
    familyMissingTextures.feedback +
    familyMissingTextures.source +
    familyMissingTextures.asset +
    familyMissingTextures.isolation +
    familyMissingTextures.compute;
  const counts = {
    requestedBytes,
    limitBytes,
    knownBytes,
    missingTextures,
    familyKnownBytes,
    familyTextures,
    familyMissingTextures,
  };
  return missingTextures
    ? { ...counts, status: "incomplete", currentBytes: null, exceeds: null }
    : {
        ...counts,
        status: "complete",
        currentBytes: knownBytes,
        exceeds: knownBytes + requestedBytes > limitBytes,
      };
}
