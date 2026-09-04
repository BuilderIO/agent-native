import type { ComponentType } from "react";

/**
 * Props passed to an app-specific first-run onboarding step.
 *
 * Register one component per screen when an app needs a continuous, full-screen
 * flow after the shared connection and agent-introduction screens.
 */
export interface FirstRunOnboardingExtensionProps {
  /** Finish this step and open the next registered step, if any. */
  onComplete: () => void;
  /** Abort first-run onboarding without opening another app-specific step. */
  onSkip: () => void;
}

/** A full-screen app step that follows the framework's connection setup. */
export interface FirstRunOnboardingExtension {
  id: string;
  component: ComponentType<FirstRunOnboardingExtensionProps>;
}

let extensions: FirstRunOnboardingExtension[] = [];

/**
 * Register the app-owned part of first-run onboarding. Registration is
 * replaceable by id so Vite reloads do not stack duplicate screens.
 */
export function registerFirstRunOnboardingExtension(
  extension: FirstRunOnboardingExtension,
): void {
  if (!extension.id.trim()) {
    throw new Error(
      "registerFirstRunOnboardingExtension: extension.id is required",
    );
  }
  extensions = [
    ...extensions.filter((current) => current.id !== extension.id),
    extension,
  ];
}

/** Return app-specific first-run screens in registration order. */
export function listFirstRunOnboardingExtensions(): readonly FirstRunOnboardingExtension[] {
  return extensions;
}
