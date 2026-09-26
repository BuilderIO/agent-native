import type { ComponentType } from "react";

export interface FirstRunOnboardingExtensionProps {
  onComplete: () => void;
  onSkip: () => void;
}

export interface FirstRunOnboardingExtension {
  id: string;
  component: ComponentType<FirstRunOnboardingExtensionProps>;
}

let extensions: FirstRunOnboardingExtension[] = [];

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

export function listFirstRunOnboardingExtensions(): readonly FirstRunOnboardingExtension[] {
  return extensions;
}
