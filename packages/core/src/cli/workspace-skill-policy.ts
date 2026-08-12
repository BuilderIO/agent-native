/**
 * Skills every generated workspace app can use without an app-local copy.
 *
 * Keep this list deliberately small. Skills outside this list remain available
 * in the framework source and can be opted into by adding them to the
 * workspace core or to the app that actually needs them.
 */
export const DEFAULT_WORKSPACE_SKILLS = [
  "actions",
  "adding-a-feature",
  "agent-native-docs",
  "agent-native-toolkit",
  "context-awareness",
  "customizing-agent-native",
  "delegate-to-agent",
  "frontend-design",
  "turn-into-app",
  "turn-into-skill",
  "real-time-sync",
  "secrets",
  "security",
  "self-modifying-code",
  "shadcn-ui",
  "sharing",
  "storing-data",
  "portability",
  "workspace-conventions",
] as const;

/**
 * Framework skills that templates may carry before they are transformed into
 * workspace apps. Workspacify removes these copies because the workspace core
 * owns the inherited skill surface. App-specific skill names are intentionally
 * not listed here and remain local.
 */
export const FRAMEWORK_TEMPLATE_SHARED_SKILLS = [
  "actions",
  "agent-native-docs",
  "agent-native-toolkit",
  "adding-a-feature",
  "capture-learnings",
  "client-methods",
  "create-skill",
  "customizing-agent-native",
  "delegate-to-agent",
  "frontend-design",
  "feature-flags",
  "integration-webhooks",
  "internationalization",
  "onboarding",
  "performance",
  "real-time-collab",
  "real-time-sync",
  "security",
  "self-modifying-code",
  "shadcn-ui",
  "secrets",
  "storing-data",
  "sharing",
  "turn-into-app",
  "turn-into-skill",
  "upgrade-agent-native",
] as const;
