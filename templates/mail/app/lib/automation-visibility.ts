export interface MailFrameworkAutomation {
  appId?: string;
  domain?: string;
  event?: string;
  triggerType?: string;
}

export function isMailFrameworkAutomation(
  automation: MailFrameworkAutomation,
): boolean {
  return (
    automation.appId === "mail" ||
    automation.domain === "mail" ||
    (automation.triggerType === "event" &&
      automation.event?.startsWith("mail.") === true)
  );
}
