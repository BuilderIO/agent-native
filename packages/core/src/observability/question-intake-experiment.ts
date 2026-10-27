import { createHash } from "node:crypto";

import { getAssignment, upsertAssignment } from "./store.js";

export const QUESTION_INTAKE_CONTROL_VARIANT = "control" as const;
export const QUESTION_INTAKE_TREATMENT_VARIANT = "no_questions" as const;

export interface QuestionIntakeExperimentConfig {
  enabled: boolean;
  disabled?: boolean;
  experimentId: string;
  questionToolNames: string[];
  treatmentInstructions: string;
  trackedEventNames: string[];
}

export interface QuestionIntakeExperimentAssignment {
  authUserId: string;
  experimentId: string;
  variantId:
    | typeof QUESTION_INTAKE_CONTROL_VARIANT
    | typeof QUESTION_INTAKE_TREATMENT_VARIANT;
}

function configured(
  config: QuestionIntakeExperimentConfig | undefined,
): config is QuestionIntakeExperimentConfig {
  return Boolean(
    config?.enabled &&
    !config.disabled &&
    config.experimentId.trim() &&
    config.questionToolNames.length > 0 &&
    config.treatmentInstructions.trim(),
  );
}

function variantForUser(
  experimentId: string,
  authUserId: string,
): QuestionIntakeExperimentAssignment["variantId"] {
  const bucket = createHash("sha256")
    .update(`${experimentId}\0${authUserId}`)
    .digest()
    .readUInt8(0);
  return bucket < 128
    ? QUESTION_INTAKE_CONTROL_VARIANT
    : QUESTION_INTAKE_TREATMENT_VARIANT;
}

function assignmentFromStored(
  config: QuestionIntakeExperimentConfig,
  authUserId: string,
  variantId: string,
): QuestionIntakeExperimentAssignment {
  if (
    variantId !== QUESTION_INTAKE_CONTROL_VARIANT &&
    variantId !== QUESTION_INTAKE_TREATMENT_VARIANT
  ) {
    throw new Error(
      "Question-intake experiment assignment has an unknown variant.",
    );
  }
  return { authUserId, experimentId: config.experimentId, variantId };
}

/** Assigns only from the user-create hook while the app config is enabled. */
export async function assignQuestionIntakeExperimentOnSignup(
  config: QuestionIntakeExperimentConfig | undefined,
  authUserId: string | undefined,
): Promise<QuestionIntakeExperimentAssignment | null> {
  if (!configured(config) || !authUserId?.trim()) return null;

  const existing = await getAssignment(config.experimentId, authUserId);
  if (existing) {
    return assignmentFromStored(config, authUserId, existing.variantId);
  }

  const variantId = variantForUser(config.experimentId, authUserId);
  await upsertAssignment({
    experimentId: config.experimentId,
    userId: authUserId,
    variantId,
    assignedAt: Date.now(),
  });
  return { authUserId, experimentId: config.experimentId, variantId };
}

/** Reads an existing signup assignment; agent runs never enroll older users. */
export async function resolveQuestionIntakeExperimentAssignment(
  config: QuestionIntakeExperimentConfig | undefined,
  authUserId: string | undefined,
): Promise<QuestionIntakeExperimentAssignment | null> {
  if (!configured(config) || !authUserId?.trim()) return null;
  const existing = await getAssignment(config.experimentId, authUserId);
  if (!existing) return null;
  return assignmentFromStored(config, authUserId, existing.variantId);
}
