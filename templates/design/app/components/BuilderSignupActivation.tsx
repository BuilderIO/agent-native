import { useBuilderSignupActivation as useSharedBuilderSignupActivation } from "@agent-native/toolkit/app/providers";
export { BuilderSignupActivationCover } from "@agent-native/toolkit/app/providers";

// Compatibility for app-local consumers; production startup is owned by AppProviders.
export function useBuilderSignupActivation(
  userId: string | undefined,
): boolean {
  return useSharedBuilderSignupActivation(userId, "design_builder_signup_v1")
    .activating;
}
