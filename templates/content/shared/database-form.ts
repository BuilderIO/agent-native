import type { ContentDatabaseFormQuestion, ContentDatabaseView } from "./api";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
} from "./properties";

export interface ContentDatabaseFormPropertyLike {
  definition: {
    id: string;
    type: DocumentPropertyType;
  };
}

export function contentDatabaseFormQuestions(
  view: Pick<ContentDatabaseView, "formQuestions">,
  properties: ContentDatabaseFormPropertyLike[],
): ContentDatabaseFormQuestion[] {
  const availableKeys = [
    "name",
    ...properties
      .filter((property) => !isComputedPropertyType(property.definition.type))
      .map((property) => property.definition.id),
  ];
  const available = new Set(availableKeys);
  const configured = view.formQuestions ?? [];

  if (configured.length === 0) {
    return availableKeys.map((key) => ({
      key,
      enabled: true,
      required: key === "name",
    }));
  }

  const seen = new Set<string>();
  const questions = configured.flatMap((question) => {
    if (!available.has(question.key) || seen.has(question.key)) return [];
    seen.add(question.key);
    return [
      {
        key: question.key,
        enabled: question.enabled !== false,
        required: question.required === true,
      },
    ];
  });

  for (const key of availableKeys) {
    if (seen.has(key)) continue;
    questions.push({ key, enabled: true, required: key === "name" });
  }
  return questions;
}
