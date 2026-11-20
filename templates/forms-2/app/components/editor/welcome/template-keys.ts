import type { TemplateId } from "@shared/form-templates";

const KEYS: Record<TemplateId, string> = {
  "contact-form": "contactForm",
  "registration-form": "registrationForm",
  "customer-feedback": "customerFeedback",
  "trivia-quiz": "triviaQuiz",
  "web-project-intake": "webProjectIntake",
  "personality-quiz": "personalityQuiz",
};

export const templateNameKey = (id: TemplateId) =>
  `forms.templates.${KEYS[id]}.name`;
export const templateDescriptionKey = (id: TemplateId) =>
  `forms.templates.${KEYS[id]}.description`;
