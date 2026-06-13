import components from "./local-components.generated";
import type { ElementType } from "react";
import {
  normalizeLocalContentComponentInputs,
  type LocalContentComponentInputs,
} from "./local-component-config";
import { localContentComponentInputs as generatedLocalContentComponentInputs } from "./local-components.generated";

export const localContentComponents = components as Record<string, ElementType>;
export const localContentComponentInputs = Object.fromEntries(
  Object.entries(generatedLocalContentComponentInputs ?? {})
    .map(([name, inputs]) => [
      name,
      normalizeLocalContentComponentInputs(inputs),
    ])
    .filter((entry): entry is [string, LocalContentComponentInputs] =>
      Boolean(entry[1]),
    ),
) as Record<string, LocalContentComponentInputs>;
