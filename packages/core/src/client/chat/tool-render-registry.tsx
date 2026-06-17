import type { ComponentType } from "react";

export interface ToolRendererContext {
  toolName: string;
  args: Record<string, unknown>;
  resultText?: string;
  resultJson: unknown;
  isRunning: boolean;
}

export interface ToolRendererProps {
  context: ToolRendererContext;
}

export type ToolRendererComponent = ComponentType<ToolRendererProps>;

export type ToolRendererMatch =
  | string
  | ((context: ToolRendererContext) => boolean);

export interface ToolRendererRegistration {
  id: string;
  match: ToolRendererMatch;
  Component: ToolRendererComponent;
}

const reservedRegistrations: ToolRendererRegistration[] = [];
const registrations: ToolRendererRegistration[] = [];

function registerIn(
  list: ToolRendererRegistration[],
  registration: ToolRendererRegistration,
) {
  list.push(registration);
  return () => {
    const index = list.findIndex((item) => item === registration);
    if (index >= 0) list.splice(index, 1);
  };
}

export function registerToolRenderer(
  registration: ToolRendererRegistration,
): () => void {
  return registerIn(registrations, registration);
}

export function registerReservedToolRenderer(
  registration: ToolRendererRegistration,
): () => void {
  return registerIn(reservedRegistrations, registration);
}

function matchesToolRenderer(
  registration: ToolRendererRegistration,
  context: ToolRendererContext,
): boolean {
  if (typeof registration.match === "string") {
    return registration.match === context.toolName;
  }
  return registration.match(context);
}

export function resolveToolRenderer(
  context: ToolRendererContext,
): ToolRendererComponent | null {
  for (const registration of [...reservedRegistrations, ...registrations]) {
    if (matchesToolRenderer(registration, context)) {
      return registration.Component;
    }
  }
  return null;
}

export function clearToolRenderersForTests() {
  registrations.length = 0;
}

export function clearReservedToolRenderersForTests() {
  reservedRegistrations.length = 0;
}
