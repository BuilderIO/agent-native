import { describe, expect, it } from "vitest";

import {
  expectedCalibrationError,
  scoreClassification,
  thresholdSweep,
} from "./decision-classification.js";

describe("scoreClassification", () => {
  it("scores each declared label and includes labels with no examples", () => {
    const result = scoreClassification({
      gold: ["cat", "cat", "cat", "dog"],
      predicted: ["cat", "cat", "dog", "cat"],
      labels: ["cat", "dog", "bird"],
    });

    expect(result.perLabel).toEqual([
      expect.objectContaining({
        label: "cat",
        truePositives: 2,
        falsePositives: 1,
        falseNegatives: 1,
        support: 3,
        predicted: 3,
        precision: 2 / 3,
        recall: 2 / 3,
        f1: 2 / 3,
      }),
      expect.objectContaining({
        label: "dog",
        truePositives: 0,
        falsePositives: 1,
        falseNegatives: 1,
        precision: 0,
        recall: 0,
        f1: 0,
      }),
      expect.objectContaining({
        label: "bird",
        support: 0,
        predicted: 0,
        precision: 0,
        precisionInterval: null,
        recall: 0,
        recallInterval: null,
        f1: 0,
      }),
    ]);
    expect(result.macroF1).toBeCloseTo(2 / 9, 12);
    expect(result.confusionMatrix).toEqual({
      labels: ["cat", "dog", "bird"],
      predictedLabels: ["cat", "dog", "bird", null],
      counts: [
        [2, 1, 0, 0],
        [1, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    expect(result.abstainRate).toBe(0);
  });

  it("counts abstentions in the confusion matrix and recall denominator", () => {
    const result = scoreClassification({
      gold: ["yes", "yes", "no"],
      predicted: ["yes", null, "no"],
      labels: ["yes", "no"],
    });

    expect(result.confusionMatrix.counts).toEqual([
      [1, 0, 1],
      [0, 1, 0],
    ]);
    expect(result.perLabel[0].recall).toBe(0.5);
    expect(result.abstainRate).toBeCloseTo(1 / 3, 12);
  });

  it("uses a hand-computed Wilson 95% interval for 2 successes in 3 trials", () => {
    const result = scoreClassification({
      gold: ["cat", "cat", "cat", "dog"],
      predicted: ["cat", "cat", "dog", "cat"],
      labels: ["cat", "dog"],
    });
    const cat = result.perLabel[0];

    expect(cat.precisionInterval?.lower).toBeCloseTo(0.20766, 4);
    expect(cat.precisionInterval?.upper).toBeCloseTo(0.93851, 4);
    expect(cat.recallInterval?.lower).toBeCloseTo(0.20766, 4);
    expect(cat.recallInterval?.upper).toBeCloseTo(0.93851, 4);
  });

  it("rejects mismatched arrays and unknown labels", () => {
    expect(() =>
      scoreClassification({ gold: ["yes"], predicted: [], labels: ["yes"] }),
    ).toThrow(/equal lengths/);
    expect(() =>
      scoreClassification({
        gold: ["maybe"],
        predicted: ["yes"],
        labels: ["yes", "no"],
      }),
    ).toThrow(/gold\[0\].*not present in labels/);
  });
});

describe("thresholdSweep", () => {
  it("includes probabilities tied at the threshold and finds the largest target threshold", () => {
    const result = thresholdSweep({
      gold: [true, true, false, false],
      probabilities: [0.9, 0.5, 0.5, 0.1],
      thresholds: [0.5, 0.9, 0.1],
      targetRecall: 0.75,
    });

    expect(result.points).toEqual([
      {
        threshold: 0.5,
        truePositives: 2,
        predictedPositive: 3,
        goldPositive: 2,
        precision: 2 / 3,
        recall: 1,
      },
      {
        threshold: 0.9,
        truePositives: 1,
        predictedPositive: 1,
        goldPositive: 2,
        precision: 1,
        recall: 0.5,
      },
      {
        threshold: 0.1,
        truePositives: 2,
        predictedPositive: 4,
        goldPositive: 2,
        precision: 0.5,
        recall: 1,
      },
    ]);
    expect(result.largestThresholdMeetingTargetRecall).toBe(0.5);
  });

  it("generates thresholds from the score values and validates probability inputs", () => {
    const result = thresholdSweep({
      gold: [true, false],
      probabilities: [0.25, 0.75],
    });

    expect(result.points.map((point) => point.threshold)).toEqual([
      0, 0.25, 0.75, 1,
    ]);
    expect(() =>
      thresholdSweep({ gold: [true], probabilities: [1.01] }),
    ).toThrow(/probability in \[0, 1\]/);
    expect(() => thresholdSweep({ gold: [true], probabilities: [] })).toThrow(
      /equal lengths/,
    );
  });

  it("rejects sparse gold and probability arrays before computing metrics", () => {
    const sparseGold = new Array<boolean>(2);
    sparseGold[0] = true;
    const sparseProbabilities = new Array<number>(2);
    sparseProbabilities[0] = 0.9;

    expect(() =>
      thresholdSweep({ gold: sparseGold, probabilities: [0.9, 0.1] }),
    ).toThrow(/gold\[1\]/);
    expect(() =>
      thresholdSweep({
        gold: [true, false],
        probabilities: sparseProbabilities,
      }),
    ).toThrow(/probabilities\[1\]/);
    expect(() =>
      expectedCalibrationError({ gold: sparseGold, probabilities: [0.9, 0.1] }),
    ).toThrow(/gold\[1\]/);
    expect(() =>
      expectedCalibrationError({
        gold: [true, false],
        probabilities: sparseProbabilities,
      }),
    ).toThrow(/probabilities\[1\]/);
  });

  it("does not rescan probabilities for every generated threshold", () => {
    const size = 64;
    const values = Array.from(
      { length: size },
      (_, index) => index / (size - 1),
    );
    let probabilityReads = 0;
    const probabilities = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          probabilityReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = thresholdSweep({
      gold: values.map((_, index) => index % 2 === 0),
      probabilities,
    });

    expect(result.points).toHaveLength(size);
    expect(probabilityReads).toBeLessThanOrEqual(size * 4);
  });
});

describe("expectedCalibrationError", () => {
  it("computes equal-width-bin ECE from observed frequencies and mean confidence", () => {
    const error = expectedCalibrationError({
      gold: [false, false, true, true],
      probabilities: [0.1, 0.2, 0.8, 0.9],
      bins: 2,
    });

    expect(error).toBeCloseTo(0.15, 12);
  });

  it("rejects invalid bin counts", () => {
    expect(() =>
      expectedCalibrationError({ gold: [true], probabilities: [0.5], bins: 0 }),
    ).toThrow(/positive integer/);
  });
});
