// Automatic Builder setup runs only on these hosted hostnames. Apps created
// from this template run elsewhere, so it stays off for them.
export const BUILDER_SIGNUP_EXPERIMENT_ID = "dispatch_builder_signup_v1";
export const BUILDER_SIGNUP_HOSTED_HOSTS: string[] = [
  "dispatch.agent-native.com",
  "beta.dispatch.agent-native.com",
  // Labs serves this public-owned app at /dispatch on its shared origin.
  "labs.agent-native.com",
  "agent-native-labs-workspace-beta.netlify.app",
];
