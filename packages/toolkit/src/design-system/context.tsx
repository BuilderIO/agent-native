import { createContext, useContext } from "react";

import type { DesignSystemDefinition } from "./definition.js";
import type {
  DesignSystemComponentName,
  DesignSystemComponents,
} from "./types.js";

export interface DesignSystemContextValue {
  definition?: DesignSystemDefinition;
  legacyActionButton?: DesignSystemComponents["ActionButton"];
}

export const DesignSystemContext = createContext<DesignSystemContextValue>({});
export const LegacyButtonRenderContext = createContext(false);

export function useDesignSystem(): DesignSystemDefinition | undefined {
  return useContext(DesignSystemContext).definition;
}

export function useDesignSystemComponent<
  Name extends DesignSystemComponentName,
>(name: Name): DesignSystemComponents[Name] | undefined {
  const context = useContext(DesignSystemContext);
  const component = context.definition?.components?.[name];
  if (component) return component as DesignSystemComponents[Name];
  if (name === "ActionButton" && context.legacyActionButton) {
    return context.legacyActionButton as DesignSystemComponents[Name];
  }
  return undefined;
}
