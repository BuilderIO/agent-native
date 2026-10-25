export interface WilsonInterval {
  lower: number;
  upper: number;
}

export interface ClassificationLabelMetrics {
  label: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  support: number;
  predicted: number;
  precision: number;
  precisionInterval: WilsonInterval | null;
  recall: number;
  recallInterval: WilsonInterval | null;
  f1: number;
}

export interface ClassificationConfusionMatrix {
  /** Actual labels, in the same order as the matrix rows. */
  labels: string[];
  /** Predicted labels, in the same order as the matrix columns; null is abstention. */
  predictedLabels: Array<string | null>;
  counts: number[][];
}

export interface ClassificationScore {
  perLabel: ClassificationLabelMetrics[];
  macroF1: number;
  confusionMatrix: ClassificationConfusionMatrix;
  /** Null when there are no examples. */
  abstainRate: number | null;
}

export interface ScoreClassificationInput {
  gold: readonly string[];
  predicted: readonly (string | null)[];
  labels: readonly string[];
}

export interface ThresholdPoint {
  threshold: number;
  truePositives: number;
  predictedPositive: number;
  goldPositive: number;
  precision: number | null;
  recall: number | null;
}

export interface ThresholdSweepResult {
  points: ThresholdPoint[];
  /** Null when targetRecall is omitted or no threshold has defined sufficient recall. */
  largestThresholdMeetingTargetRecall: number | null;
}

export interface ThresholdSweepInput {
  gold: readonly boolean[];
  probabilities: readonly number[];
  thresholds?: readonly number[];
  targetRecall?: number;
}

const WILSON_Z_95 = 1.959963984540054;
const MAX_CALIBRATION_BINS = 10_000;

function assertEqualLength(
  gold: readonly unknown[],
  other: readonly unknown[],
  name: string,
): void {
  if (gold.length !== other.length) {
    throw new RangeError(
      `Expected gold and ${name} to have equal lengths; received ${gold.length} and ${other.length}`,
    );
  }
}

function assertProbability(value: number, name: string, index: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `${name}[${index}] must be a finite probability in [0, 1]`,
    );
  }
}

function assertBinaryGold(gold: readonly boolean[]): void {
  if (!Array.isArray(gold)) {
    throw new TypeError("gold must be an array of boolean labels");
  }
  for (let index = 0; index < gold.length; index += 1) {
    if (
      !Object.prototype.hasOwnProperty.call(gold, index) ||
      typeof gold[index] !== "boolean"
    ) {
      throw new TypeError(`gold[${index}] must be a boolean`);
    }
  }
}

function wilsonInterval(
  successes: number,
  trials: number,
): WilsonInterval | null {
  if (trials === 0) return null;

  const zSquared = WILSON_Z_95 ** 2;
  const proportion = successes / trials;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin =
    (WILSON_Z_95 *
      Math.sqrt(
        (proportion * (1 - proportion) + zSquared / (4 * trials)) / trials,
      )) /
    denominator;

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Scores single-label classification results. A null prediction is an abstention
 * and contributes a false negative to its gold label, but no false positive.
 * Undefined precision/recall intervals are null; zero-division point metrics
 * use zero so macro-F1 remains defined for labels with no observations.
 */
export function scoreClassification({
  gold,
  predicted,
  labels,
}: ScoreClassificationInput): ClassificationScore {
  assertEqualLength(gold, predicted, "predicted");

  if (
    !Array.isArray(labels) ||
    labels.some((label) => typeof label !== "string")
  ) {
    throw new TypeError("labels must be an array of strings");
  }
  if (new Set(labels).size !== labels.length) {
    throw new TypeError("labels must not contain duplicates");
  }
  if (gold.some((label) => typeof label !== "string")) {
    throw new TypeError("gold must contain only string labels");
  }
  if (predicted.some((label) => label !== null && typeof label !== "string")) {
    throw new TypeError("predicted must contain only string labels or null");
  }

  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const abstainIndex = labels.length;
  const counts = Array.from({ length: labels.length }, () =>
    Array.from({ length: labels.length + 1 }, () => 0),
  );

  for (let index = 0; index < gold.length; index += 1) {
    const actual = gold[index];
    const prediction = predicted[index];
    const row = labelIndex.get(actual);
    const column =
      prediction === null ? abstainIndex : labelIndex.get(prediction);

    if (row === undefined) {
      throw new RangeError(
        `gold[${index}] is not present in labels: ${actual}`,
      );
    }
    if (column === undefined) {
      throw new RangeError(
        `predicted[${index}] is not present in labels: ${prediction}`,
      );
    }
    counts[row][column] += 1;
  }

  const perLabel = labels.map((label, index): ClassificationLabelMetrics => {
    const truePositives = counts[index][index];
    const support = counts[index].reduce((sum, count) => sum + count, 0);
    const predictedCount = counts.reduce((sum, row) => sum + row[index], 0);
    const falsePositives = predictedCount - truePositives;
    const falseNegatives = support - truePositives;
    const precision = predictedCount === 0 ? 0 : truePositives / predictedCount;
    const recall = support === 0 ? 0 : truePositives / support;
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);

    return {
      label,
      truePositives,
      falsePositives,
      falseNegatives,
      support,
      predicted: predictedCount,
      precision,
      precisionInterval: wilsonInterval(truePositives, predictedCount),
      recall,
      recallInterval: wilsonInterval(truePositives, support),
      f1,
    };
  });

  const examples = gold.length;
  const abstentions = predicted.filter((label) => label === null).length;

  return {
    perLabel,
    macroF1:
      perLabel.length === 0
        ? 0
        : perLabel.reduce((sum, metric) => sum + metric.f1, 0) /
          perLabel.length,
    confusionMatrix: {
      labels: [...labels],
      predictedLabels: [...labels, null],
      counts,
    },
    abstainRate: examples === 0 ? null : abstentions / examples,
  };
}

