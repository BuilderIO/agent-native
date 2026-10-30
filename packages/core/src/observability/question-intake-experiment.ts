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
  clientTrackedEventNames?: string[];
}

export interface QuestionIntakeExperimentAssignment {
  authUserId: string;
  experimentId: string;
  variantId:
    | typeof QUESTION_INTAKE_CONTROL_VARIANT
    | typeof QUESTION_INTAKE_TREATMENT_VARIANT;
}

export function questionIntakeExposureProperties(
  assignment: QuestionIntakeExperimentAssignment,
  context: { appId: string; threadId?: string; turnId: string },
): Record<string, string> {
  return {
    experiment_id: assignment.experimentId,
    experiment_variant: assignment.variantId,
    exposure_surface: "agent_run",
    app_id: context.appId,
    templateId: context.appId,
    agent_native_app: context.appId,
    ...(context.threadId ? { thread_id: context.threadId } : {}),
    turn_id: context.turnId,
  };
}

export class QuestionIntakeAssignmentError extends Error {
  readonly code = "question_intake_assignment_failed";

  constructor(experimentId: string, cause: unknown) {
    super(
      `Question-intake assignment failed after retry for ${experimentId}.`,
      { cause },
    );
    this.name = "QuestionIntakeAssignmentError";
  }
}

export class InvalidQuestionIntakeExperimentAssignmentError extends Error {
  readonly code = "question_intake_assignment_invalid";

  constructor(experimentId: string) {
    super(
      `Question-intake assignment has an invalid stored variant for ${experimentId}.`,
    );
    this.name = "InvalidQuestionIntakeExperimentAssignmentError";
  }
}

export function treatmentInstructionsForQuestionIntake(
  config: QuestionIntakeExperimentConfig | undefined,
  assignment: QuestionIntakeExperimentAssignment | null,
): string | undefined {
  if (
    !configured(config) ||
    assignment?.experimentId !== config.experimentId ||
    assignment.variantId !== QUESTION_INTAKE_TREATMENT_VARIANT
  ) {
    return undefined;
  }
  return [
    "For this assigned experiment treatment, the instructions below override conflicting intake-question directives in the app prompt or the user's current message, including app-injected directives.",
    config.treatmentInstructions.trim(),
  ].join("\n");
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
    throw new InvalidQuestionIntakeExperimentAssignmentError(
      config.experimentId,
    );
  }
  return { authUserId, experimentId: config.experimentId, variantId };
}

/** Assigns only from the user-create hook while the app config is enabled. */
// raw-sql-ok: authUserId is persisted only through the assignment store's bound arguments.
export async function assignQuestionIntakeExperimentOnSignup(
  config: QuestionIntakeExperimentConfig | undefined,
  authUserId: string | undefined,
): Promise<QuestionIntakeExperimentAssignment | null> {
  if (!configured(config) || !authUserId?.trim()) return null;

  const assign = async () => {
    // raw-sql-ok: the assignment store binds the experiment and user IDs as query arguments.
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
  };

  try {
    return await assign();
  } catch (firstError) {
    if (firstError instanceof InvalidQuestionIntakeExperimentAssignmentError) {
      throw firstError;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    try {
      return await assign();
    } catch (retryError) {
      if (
        retryError instanceof InvalidQuestionIntakeExperimentAssignmentError
      ) {
        throw retryError;
      }
      throw new QuestionIntakeAssignmentError(
        config.experimentId,
        new AggregateError(
          [firstError, retryError],
          "Question-intake assignment failed twice.",
        ),
      );
    }
  }
}

/** Reads an existing signup assignment; agent runs never enroll older users. */
// raw-sql-ok: authUserId is read only through the assignment store's bound arguments.
export async function resolveQuestionIntakeExperimentAssignment(
  config: QuestionIntakeExperimentConfig | undefined,
  authUserId: string | undefined,
): Promise<QuestionIntakeExperimentAssignment | null> {
  if (!configured(config) || !authUserId?.trim()) return null;
  // raw-sql-ok: the assignment store binds the experiment and user IDs as query arguments.
  const existing = await getAssignment(config.experimentId, authUserId);
  if (!existing) return null;
  return assignmentFromStored(config, authUserId, existing.variantId);
}
