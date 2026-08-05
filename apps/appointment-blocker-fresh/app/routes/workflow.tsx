import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  setClientAppState,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCheck,
  IconMessageCircle,
  IconSearch,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatPlanDate, type AppointmentPlan } from "@/lib/appointment-plan";
import { TAB_ID } from "@/lib/tab-id";

const DEMO_SOURCE =
  "Appointment | Wed Oct 7, 2026 9am - 9:30am (PDT)\nAppointment | Wed Oct 14, 2026 4pm - 5pm (PDT)";
const DEMO_CALENDAR =
  "Internal sync | Wed Oct 7, 2026 8:30am - 9am | attendees: teammate@builder.io\nCustomer call | Wed Oct 14, 2026 4:30pm - 5pm | attendees: partner@example.com";

export function meta() {
  return [
    { title: "Appointment Blocker" },
    {
      name: "description",
      content:
        "Prepare buffered work-calendar blocks and review external attendee conflicts.",
    },
  ];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The workflow step failed.";
}

function conflictSummary(plan: AppointmentPlan, t: (key: string) => string) {
  switch (plan.conflictCheck.status) {
    case "clear":
      return { icon: IconCheck, text: t("workflow.clear") };
    case "internal_only":
      return { icon: IconShieldCheck, text: t("workflow.internalOnly") };
    case "external_conflicts":
      return { icon: IconAlertTriangle, text: t("workflow.externalConflicts") };
    default:
      return { icon: IconSearch, text: t("workflow.noCheck") };
  }
}

