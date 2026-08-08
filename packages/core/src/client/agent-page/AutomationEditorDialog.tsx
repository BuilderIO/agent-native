import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { openAgentSettings } from "../CommandMenu.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import {
  friendlyAutomationScheduleToCron,
  isValidAutomationSchedule,
  DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
} from "./automation-schedule-fields.js";
import {
  AutomationEmailFields,
  AutomationEventFields,
  AutomationTriggerCards,
  type EditorTrigger,
  type EmailFilters,
} from "./AutomationEditorTriggerFields.js";
import { AutomationScheduleFields } from "./AutomationScheduleFields.js";
import {
  automationSharingIsValid,
  automationSharingRequiresAcknowledgement,
  automationSharingStateFromSummary,
  defaultAutomationSharingState,
  AutomationSharingFields,
  AutomationSharingSummaryView,
  type AutomationSharingState,
} from "./AutomationSharingFields.js";
import { browserTimezone } from "./TimezoneSelect.js";
import {
  useAutomationEvents,
  type Automation,
  type AutomationSharingSubmission,
  type ManageAutomationInput,
} from "./use-jobs.js";

const EMAIL_EVENT = "mail.message.received";

export interface AutomationEditorDialogProps {
  open: boolean;
  scope: "personal" | "organization";
  automation?: Automation | null;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (input: ManageAutomationInput) => void;
}

function editorTrigger(automation?: Automation | null): EditorTrigger {
  if (!automation) return "schedule";
  if (automation.triggerType === "manual") return "manual";
  if (automation.triggerType === "schedule") return "schedule";
  return automation.event === EMAIL_EVENT ? "email" : "event";
}

function parseEmailCondition(condition: string | null): EmailFilters {
  const filters: EmailFilters = {
    from: "",
    to: "",
    subject: "",
    additional: "",
  };
  if (!condition) return filters;

  const unmatched: string[] = [];
  for (const line of condition.split("\n")) {
    const fieldMatch =
      /^The event field (from|to|subject) must contain ("(?:[^"\\]|\\.)*")\.$/.exec(
        line,
      );
    if (fieldMatch) {
      try {
        filters[fieldMatch[1] as keyof Omit<EmailFilters, "additional">] =
          JSON.parse(fieldMatch[2]) as string;
        continue;
      } catch {
        unmatched.push(line);
        continue;
      }
    }
    const additionalMatch = /^Also: (.*)$/.exec(line);
    unmatched.push(additionalMatch?.[1] ?? line);
  }
  filters.additional = unmatched.filter(Boolean).join("\n");
  return filters;
}

function buildSharingSubmission(
  state: AutomationSharingState,
  orgId: string | null,
): AutomationSharingSubmission {
  if (state.mode === "organization") {
    return { kind: "organization", organizationId: orgId || "" };
  }
  if (state.mode === "specific") {
    return {
      kind: "specific",
      organizationId: orgId,
      grants: state.grants.map((grant) => ({
        email: grant.email,
        role: grant.role,
      })),
    };
  }
  return { kind: "personal" };
}

function emailCondition(filters: EmailFilters): string | null {
  const lines: string[] = [];
  for (const field of ["from", "to", "subject"] as const) {
    const value = filters[field].trim();
    if (value) {
      lines.push(
        `The event field ${field} must contain ${JSON.stringify(value)}.`,
      );
    }
  }
  if (filters.additional.trim())
    lines.push(`Also: ${filters.additional.trim()}`);
  return lines.length ? lines.join("\n") : null;
}

