/**
 * Dev overlay — types for the framework-level dev/configuration panel.
 *
 * Toggled with Cmd+Ctrl+A. Templates register panels at module load time;
 * each panel exposes typed options whose values are persisted to localStorage.
 * Built-in framework panels (e.g. onboarding preview) live alongside.
 */

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
  /** Optional secondary label rendered on the button (defaults to `label`). */
  buttonLabel?: string;
  /** Mark destructive / risky actions so the UI can style them differently. */
  destructive?: boolean;
  onClick: () => void | Promise<void>;
}

export type DevOption =
  | DevBooleanOption
  | DevSelectOption
  | DevStringOption
  | DevActionOption;

export interface DevPanel {
  /** Stable id — used for the localStorage key prefix. */
  id: string;
  label: string;
  description?: string;
  /** Lower = earlier. Framework built-ins use 10–30; templates default to 100. */
  order?: number;
  options?: DevOption[];
  /** Custom React content rendered after the options list. */
  render?: () => ReactNode;
}
