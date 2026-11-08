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
  /** Absent when the rule in effect could not be read. */
  rules?: FeatureFlagRules;
  enabledForCurrentUser?: boolean;
  scopes?: FeatureFlagRuleScopes;
}

export type FeatureFlagRuleScope = "org" | "global";

export type FeatureFlagStoredRule = { canManage: boolean } & (
  | { state: "set"; rules: FeatureFlagRules }
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
