import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
} from "@tabler/icons-react";

import { useT } from "../i18n.js";
import type { ScheduledTriggerState } from "./scheduled-trigger-state.js";

export interface ScheduledTriggerNoticeProps {
  state: ScheduledTriggerState;
  /** `banner` heads the page; `inline` sits inside the schedule dialog. */
  variant?: "banner" | "inline";
}

/**
 * Warns that schedule-triggered automations will not fire in this deploy.
 *
 * Worth a persistent surface rather than a one-time toast: whether a schedule
 * fires is decided by the BUILD, while automations are created at runtime, so
 * the mismatch is invisible at the moment it bites. Without this, a scheduled
 * automation reports "Enabled" with a plausible "Next run" and silently never
 * runs. Shown on the Automations page and again inside the schedule editor,
 * which is the one place a user is actively choosing a cadence.
 *
 * Takes the whole query state, not just a resolved status, because a status
 * check that FAILED has to look different from one that came back healthy: the
 * failure is why the next-run dates alongside it are unverified, and silently
 * rendering nothing would present them as confirmed.
 */
export function ScheduledTriggerNotice({
  state,
  variant = "banner",
}: ScheduledTriggerNoticeProps) {
  const t = useT();
  // Still in flight: resolves in milliseconds, so say nothing rather than
  // flash a caveat at every reader on a perfectly healthy deploy.
  if (state.kind === "loading") return null;

  const shell =
    variant === "banner"
      ? "flex items-start gap-2.5 rounded-xl border px-4 py-3"
      : "flex items-start gap-2 rounded-lg border px-3 py-2";

  // Muted rather than amber: "we could not check" is a weaker claim than "this
  // will not run", and dressing it identically would teach readers to discount
  // the one that means something.
  if (state.kind === "unknown") {
    return (
      <div
        role="status"
        data-testid="scheduled-trigger-notice"
        data-reason="check-failed"
        className={`${shell} border-border/70 bg-muted/50`}
      >
        <IconAlertCircle className="mt-px size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {t("jobs.scheduleUnknownTitle", {
              defaultValue: "Couldn't check whether schedules run here",
            })}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {t("jobs.scheduleUnknownDetail", {
              defaultValue:
                "The scheduler status check failed, so the next run times below " +
                "are unconfirmed. Reload to check again.",
            })}
          </p>
        </div>
      </div>
    );
  }

  const status = state.status;
  if (status.available) return null;

  const headline =
    status.reason === "local-development"
      ? t("jobs.scheduleUnavailableLocalTitle", {
          defaultValue: "Schedules don't run in local development",
        })
      : t("jobs.scheduleUnavailableTitle", {
          defaultValue: "Schedules won't run in this deploy",
        });

  const detail =
    status.reason === "disabled-by-env"
      ? t("jobs.scheduleUnavailableDisabled", {
          defaultValue:
            "This app was built with recurring jobs turned off, so no scheduled " +
            "automation will fire. Event-triggered automations and Run now still work.",
        })
      : status.reason === "no-platform-scheduler"
        ? t("jobs.scheduleUnavailableNoScheduler", {
            defaultValue:
              "This hosting target has no durable scheduler, so no scheduled automation will fire. Event-triggered automations and Run now still work.",
          })
        : t("jobs.scheduleUnavailableLocal", {
            defaultValue:
              "Schedules stay off on a dev machine unless you opt in. " +
              "Event-triggered automations and Run now still work.",
          });

  /**
   * Recovery steps, collapsed by default: the notice has to say what is wrong
   * before it says how to change it, and the how is longer than the what. Null
   * where nothing is actually toggleable — `no-platform-scheduler` means the
   * host has no scheduler to enable, so an empty disclosure would promise a fix
   * that does not exist.
   */
  const fix =
    status.reason === "disabled-by-env"
      ? t("jobs.scheduleUnavailableDisabledFix", {
          defaultValue:
            "To enable recurring jobs, set AGENT_NATIVE_DISABLE_RECURRING_JOBS=false in the build environment.",
        })
      : status.reason === "local-development"
        ? t("jobs.scheduleUnavailableLocalFix", {
            defaultValue:
              "Set AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS=true to run " +
              "schedules on this machine.",
          })
        : null;

  return (
    <div
      role="status"
      data-testid="scheduled-trigger-notice"
      data-reason={status.reason}
      className={`${shell} border-amber-500/40 bg-amber-500/10`}
    >
      <IconAlertTriangle className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {headline}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-amber-700/90 dark:text-amber-300/90">
          {detail}
        </p>
        {fix ? (
          // Native <details>: the collapsed text stays in the DOM, so
          // find-in-page still reaches the env var someone is looking for.
          <details className="group mt-1">
            <summary className="-ml-1.5 inline-flex w-fit cursor-pointer select-none list-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-400/15 [&::-webkit-details-marker]:hidden">
              <IconChevronRight className="size-3 shrink-0 transition-transform duration-150 group-open:rotate-90" />
              <span className="group-open:hidden">
                {t("jobs.scheduleUnavailableFixLabel", {
                  defaultValue: "Show more",
                })}
              </span>
              <span className="hidden group-open:inline">
                {t("jobs.scheduleUnavailableFixLabelOpen", {
                  defaultValue: "Show less",
                })}
              </span>
            </summary>
            <p className="mt-1 whitespace-pre-line text-[11px] leading-4 text-amber-700/90 dark:text-amber-300/90">
              {fix}
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
