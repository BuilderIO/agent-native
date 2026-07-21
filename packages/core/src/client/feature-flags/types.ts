export interface FeatureFlagActor {
  name?: string | null;
  email?: string | null;
}

export interface FeatureFlagMetadata {
  key: string;
  displayName?: string | null;
  description?: string | null;
  defaultValue: boolean;
  rules: FeatureFlagRules;
  enabledForCurrentUser?: boolean;
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
  rules?: FeatureFlagRules;
}
