// Automatic Builder setup runs only on these hosted hostnames. Apps created
// from this template run elsewhere, so it stays off for them.
export const BUILDER_SIGNUP_EXPERIMENT_ID = "plan_builder_signup_v1";
export const BUILDER_SIGNUP_HOSTED_HOSTS: string[] = [
  "plan.agent-native.com",
  "beta.plan.agent-native.com",
];
