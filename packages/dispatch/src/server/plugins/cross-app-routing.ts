// Dispatch's preamble line for work another app owns, shared by the chat and
// messaging-integration prompts so the two cannot drift. It points at
// call-agent's routing rule rather than restating its conditions.
export const DISPATCH_CROSS_APP_ROUTING =
  "When another app owns the job, use call-agent and follow its routing rule: call a published read-only action directly only after describe-workspace-apps shows its full input, and send a natural-language message for everything else and after any failed call.";
