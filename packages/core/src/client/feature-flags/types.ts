export interface FeatureFlagActor {
  name?: string | null;
  email?: string | null;
}

export interface FeatureFlagMetadata {
  key: string;
  canManage?: boolean;
  movedToLab?: string;
  displayName?: string | null;
  description?: string | null;
  defaultValue: boolean;
  /**
   * Absent when the rule in effect could not be read, or is withheld because
   * the caller can't change it; `scopes` says which.
   */
  rules?: FeatureFlagRules;
  enabledForCurrentUser?: boolean;
  scopes?: FeatureFlagRuleScopes;
}

export type FeatureFlagRuleScope = "org" | "global";

/** Who a rule reaches, without the emails and organizations it names. */
export interface FeatureFlagRuleSummary {
  mode: FeatureFlagRules["mode"];
  emailCount: number;
  orgIdCount: number;
  percentage: number;
  updatedAt?: number | null;
}

export type FeatureFlagStoredRule = { canManage: boolean } & (
  | { state: "set"; rules: FeatureFlagRules }
  /** Set, but the caller can't change it, so only its summary is shown. */
  | { state: "withheld"; summary: FeatureFlagRuleSummary }
  | { state: "unset" }
  | { state: "unreadable"; problem?: string }
);

export interface FeatureFlagRuleScopes {
  inEffect: "org" | "global" | "none";
  global: FeatureFlagStoredRule;
  org: (FeatureFlagStoredRule & { orgId: string }) | null;
}

export interface FeatureFlagRules {
  version?: 1;
  mode: "off" | "on" | "rules";
  emails: string[];
  orgIds: string[];
  percentage: number;
  updatedAt?: number | null;
  updatedBy?: FeatureFlagActor | string | null;
}

export interface SetFeatureFlagInput {
  key: string;
  operation: "off" | "enable-for-current-user" | "replace-rules";
  scope?: FeatureFlagRuleScope;
  rules?: FeatureFlagRules;
}
