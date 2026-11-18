// Automatic Builder setup runs only on these hosted hostnames. Apps created
// from this template run elsewhere, so it stays off for them.
export const BUILDER_SIGNUP_EXPERIMENT_ID = "mail_builder_signup_v1";
export const BUILDER_SIGNUP_HOSTED_HOSTS: string[] = [
  "mail.agent-native.com",
  "beta.mail.agent-native.com",
];
