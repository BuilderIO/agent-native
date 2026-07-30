import { Button } from "@agent-native/toolkit/ui/button";
import { IconArrowRight, IconBolt, IconClock } from "@tabler/icons-react";
import { Link } from "react-router";

import { useT } from "../i18n.js";

export const AUTOMATION_CREATION_SCOPE = "personal" as const;

export function automationCreationContext(): string {
  return `The user wants to create a new ${AUTOMATION_CREATION_SCOPE} automation. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`;
}

export function AutomationsSection() {
  const t = useT();

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("jobs.settingsSummary", {
          defaultValue:
            "Manage scheduled and event-triggered agent tasks together from the Automations page.",
        })}
      </p>
      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
          <IconClock className="size-3" />
          {t("jobs.scheduledTrigger", { defaultValue: "Scheduled" })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
          <IconBolt className="size-3" />
          {t("jobs.eventTrigger", { defaultValue: "Event-triggered" })}
        </span>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/agent#jobs">
          {t("jobs.openAutomations", {
            defaultValue: "Open Automations",
          })}
          <IconArrowRight className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}