export function AutomationEditorDialog({
  open,
  scope,
  automation,
  saving,
  error,
  onCancel,
  onSave,
}: AutomationEditorDialogProps) {
  const t = useT();
  const eventsQuery = useAutomationEvents();
  const org = useOrg();
  const orgId = org.data?.orgId ?? null;
  const orgName = org.data?.orgName ?? null;
  const isOwner = !automation || automation.capabilities.canManageSharing;
  const defaultSchedule = friendlyAutomationScheduleToCron(
    DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
  );
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<AutomationSharingState>(
    defaultAutomationSharingState(),
  );
  const [trigger, setTrigger] = useState<EditorTrigger>("schedule");
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [timezone, setTimezone] = useState(browserTimezone());
  const [eventName, setEventName] = useState("");
  const [eventCondition, setEventCondition] = useState("");
  const [emailFilters, setEmailFilters] = useState<EmailFilters>(() =>
    parseEmailCondition(null),
  );
  const [body, setBody] = useState("");
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextTrigger = editorTrigger(automation);
    setName(automation?.name.replace(/-/g, " ") ?? "");
    setTrigger(nextTrigger);
    setSchedule(automation?.schedule ?? defaultSchedule);
    setTimezone(automation?.timezone ?? browserTimezone());
    setEventName(
      automation?.triggerType === "event" && automation.event !== EMAIL_EVENT
        ? (automation.event ?? "")
        : "",
    );
    setEventCondition(
      automation?.triggerType === "event" && automation.event !== EMAIL_EVENT
        ? (automation.condition ?? "")
        : "",
    );
    setEmailFilters(
      parseEmailCondition(
        automation?.triggerType === "event" && automation.event === EMAIL_EVENT
          ? automation.condition
          : null,
      ),
    );
    setBody(automation?.body ?? "");
    setEventPickerOpen(false);
    setSubmitted(false);
    setSharing(
      automation
        ? automationSharingStateFromSummary(automation.sharing)
        : defaultAutomationSharingState(),
    );
  }, [automation, defaultSchedule, open, scope]);

  const events = eventsQuery.data ?? [];
  const emailAvailable = events.some((event) => event.name === EMAIL_EVENT);
  const nameInvalid = !automation && !name.trim();
  const bodyInvalid = !body.trim();
  const eventInvalid = trigger === "event" && !eventName;
  const scheduleInvalid =
    trigger === "schedule" && !isValidAutomationSchedule(schedule);
  const sharingInvalid = isOwner && !automationSharingIsValid(sharing, orgId);
  const invalid =
    nameInvalid ||
    bodyInvalid ||
    eventInvalid ||
    scheduleInvalid ||
    sharingInvalid;

  const reviewSummary = useMemo(() => {
    switch (trigger) {
      case "schedule":
        return t("jobs.editorReviewSchedule", {
          defaultValue: "Runs on {{schedule}} in {{timezone}}.",
          schedule,
          timezone,
        });
      case "manual":
        return t("jobs.editorReviewManual", {
          defaultValue: "Runs only when someone starts it on demand.",
        });
      case "email": {
        const filters = [
          emailFilters.from.trim()
            ? t("jobs.editorReviewEmailFromFilter", {
                defaultValue: "from contains “{{value}}”",
                value: emailFilters.from.trim(),
              })
            : null,
          emailFilters.to.trim()
            ? t("jobs.editorReviewEmailToFilter", {
                defaultValue: "to contains “{{value}}”",
                value: emailFilters.to.trim(),
              })
            : null,
          emailFilters.subject.trim()
            ? t("jobs.editorReviewEmailSubjectFilter", {
                defaultValue: "subject contains “{{value}}”",
                value: emailFilters.subject.trim(),
              })
            : null,
          emailFilters.additional.trim() || null,
        ].filter((value): value is string => value !== null);
        return filters.length
          ? t("jobs.editorReviewEmailFiltered", {
              defaultValue: "Runs when an email is received and {{condition}}.",
              condition: filters.join(", "),
            })
          : t("jobs.editorReviewEmail", {
              defaultValue: "Runs whenever an email is received.",
            });
      }
      default:
        return eventName
          ? eventCondition.trim()
            ? t("jobs.editorReviewConditionalEvent", {
                defaultValue: "Runs when {{event}} occurs and {{condition}}.",
                event: eventName,
                condition: eventCondition.trim(),
              })
            : t("jobs.editorReviewEvent", {
                defaultValue: "Runs when {{event}} occurs.",
                event: eventName,
              })
          : t("jobs.editorReviewEventPending", {
              defaultValue: "Choose the app event that starts this automation.",
            });
    }
  }, [emailFilters, eventCondition, eventName, schedule, t, timezone, trigger]);

  function submit() {
    setSubmitted(true);
    if (invalid) return;

    const needsAcknowledgement = automationSharingRequiresAcknowledgement(
      sharing.grants,
    );
    const sharingFields = isOwner
      ? {
          sharing: buildSharingSubmission(sharing, orgId),
          ...(needsAcknowledgement
            ? {
                acknowledgeExternalCollaborators:
                  sharing.acknowledgeExternalCollaborators,
              }
            : {}),
        }
      : {};

    const input: ManageAutomationInput = automation
      ? {
          operation: "update",
          resourceId: automation.resourceId,
          triggerType: trigger === "email" ? "event" : trigger,
          body: body.trim(),
          ...(trigger === "schedule"
            ? { schedule, timezone, condition: null }
            : {}),
          ...(trigger === "event"
            ? { event: eventName, condition: eventCondition.trim() || null }
            : {}),
          ...(trigger === "email"
            ? { event: EMAIL_EVENT, condition: emailCondition(emailFilters) }
            : {}),
          ...sharingFields,
        }
      : {
          operation: "create",
          name: name.trim(),
          scope,
          triggerType: trigger === "email" ? "event" : trigger,
          body: body.trim(),
          ...(trigger === "schedule"
            ? { schedule, timezone, condition: null }
            : {}),
          ...(trigger === "event"
            ? { event: eventName, condition: eventCondition.trim() || null }
            : {}),
          ...(trigger === "email"
            ? { event: EMAIL_EVENT, condition: emailCondition(emailFilters) }
            : {}),
          ...sharingFields,
        };
    onSave(input);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {automation
              ? t("jobs.editorEditTitle", { defaultValue: "Edit automation" })
              : t("jobs.editorCreateTitle", {
                  defaultValue: "Create an automation",
                })}
          </DialogTitle>
          <DialogDescription>
            {t("jobs.editorScopeDescription", {
              defaultValue: "This automation is fixed to the {{scope}} scope.",
              scope:
                scope === "organization"
                  ? t("jobs.editorScopeOrganization", {
                      defaultValue: "organization",
                    })
                  : t("jobs.editorScopePersonal", { defaultValue: "personal" }),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium" htmlFor="automation-name">
              {t("jobs.editorNameLabel", { defaultValue: "Name" })}
            </label>
            <Input
              id="automation-name"
              className="mt-1"
              value={name}
              readOnly={Boolean(automation)}
              aria-invalid={submitted && nameInvalid}
              placeholder={t("jobs.editorNamePlaceholder", {
                defaultValue: "Weekly customer summary",
              })}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            {automation ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("jobs.editorNameImmutable", {
                  defaultValue: "The name cannot be changed after creation.",
                })}
              </p>
            ) : submitted && nameInvalid ? (
              <p className="mt-1 text-xs text-destructive">
                {t("jobs.editorNameRequired", {
                  defaultValue: "Enter a name.",
                })}
              </p>
            ) : null}
          </div>

          <AutomationTriggerCards
            trigger={trigger}
            emailAvailable={emailAvailable}
            onChange={setTrigger}
            onOpenConnections={() => openAgentSettings("connections")}
          />

          {trigger === "schedule" ? (
            <AutomationScheduleFields
              schedule={schedule}
              timezone={timezone}
              disabled={saving}
              onScheduleChange={setSchedule}
              onTimezoneChange={setTimezone}
            />
          ) : null}

          {trigger === "event" ? (
            <AutomationEventFields
              events={events}
              loading={eventsQuery.isLoading}
              eventName={eventName}
              condition={eventCondition}
              pickerOpen={eventPickerOpen}
              invalid={submitted && eventInvalid}
              onPickerOpenChange={setEventPickerOpen}
              onEventChange={setEventName}
              onConditionChange={setEventCondition}
            />
          ) : null}

          {trigger === "email" ? (
            <AutomationEmailFields
              filters={emailFilters}
              onChange={setEmailFilters}
            />
          ) : null}

          <div>
            <label className="text-sm font-medium" htmlFor="automation-body">
              {t("jobs.editorInstructionsLabel", {
                defaultValue: "Instructions",
              })}
            </label>
            <Textarea
              id="automation-body"
              className="mt-1 min-h-28 resize-y"
              value={body}
              aria-invalid={submitted && bodyInvalid}
              placeholder={t("jobs.editorInstructionsPlaceholder", {
                defaultValue: "Describe what the agent should do…",
              })}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
            {submitted && bodyInvalid ? (
              <p className="mt-1 text-xs text-destructive">
                {t("jobs.editorInstructionsRequired", {
                  defaultValue: "Enter instructions for the automation.",
                })}
              </p>
            ) : null}
          </div>

          {isOwner ? (
            <AutomationSharingFields
              value={sharing}
              onChange={setSharing}
              orgId={orgId}
              orgName={orgName}
              disabled={saving}
              submitted={submitted}
            />
          ) : automation ? (
            <AutomationSharingSummaryView sharing={automation.sharing} />
          ) : null}

          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("jobs.editorReviewLabel", { defaultValue: "Review" })}
            </p>
            <p className="mt-1 text-sm">{reviewSummary}</p>
          </div>

          {scheduleInvalid && submitted ? (
            <p className="text-sm text-destructive">
              {t("jobs.cronInvalid", {
                defaultValue: "Enter a valid cron expression.",
              })}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            disabled={saving}
            onClick={onCancel}
          >
            {t("jobs.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            disabled={saving}
            onClick={submit}
          >
            {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {automation
              ? t("jobs.editorSave", { defaultValue: "Save changes" })
              : t("jobs.editorCreate", { defaultValue: "Create automation" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
