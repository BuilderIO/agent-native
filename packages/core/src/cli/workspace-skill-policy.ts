export const STANDALONE_APP_SKILLS = [
  "actions",
  "adding-a-feature",
  "storing-data",
  "security",
  "secrets",
  "sharing",
  "frontend-design",
  "shadcn-ui",
  "real-time-sync",
  "context-awareness",
  "delegate-to-agent",
  "agent-native-docs",
  "agent-native-toolkit",
  "customizing-agent-native",
  "client-side-routing",
  "reliable-mutations",
  "performance",
] as const;

export const BUILD_AN_APP_SKILL = "build-an-app" as const;

export const CHAT_STARTER_SKILLS = [
  ...STANDALONE_APP_SKILLS,
  BUILD_AN_APP_SKILL,
] as const;

export const FUSION_STARTER_LOCAL_SKILLS = [
  "authentication",
  "internationalization",
  "multi-app-workspace",
] as const;

export const FUSION_STARTER_SKILLS = [
  ...CHAT_STARTER_SKILLS,
  ...FUSION_STARTER_LOCAL_SKILLS,
] as const;

export const WORKSPACE_SKILLS = [
  ...STANDALONE_APP_SKILLS,
  "adding-workspace-apps",
  "a2a-protocol",
  "automations",
  "composable-mini-apps",
  "external-agents",
  "portability",
  "recurring-jobs",
  "self-modifying-code",
  "turn-into-app",
  "turn-into-skill",
  "workspace-conventions",
  BUILD_AN_APP_SKILL,
] as const;

const DOMAIN_TEMPLATE_EXTRA_SKILLS = [
  "external-agents",
  "portability",
  "self-modifying-code",
  "turn-into-skill",
  "workspace-conventions",
] as const;

export const DOMAIN_TEMPLATE_SHARED_SKILLS = [
  ...STANDALONE_APP_SKILLS,
  ...DOMAIN_TEMPLATE_EXTRA_SKILLS,
] as const;

export const CLIPS_TEMPLATE_SHARED_SKILLS = [
  ...DOMAIN_TEMPLATE_SHARED_SKILLS,
  "a2a-protocol",
] as const;

export const DEFAULT_TEMPLATE_LOCAL_SKILLS = [
  "agent-engines",
  "app-branding",
  "app-permissions",
  "inline-embeds",
  "notifications",
  "progress",
] as const;

export const DEFAULT_TEMPLATE_SHARED_SKILLS = [
  ...STANDALONE_APP_SKILLS,
  ...DEFAULT_TEMPLATE_LOCAL_SKILLS,
  BUILD_AN_APP_SKILL,
] as const;

export const HEADLESS_TEMPLATE_SHARED_SKILLS = [
  "actions",
  "adding-a-feature",
  "agent-native-docs",
  "agent-native-toolkit",
  "customizing-agent-native",
  "delegate-to-agent",
  "performance",
  "reliable-mutations",
  "secrets",
  "security",
  "self-modifying-code",
  "sharing",
  "storing-data",
] as const;

export const DISPATCH_TEMPLATE_SHARED_SKILLS = WORKSPACE_SKILLS;

export const FACTORY_TEMPLATE_LOCAL_SKILLS = [
  "review-latest-feedback",
  "review-prs",
] as const;

export const FACTORY_TEMPLATE_SHARED_SKILLS = [
  ...DOMAIN_TEMPLATE_SHARED_SKILLS,
  "turn-into-app",
  ...FACTORY_TEMPLATE_LOCAL_SKILLS,
] as const;

export const FRAMEWORK_TEMPLATE_SHARED_SKILLS = [
  "a2a-protocol",
  "actions",
  "adding-a-feature",
  "adding-workspace-apps",
  "agent-native-docs",
  "agent-native-toolkit",
  "automations",
  BUILD_AN_APP_SKILL,
  "capture-learnings",
  "client-methods",
  "client-side-routing",
  "composable-mini-apps",
  "create-skill",
  "customizing-agent-native",
  "delegate-to-agent",
  "external-agents",
  "frontend-design",
  "feature-flags",
  "integration-webhooks",
  "internationalization",
  "onboarding",
  "performance",
  "portability",
  "real-time-collab",
  "real-time-sync",
  "recurring-jobs",
  "reliable-mutations",
  "review-latest-feedback",
  "review-prs",
  "security",
  "self-modifying-code",
  "shadcn-ui",
  "secrets",
  "storing-data",
  "sharing",
  "turn-into-app",
  "turn-into-skill",
  "upgrade-agent-native",
  "workspace-conventions",
] as const;
