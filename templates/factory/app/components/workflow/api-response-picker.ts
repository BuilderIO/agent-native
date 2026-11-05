/**
 * What the form's "Pick from last response" may offer: the answer of the test
 * the Output column is showing. The answer is customer data kept in memory by
 * the test alone, so it reaches the form through a context the details window
 * provides and nothing else holds it.
 */
import { createContext } from "react";

import {
  leafPathsOf,
  providerBodyOf,
} from "@/lib/workflow-editor/fields-to-keep";

import type { LiveTest } from "./api-request-test";
import { isCutByStep } from "./node-details/api-request-output";

/** The most paths the picker lists. */
export const PICKER_MAX_PATHS = 200;

export type PickableResponse =
  | { state: "none" }
  | { state: "running" }
  | { state: "failed" }
  | {
      state: "ready";
      /** What the step handed on, as the Output column has it. */
      value: unknown;
      /** The step cut the answer to fit; the paths of the entries it kept are still real. */
      cut: boolean;
    };

export const NO_RESPONSE: PickableResponse = { state: "none" };

export const ApiResponseContext = createContext<PickableResponse>(NO_RESPONSE);

/** The test in the window, as the picker sees it. */
export function pickableResponseOf(test: LiveTest): PickableResponse {
  if (test.phase === "idle") return NO_RESPONSE;
  if (test.phase === "running") return { state: "running" };
  return test.answer.kind === "answer"
    ? {
        state: "ready",
        value: test.answer.value,
        cut: isCutByStep(test.answer.value),
      }
    : { state: "failed" };
}

export type PickerReason = "needs_test" | "running" | "failed" | "no_fields";

export type PickerState =
  | { kind: "disabled"; reason: PickerReason }
  | { kind: "ready"; paths: string[]; capped: boolean; cut: boolean };

/**
 * Whether the picker can be used, and what it lists. A cut answer can: the
 * entries the step kept are whole, so their paths are real, and the picker says
 * the answer was cut.
 */
export function pickerStateOf(
  response: PickableResponse,
  options: { includeStatus: boolean },
): PickerState {
  switch (response.state) {
    case "none":
      return { kind: "disabled", reason: "needs_test" };
    case "running":
      return { kind: "disabled", reason: "running" };
    case "failed":
      return { kind: "disabled", reason: "failed" };
    case "ready": {
      const { paths, capped } = leafPathsOf(
        providerBodyOf(response.value, {
          includeStatus: options.includeStatus,
        }),
        { maxPaths: PICKER_MAX_PATHS, maxDepth: 8 },
      );
      return paths.length === 0
        ? { kind: "disabled", reason: "no_fields" }
        : { kind: "ready", paths, capped, cut: response.cut };
    }
  }
}
