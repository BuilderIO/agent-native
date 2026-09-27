import type { ReactNode } from "react";

export type DevOptionValue = boolean | string | number | null;

interface DevOptionBase {
  id: string;
  label: string;
  description?: string;
}

export interface DevBooleanOption extends DevOptionBase {
  type: "boolean";
  default?: boolean;
  onChange?: (value: boolean) => void | Promise<void>;
}

export interface DevSelectOption extends DevOptionBase {
  type: "select";
  choices: { value: string; label: string }[];
  default?: string;
  onChange?: (value: string) => void | Promise<void>;
}

export interface DevStringOption extends DevOptionBase {
  type: "string";
  default?: string;
  placeholder?: string;
  onChange?: (value: string) => void | Promise<void>;
}

export interface DevActionOption extends DevOptionBase {
  type: "action";
  buttonLabel?: string;
  destructive?: boolean;
  onClick: () => void | Promise<void>;
}

export type DevOption =
  | DevBooleanOption
  | DevSelectOption
  | DevStringOption
  | DevActionOption;

export interface DevPanel {
  id: string;
  label: string;
  description?: string;
  order?: number;
  options?: DevOption[];
  render?: () => ReactNode;
}
