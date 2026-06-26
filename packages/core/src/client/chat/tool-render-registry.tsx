import type { ComponentType } from "react";

import type { ActionChatUIConfig } from "../../action-ui.js";

export interface ToolRendererContext {
  toolName: string;
  args: Record<string, unknown>;
  resultText?: string;
  resultJson: unknown;
  isRunning: boolean;
  chatUI?: ActionChatUIConfig;
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

export interface ActionChatRendererRegistration {
  id: string;
  renderer: string;
  Component: ToolRendererComponent;
}

const reservedRegistrations: ToolRendererRegistration[] = [];
const registrations: ToolRendererRegistration[] = [];
const reservedFallbackRegistrations: ToolRendererRegistration[] = [];
const fallbackRegistrations: ToolRendererRegistration[] = [];
const reservedActionChatRegistrations: ActionChatRendererRegistration[] = [];
const actionChatRegistrations: ActionChatRendererRegistration[] = [];

function registerIn<T>(list: T[], registration: T) {
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

export function registerReservedFallbackToolRenderer(
  registration: ToolRendererRegistration,
): () => void {
  return registerIn(reservedFallbackRegistrations, registration);
}

export function registerFallbackToolRenderer(
  registration: ToolRendererRegistration,
): () => void {
  return registerIn(fallbackRegistrations, registration);
}

export function registerActionChatRenderer(
  registration: ActionChatRendererRegistration,
): () => void {
  return registerIn(actionChatRegistrations, registration);
}

export function registerReservedActionChatRenderer(
  registration: ActionChatRendererRegistration,
): () => void {
  return registerIn(reservedActionChatRegistrations, registration);
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
  for (const registration of reservedRegistrations) {
    if (matchesToolRenderer(registration, context)) {
      return registration.Component;
    }
  }
  const renderer = context.chatUI?.renderer;
  if (renderer) {
    for (const registration of [
      ...reservedActionChatRegistrations,
      ...actionChatRegistrations,
    ]) {
      if (registration.renderer === renderer) {
        return registration.Component;
      }
    }
  }
  for (const registration of registrations) {
    if (matchesToolRenderer(registration, context)) {
      return registration.Component;
    }
  }
  for (const registration of reservedFallbackRegistrations) {
    if (matchesToolRenderer(registration, context)) {
      return registration.Component;
    }
  }
  for (const registration of fallbackRegistrations) {
    if (matchesToolRenderer(registration, context)) {
      return registration.Component;
    }
  }
  return null;
}

export function clearToolRenderersForTests() {
  registrations.length = 0;
  fallbackRegistrations.length = 0;
  actionChatRegistrations.length = 0;
}

export function clearReservedToolRenderersForTests() {
  reservedRegistrations.length = 0;
  reservedFallbackRegistrations.length = 0;
  reservedActionChatRegistrations.length = 0;
}
