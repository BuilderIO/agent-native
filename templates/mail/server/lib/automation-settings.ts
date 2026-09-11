import type { ActionRunContext } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";

export type MailAutomationSettings = {
  engine?: string;
  model?: string;
  allowAutomationSends?: boolean;
};

export function allowsAutomationSends(settings: unknown): boolean {
  return (
    typeof settings === "object" &&
    settings !== null &&
    "allowAutomationSends" in settings &&
    (settings as { allowAutomationSends?: unknown }).allowAutomationSends ===
      true
  );
}

export async function requiresEmailSendApproval(
  ctx?: ActionRunContext,
): Promise<boolean> {
  if (ctx?.caller !== "automation" || !ctx.userEmail) return true;

  const settings = await getUserSetting(ctx.userEmail, "automation-settings");
  return !allowsAutomationSends(settings);
}
