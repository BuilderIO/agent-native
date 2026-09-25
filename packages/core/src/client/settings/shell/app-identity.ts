import {
  IconApps,
  IconBrain,
  IconBriefcase,
  IconCalendar,
  IconChartBar,
  IconChecklist,
  IconClipboardList,
  IconFileText,
  IconForms,
  IconMail,
  IconMessageCircle,
  IconPalette,
  IconPhoto,
  IconPlayerPlay,
  IconPresentation,
  IconSend,
  IconTool,
} from "@tabler/icons-react";

import { getTemplate } from "../../../cli/templates-meta.js";
import type { SettingsPageIcon } from "./registry.js";

declare const __AGENT_NATIVE_TEMPLATE__: string | undefined;

/**
 * Icons for the first-party templates' app group until each template passes
 * `appIcon` itself. Template metadata names icons for the desktop sidebar,
 * which aren't Tabler names, so they can't be looked up directly.
 */
const TEMPLATE_ICONS: Record<string, SettingsPageIcon> = {
  analytics: IconChartBar,
  assets: IconPhoto,
  brain: IconBrain,
  calendar: IconCalendar,
  chat: IconMessageCircle,
  clips: IconPlayerPlay,
  content: IconFileText,
  crm: IconBriefcase,
  design: IconPalette,
  dispatch: IconSend,
  factory: IconTool,
  forms: IconForms,
  mail: IconMail,
  plan: IconClipboardList,
  slides: IconPresentation,
  tasks: IconChecklist,
};

/** The template this bundle was built from, or `null` outside a template build. */
export function currentTemplateId(): string | null {
  try {
    const value =
      typeof __AGENT_NATIVE_TEMPLATE__ === "string"
        ? __AGENT_NATIVE_TEMPLATE__.trim().toLowerCase()
        : "";
    return value || null;
  } catch {
    // coercion-ok: tests and non-Vite builds do not define the constant.
    return null;
  }
}

export interface SettingsAppIdentity {
  appId: string | null;
  /** `null` when neither the app nor the template table names it. */
  name: string | null;
  icon: SettingsPageIcon;
}

export function resolveSettingsAppIdentity(options: {
  appId?: string | null;
  appName?: string;
  appIcon?: SettingsPageIcon;
}): SettingsAppIdentity {
  const appId = options.appId ?? currentTemplateId();
  const template = appId ? getTemplate(appId) : undefined;
  return {
    appId,
    name: options.appName?.trim() || template?.label || null,
    icon:
      options.appIcon ??
      (appId ? TEMPLATE_ICONS[appId] : undefined) ??
      IconApps,
  };
}
