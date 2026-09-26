/**
 * Framework-level onboarding system.
 *
 * Templates register steps the agent sidebar should show as a setup checklist.
 * The server auto-mounts `/_agent-native/onboarding/*` routes and the client
 * hook polls them — see `@agent-native/core/client/onboarding`.
 */

export { registerOnboardingStep, listOnboardingSteps } from "./registry.js";
export type {
  OnboardingStep,
  OnboardingMethod,
  OnboardingMethodBadge,
  OnboardingFormField,
  OnboardingStepStatus,
  OnboardingCapability,
  OnboardingAppProfile,
  WorkspaceBuilderOnlyServiceId,
  WorkspaceProviderServiceId,
  WorkspaceServiceId,
} from "./types.js";
export {
  WORKSPACE_SERVICES,
  workspaceServiceForCapability,
  type WorkspaceService,
  type WorkspaceServiceKind,
} from "./workspace-services.js";
export {
  getOnboardingAppProfile,
  resolveOnboardingAppId,
} from "./app-profile.js";
export type { OnboardingPluginOptions } from "./plugin.js";

const loadOnboardingPlugin = () => import("./plugin.js");
export const createOnboardingPlugin: (typeof import("./plugin.js"))["createOnboardingPlugin"] =
  ((...args: any[]) =>
    (...nitroArgs: any[]) =>
      loadOnboardingPlugin().then(({ createOnboardingPlugin }) => {
        const factory = Reflect.apply(
          createOnboardingPlugin,
          undefined,
          args,
        ) as (...args: any[]) => unknown;
        return Reflect.apply(factory, undefined, nitroArgs);
      })) as (typeof import("./plugin.js"))["createOnboardingPlugin"];
export const defaultOnboardingPlugin = createOnboardingPlugin();
export { registerDefaultOnboardingSteps } from "./default-steps.js";
