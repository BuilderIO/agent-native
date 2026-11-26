export const INTAKE_QUESTION_TOPICS = [
  "formFactor",
  "aesthetic",
  "features",
  "interactions",
  "variants",
] as const;

export type IntakeQuestionTopic = (typeof INTAKE_QUESTION_TOPICS)[number];

export const INTAKE_QUESTION_TOPIC_LABELS: Record<IntakeQuestionTopic, string> =
  {
    formFactor: "form factor",
    aesthetic: "aesthetic direction",
    features: "important features/content",
    interactions: "special interactions/polish",
    variants: "whether to explore variations",
  };