function validateProbabilityArray(probabilities: readonly number[]): void {
  if (!Array.isArray(probabilities)) {
    throw new TypeError("probabilities must be an array of numbers");
  }
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = probabilities[index];
    if (
      !Object.prototype.hasOwnProperty.call(probabilities, index) ||
      typeof probability !== "number"
    ) {
      throw new TypeError(`probabilities[${index}] must be a number`);
    }
    assertProbability(probability, "probabilities", index);
  }
}

/**
 * Evaluates binary positive-class probabilities at each threshold. A score is
 * predicted positive when it is greater than or equal to the threshold, so ties
 * at the threshold are included.
 */
export function thresholdSweep({
  gold,
  probabilities,
  thresholds,
  targetRecall,
}: ThresholdSweepInput): ThresholdSweepResult {
  assertBinaryGold(gold);
  validateProbabilityArray(probabilities);
  assertEqualLength(gold, probabilities, "probabilities");

  if (targetRecall !== undefined) {
    assertProbability(targetRecall, "targetRecall", 0);
  }

  const thresholdValues =
    thresholds === undefined
      ? [...new Set([0, ...probabilities, 1])].sort(
          (left, right) => left - right,
        )
      : [...thresholds];
  if (!Array.isArray(thresholdValues)) {
    throw new TypeError("thresholds must be an array of numbers");
  }
  thresholdValues.forEach((threshold, index) => {
    if (typeof threshold !== "number") {
      throw new TypeError(`thresholds[${index}] must be a number`);
    }
    assertProbability(threshold, "thresholds", index);
  });

  const goldPositive = gold.filter(Boolean).length;
  const sortedExamples = probabilities
    .map((probability, index) => ({ probability, positive: gold[index] }))
    .sort((left, right) => right.probability - left.probability);
  const sortedThresholds = thresholdValues
    .map((threshold, index) => ({ threshold, index }))
    .sort(
      (left, right) =>
        right.threshold - left.threshold || left.index - right.index,
    );
  const points: ThresholdPoint[] = Array.from({
    length: thresholdValues.length,
  });
  let exampleIndex = 0;
  let truePositives = 0;
  let predictedPositive = 0;
  let largestThresholdMeetingTargetRecall: number | null = null;

  for (const { threshold, index } of sortedThresholds) {
    while (
      exampleIndex < sortedExamples.length &&
      sortedExamples[exampleIndex].probability >= threshold
    ) {
      predictedPositive += 1;
      if (sortedExamples[exampleIndex].positive) truePositives += 1;
      exampleIndex += 1;
    }

    const recall = goldPositive === 0 ? null : truePositives / goldPositive;
    points[index] = {
      threshold,
      truePositives,
      predictedPositive,
      goldPositive,
      precision:
        predictedPositive === 0 ? null : truePositives / predictedPositive,
      recall,
    };
    if (
      targetRecall !== undefined &&
      recall !== null &&
      recall >= targetRecall &&
      (largestThresholdMeetingTargetRecall === null ||
        threshold > largestThresholdMeetingTargetRecall)
    ) {
      largestThresholdMeetingTargetRecall = threshold;
    }
  }

  return {
    points,
    largestThresholdMeetingTargetRecall,
  };
}

/** Computes binary expected calibration error using equal-width probability bins. */
export function expectedCalibrationError({
  gold,
  probabilities,
  bins = 10,
}: {
  gold: readonly boolean[];
  probabilities: readonly number[];
  bins?: number;
}): number | null {
  assertBinaryGold(gold);
  validateProbabilityArray(probabilities);
  assertEqualLength(gold, probabilities, "probabilities");
  if (!Number.isSafeInteger(bins) || bins <= 0 || bins > MAX_CALIBRATION_BINS) {
    throw new RangeError(
      `bins must be a positive integer no greater than ${MAX_CALIBRATION_BINS}`,
    );
  }
  if (gold.length === 0) return null;

  const counts = Array.from({ length: bins }, () => 0);
  const confidenceSums = Array.from({ length: bins }, () => 0);
  const positiveCounts = Array.from({ length: bins }, () => 0);
  for (let index = 0; index < probabilities.length; index += 1) {
    const bin = Math.min(bins - 1, Math.floor(probabilities[index] * bins));
    counts[bin] += 1;
    confidenceSums[bin] += probabilities[index];
    if (gold[index]) positiveCounts[bin] += 1;
  }

  return counts.reduce((error, count, bin) => {
    if (count === 0) return error;
    const averageConfidence = confidenceSums[bin] / count;
    const observedFrequency = positiveCounts[bin] / count;
    return (
      error +
      (count / gold.length) * Math.abs(observedFrequency - averageConfidence)
    );
  }, 0);
}
