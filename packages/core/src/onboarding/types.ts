/**
 * Framework-level onboarding types.
 *
 * The onboarding system exposes a registry of "setup steps" that the agent
 * sidebar renders as a checklist. Each step declares one or more `methods`
 * by which the user can complete it (paste an API key, connect Builder, ask
 * the agent to do it, etc.).
 */

export type OnboardingMethodBadge = "recommended" | "beta" | "free";

/** Fields for a form-style onboarding method (key/value env-var entry). */
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
  /** Highlight as the primary CTA for this step. */
  primary?: boolean;
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
        writeScope?: "workspace" | "app";
      };
    })
  | (OnboardingMethodBase & {
      kind: "builder-cli-auth";
      // "llm" (managed gateway) and "browser" (browser automation) are live;
      // other scopes like "google" may land later.
      payload: { scope: "llm" | "browser" };
    })
  | (OnboardingMethodBase & {
      kind: "agent-task";
      payload: { prompt: string };
    });

export interface OnboardingStep {
  /** Stable ID (e.g. "llm", "gmail"). */
  id: string;
  title: string;
  description: string;
  /** Lower = earlier. Default order slots: 10 (engine), 20 (db), 30 (auth). */
  order: number;
  /** Required steps block onboarding dismissal when incomplete. */
  required?: boolean;
  methods: OnboardingMethod[];
  /** Resolver — called on every `GET /_agent-native/onboarding/steps` request. */
  isComplete: () => boolean | Promise<boolean>;
}

/** Serialized shape returned by `GET /_agent-native/onboarding/steps`. */
export interface OnboardingStepStatus {
  id: string;
  title: string;
  description: string;
  order: number;
  required: boolean;
  complete: boolean;
  methods: OnboardingMethod[];
}
