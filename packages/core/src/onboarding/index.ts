
export { registerOnboardingStep, listOnboardingSteps } from "./registry.js";
export type {
  OnboardingStep,
  OnboardingMethod,
  OnboardingMethodBadge,
  OnboardingFormField,
  OnboardingStepStatus,
  OnboardingCapability,
  OnboardingAppProfile,
} from "./types.js";
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
