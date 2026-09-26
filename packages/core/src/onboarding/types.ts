export type OnboardingMethodBadge = "recommended" | "beta" | "free" | "soon";

export interface OnboardingFormField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface OnboardingMethodBase {
  id: string;
  label: string;
  description?: string;
  badge?: OnboardingMethodBadge;
  primary?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}

export type OnboardingMethod =
  | (OnboardingMethodBase & {
      kind: "link";
      payload: { url: string; external?: boolean };
    })
  | (OnboardingMethodBase & {
      kind: "form";
      payload: {
        fields: OnboardingFormField[];
        writeScope?: "user" | "workspace" | "app";
        saveTo?: "env-vars" | "scoped-secrets";
        secretDescription?: string;
      };
    })
  | (OnboardingMethodBase & {
      kind: "builder-cli-auth";
      payload: {
        scope: "llm" | "browser" | "image-generation";
      };
    })
  | (OnboardingMethodBase & {
      kind: "agent-task";
      payload: { prompt: string };
    });

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  order: number;
  required?: boolean;
  methods: OnboardingMethod[];
  isAvailable?: (
    context?: OnboardingResolveContext,
  ) => boolean | Promise<boolean>;
  isComplete: (
    context?: OnboardingResolveContext,
  ) => boolean | Promise<boolean>;
}

export interface OnboardingResolveContext {
  sessionId: string;
  userEmail?: string;
  orgId?: string | null;
}

export interface OnboardingStepStatus {
  id: string;
  title: string;
  description: string;
  order: number;
  required: boolean;
  complete: boolean;
  methods: OnboardingMethod[];
}

export interface OnboardingCapability {
  id: string;
  label: string;
  required: boolean;
  suggested?: boolean;
  builderIncluded: boolean;
  keySummary: string;
  why: string;
  labelKey?: string;
  keySummaryKey?: string;
  whyKey?: string;
}

export interface OnboardingAppProfile {
  appId: string;
  appName: string;
  capabilities: OnboardingCapability[];
}

export interface OnboardingSummary {
  steps: OnboardingStepStatus[];
  dismissed: boolean;
  profile: OnboardingAppProfile;
}
