import type { ComponentType } from "react";

export interface FirstRunOnboardingExtensionProps {
  onComplete: () => void | boolean | Promise<void | boolean>;
  onSkip: () => void;
  onStepChange?: (stepIndex: number) => void;
}

export interface FirstRunOnboardingExtension {
  id: string;
  component: ComponentType<FirstRunOnboardingExtensionProps>;
  placement?: "before-setup" | "after-setup";
  stepCount?: number;
  /**
   * True when the extension's steps offer a skip. Step events carry it as
   * `optional`, so Analytics funnels don't count a skip as drop-off.
   */
  optional?: boolean;
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
  if (
    extension.stepCount !== undefined &&
    (!Number.isInteger(extension.stepCount) || extension.stepCount < 1)
  ) {
    throw new Error(
      "registerFirstRunOnboardingExtension: stepCount must be a positive integer",
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
