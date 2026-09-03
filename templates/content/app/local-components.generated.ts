import type { ElementType } from "react";

import type { LocalContentComponentInputs } from "./local-component-config";

const components: Record<string, ElementType> = {};
const componentInputs: Record<string, LocalContentComponentInputs> = {};

export const localContentComponentInputs = componentInputs;
export const localContentComponents = components;
export default components;
