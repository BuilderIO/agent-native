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
    })
  | (OnboardingMethodBase & {
      /**
       * Renders the shared S3-compatible storage form
       * (`StorageSettingsForm`), which saves through `manage-file-storage`.
       */
      kind: "file-storage";
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

/** Services whose provider is picked per service (`manage-service-providers`). */
export type WorkspaceProviderServiceId = "voice" | "images" | "embeddings";

/** Services only Builder.io provides. */
export type WorkspaceBuilderOnlyServiceId =
  | "design-system-intelligence"
  | "background-agents"
  | "browser-automation";

/** A service every app in a workspace shares (`WORKSPACE_SERVICES`). */
export type WorkspaceServiceId =
  | "model"
  | "storage"
  | WorkspaceProviderServiceId
  | WorkspaceBuilderOnlyServiceId;

export interface OnboardingCapability {
  id: string;
  label: string;
  required: boolean;
  suggested?: boolean;
  builderIncluded: boolean;
  keySummary: string;
  why: string;
  /** The shared workspace service this capability stands for. */
  service?: WorkspaceServiceId;
  /** Only Builder.io provides it; there is no bring-your-own path. */
  builderOnly?: boolean;
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
