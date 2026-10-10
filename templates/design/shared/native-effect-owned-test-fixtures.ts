import { DESIGN_OWNED_STATEFUL_DEFINITIONS } from "./native-effect-owned-dynamics";
import { adaptNativeFeedbackDefinition } from "./native-feedback-plan";

export const OWNED_FEEDBACK_TEST_DEFINITION =
  DESIGN_OWNED_STATEFUL_DEFINITIONS[0];

const adaptedFeedback = adaptNativeFeedbackDefinition(
  OWNED_FEEDBACK_TEST_DEFINITION,
);
if (!adaptedFeedback.ok)
  throw new Error("Design-owned feedback fixture is invalid.");
export const OWNED_FEEDBACK_TEST_KERNEL = adaptedFeedback.definition;