export default function AppointmentPlannerRoute() {
  const t = useT();
  const [sourceText, setSourceText] = useState(DEMO_SOURCE);
  const [calendarText, setCalendarText] = useState(DEMO_CALENDAR);
  const [bufferMinutes, setBufferMinutes] = useState(30);
  const [confirmed, setConfirmed] = useState(false);

  const planQuery = useActionQuery<AppointmentPlan | null>(
    "get-appointment-plan" as never,
    {} as never,
  );
  const prepare = useActionMutation<
    AppointmentPlan,
    { sourceText: string; bufferMinutes: number; sourceLabel: string }
  >("prepare-appointment-blocks" as never);
  const check = useActionMutation<AppointmentPlan, { calendarText: string }>(
    "check-appointment-conflicts" as never,
  );
  const apply = useActionMutation<
    AppointmentPlan,
    { planId: string; confirmed: true }
  >("apply-appointment-blocks" as never);

  const plan = planQuery.data ?? null;

  useEffect(() => {
    void setClientAppState(
      "selection",
      plan
        ? {
            kind: "appointment-plan",
            planId: plan.planId,
            status: plan.status,
            conflictStatus: plan.conflictCheck.status,
          }
        : null,
      { requestSource: TAB_ID },
    );
  }, [plan]);

  async function preparePlan() {
    try {
      await prepare.mutateAsync({
        sourceText,
        bufferMinutes,
        sourceLabel: "Personal inbox",
      });
      await planQuery.refetch();
      setConfirmed(false);
      toast.success(t("workflow.prepared"));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function checkConflicts() {
    try {
      await check.mutateAsync({ calendarText });
      await planQuery.refetch();
      setConfirmed(false);
      toast.success("Calendar conflict check complete.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function askAgentToReadInbox() {
    sendToAgentChat({
      message:
        "Read my connected personal inbox for appointment invitations. Extract only the appointment title, exact date, start time, end time, and timezone. Do not modify the inbox or calendar. Return compact lines that this app can parse, then wait for me to prepare the blocks.",
      submit: true,
      chatTarget: "local",
      openSidebar: true,
    });
  }

  function askAgentToCheckCalendar() {
    if (!plan) return;
    const windows = plan.appointments
      .map(
        (appointment) =>
          `- ${appointment.title}: ${formatPlanDate(appointment.blockStart)} to ${formatPlanDate(appointment.blockEnd)}`,
      )
      .join("\n");
    sendToAgentChat({
      message: `Search my connected work calendar for these exact windows and identify meetings overlapping them. Read attendee details and classify any human attendee whose email is not @builder.io as external. Do not create or change events yet. Then call check-appointment-conflicts with a compact calendar snapshot so this page can show the review.\n\nPrepared windows:\n${windows}`,
      submit: true,
      chatTarget: "local",
      openSidebar: true,
    });
  }

  async function approveAndHandoff() {
    if (!plan || !confirmed) return;
    try {
      const approved = await apply.mutateAsync({
        planId: plan.planId,
        confirmed: true,
      });
      await planQuery.refetch();
      setConfirmed(false);
      const windows = approved.appointments
        .map(
          (appointment) =>
            `- ${appointment.title}: ${formatPlanDate(appointment.blockStart)} to ${formatPlanDate(appointment.blockEnd)}`,
        )
        .join("\n");
      sendToAgentChat({
        message: `The user explicitly approved these private busy blocks. Create them on the connected work calendar with no guests, no invitations, private visibility, and opaque/busy transparency. Re-check the exact windows before writing. Report each created event and any provider limitation.\n\nApproved windows:\n${windows}`,
        submit: true,
        chatTarget: "local",
        openSidebar: true,
      });
      toast.success(t("workflow.approved"));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const summary = plan ? conflictSummary(plan, t) : null;
  const SummaryIcon = summary?.icon;
  const step = !plan
    ? "capture"
    : plan.conflictCheck.status === "not_checked"
      ? "check"
      : "confirm";
  const stepNumber = step === "capture" ? 1 : step === "check" ? 2 : 3;

  return (
    <main className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-12">
        <header className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <IconCalendarEvent size={15} />
              <span>Block time</span>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              Local preview
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Protect time around appointments
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Prepare private calendar blocks, check conflicts, then approve the
            exact handoff.
          </p>
        </header>

        <ol
          className="mb-5 grid grid-cols-3 gap-2 text-xs"
          aria-label="Progress"
        >
          {[
            [1, "Capture", "capture"],
            [2, "Check", "check"],
            [3, "Confirm", "confirm"],
          ].map(([number, label, value]) => {
            const isCurrent = value === step;
            const isComplete = Number(number) < stepNumber;
            return (
              <li
                key={value}
                className={`flex items-center gap-2 border-b pb-2 ${isCurrent ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
              >
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${isCurrent || isComplete ? "bg-foreground text-background" : "border border-border"}`}
                >
                  {number}
                </span>
                <span className="font-medium">{label}</span>
              </li>
            );
          })}
        </ol>

        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Step {stepNumber} of 3
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              {step === "capture"
                ? "Capture invitations"
                : step === "check"
                  ? "Check your work calendar"
                  : "Review and approve"}
            </h2>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
            {step === "capture" ? (
              <>
                <div className="space-y-2">
                  <label
                    htmlFor="appointment-source"
                    className="text-sm font-medium text-foreground"
                  >
                    Appointment invitations
                  </label>
                  <textarea
                    id="appointment-source"
                    aria-label="Appointment invitations"
                    className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    placeholder={t("workflow.sourcePlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste one invitation per line. Example data is prefilled for
                    local testing.
                  </p>
                </div>

                <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-end sm:justify-between">
                  <label className="grid gap-1.5 text-sm font-medium text-foreground">
                    Buffer on each side
                    <span className="flex items-center gap-2">
                      <input
                        className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        type="number"
                        min={0}
                        max={240}
                        step={5}
                        value={bufferMinutes}
                        onChange={(event) =>
                          setBufferMinutes(Number(event.target.value))
                        }
                      />
                      <span className="text-sm font-normal text-muted-foreground">
                        minutes
                      </span>
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={askAgentToReadInbox}
                    >
                      <IconMessageCircle size={16} />
                      Ask agent
                    </Button>
                    <Button
                      type="button"
                      onClick={preparePlan}
                      disabled={prepare.isPending || !sourceText.trim()}
                    >
                      {prepare.isPending ? "Preparing..." : "Prepare blocks"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}

            {step === "check" && plan ? (
              <>
                <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {plan.appointments.length} appointment
                      {plan.appointments.length === 1 ? "" : "s"} ready
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {plan.bufferMinutes}-minute buffer · {plan.timezone}
                    </p>
                  </div>
                  <IconCheck className="size-5 text-muted-foreground" />
                </div>

                <details className="group rounded-lg border border-border">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:hidden">
                    <span className="flex items-center justify-between gap-3">
                      Edit invitations and buffer
                      <span className="text-xs text-muted-foreground group-open:hidden">
                        Show
                      </span>
                      <span className="hidden text-xs text-muted-foreground group-open:inline">
                        Hide
                      </span>
                    </span>
                  </summary>
                  <div className="space-y-4 border-t border-border px-4 py-4">
                    <textarea
                      aria-label="Edit appointment invitations"
                      className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={sourceText}
                      onChange={(event) => setSourceText(event.target.value)}
                    />
                    <div className="flex items-end justify-between gap-3">
                      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                        Buffer minutes
                        <input
                          className="h-9 w-24 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          type="number"
                          min={0}
                          max={240}
                          step={5}
                          value={bufferMinutes}
                          onChange={(event) =>
                            setBufferMinutes(Number(event.target.value))
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={preparePlan}
                        disabled={prepare.isPending || !sourceText.trim()}
                      >
                        {prepare.isPending ? "Updating..." : "Update blocks"}
                      </Button>
                    </div>
                  </div>
                </details>

                <div className="space-y-2">
                  <label
                    htmlFor="calendar-snapshot"
                    className="text-sm font-medium text-foreground"
                  >
                    Work calendar snapshot
                  </label>
                  <textarea
                    id="calendar-snapshot"
                    aria-label="Work calendar snapshot"
                    className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                    value={calendarText}
                    onChange={(event) => setCalendarText(event.target.value)}
                    placeholder={t("workflow.calendarPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste a bounded snapshot for local testing, or ask the agent
                    to read the connected calendar.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={askAgentToCheckCalendar}
                  >
                    <IconMessageCircle size={16} />
                    Ask agent
                  </Button>
                  <Button
                    type="button"
                    onClick={checkConflicts}
                    disabled={check.isPending || !calendarText.trim()}
                  >
                    {check.isPending ? "Checking..." : "Check conflicts"}
                  </Button>
                </div>
              </>
            ) : null}

            {step === "confirm" && plan ? (
              <>
                <div className="flex items-start gap-3 rounded-lg bg-muted/50 px-4 py-3">
                  {SummaryIcon ? (
                    <SummaryIcon className="mt-0.5 size-5" />
                  ) : null}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {summary?.text}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Review the exact private blocks before anything is
                      written.
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-border rounded-lg border border-border">
                  {plan.appointments.map((appointment) => (
                    <div key={appointment.id} className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">
                        {appointment.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {formatPlanDate(appointment.blockStart)} to{" "}
                        {formatPlanDate(appointment.blockEnd)}
                      </p>
                    </div>
                  ))}
                </div>

                <details className="group rounded-lg border border-border">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:hidden">
                    <span className="flex items-center justify-between gap-3">
                      Edit calendar snapshot
                      <span className="text-xs text-muted-foreground group-open:hidden">
                        Show
                      </span>
                      <span className="hidden text-xs text-muted-foreground group-open:inline">
                        Hide
                      </span>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-border px-4 py-4">
                    <textarea
                      aria-label="Edit calendar snapshot"
                      className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={calendarText}
                      onChange={(event) => setCalendarText(event.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={checkConflicts}
                        disabled={check.isPending || !calendarText.trim()}
                      >
                        {check.isPending ? "Checking..." : "Recheck conflicts"}
                      </Button>
                    </div>
                  </div>
                </details>

                {plan.conflictCheck.conflicts.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Conflicts found
                    </p>
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {plan.conflictCheck.conflicts.map((conflict) => (
                        <div
                          key={`${conflict.title}-${conflict.startTime}`}
                          className="px-4 py-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-foreground">
                              {conflict.title}
                            </p>
                            {conflict.externalAttendees.length ? (
                              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                External attendee
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {formatPlanDate(conflict.startTime)} to{" "}
                            {formatPlanDate(conflict.endTime)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {plan.status === "approved" ? (
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <IconCheck className="size-5" />
                    {t("workflow.approved")}
                  </div>
                ) : (
                  <>
                    <label className="flex items-start gap-3 border-t border-border pt-5 text-sm">
                      <input
                        className="mt-0.5 size-4 accent-foreground"
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      <span className="leading-5 text-foreground">
                        I approve these private busy blocks.
                      </span>
                    </label>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={approveAndHandoff}
                      disabled={!confirmed || apply.isPending}
                    >
                      <IconCheck size={16} />
                      {apply.isPending
                        ? "Approving..."
                        : "Approve and hand off"}
                    </Button>
                  </>
                )}
              </>
            ) : null}
          </div>

          <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-7">
            Nothing is written to your calendar until you approve.
          </footer>
        </section>
      </div>
    </main>
  );
}
