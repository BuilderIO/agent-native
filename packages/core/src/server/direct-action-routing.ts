// The one statement of when a cross-app call may skip the peer's agent. Every
// surface that teaches call-agent routing (its tool description, the framework
// prompt section, <available-apps>, and describe-workspace-apps) interpolates
// this instead of restating it: hand-written copies drift apart, and each one
// that loses the full-input gate invites guessed inputs.
export const DIRECT_ACTION_ROUTING =
  "A bounded read that a known peer serves with a published read-only action, whose full input describe-workspace-apps (with that app) shows, goes as call-agent action + input; that skips a full agent run in the peer. Otherwise, or if that call fails, send a natural-language message. Never guess an action's input, and never switch to a direct action to work around a slow or failed message. Creates, updates, deletes, sends, saves, publishes, and every other side effect go by message.";
