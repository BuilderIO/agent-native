// Automatic Builder setup runs only on these hosted hostnames. Apps created
// from this template run elsewhere, so it stays off for them.
export const BUILDER_SIGNUP_EXPERIMENT_ID = "clips_builder_signup_v1";
export const BUILDER_SIGNUP_HOSTED_HOSTS: string[] = [
  "clips.agent-native.com",
  "beta.clips.agent-native.com",
  // Labs serves this public-owned app at /clips on its shared origin.
  "labs.agent-native.com",
  "agent-native-labs-workspace-beta.netlify.app",
];
