// Automatic Builder setup runs only on these hosted hostnames. Apps created
// from this template run elsewhere, so it stays off for them.
export const BUILDER_SIGNUP_EXPERIMENT_ID = "content_builder_signup_v1";
export const BUILDER_SIGNUP_HOSTED_HOSTS: string[] = [
  "content.agent-native.com",
  "beta.content.agent-native.com",
];
