import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { EDITION_META_CLASS } from "./editionTypography";

type FormatDate = ReturnType<typeof useFormatters>["formatDate"];

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const ISSUE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};

const RANGE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

/**
 * A day key is a wall-clock date in the edition's own zone, so it is formatted
 * as UTC civil time. Reading it as an instant would shift the dateline a day
 * west of the date the edition is named after.
 */
function formatEditionDayKey(
  dayKey: string,
  formatDate: FormatDate,
  options: Intl.DateTimeFormatOptions,
): string {
  const match = DAY_KEY_RE.exec(dayKey);
  if (!match) return dayKey;
  return formatDate(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    { timeZone: "UTC", ...options },
  );
}

export function useEditionDateline(
  dateKey: string | null | undefined,
): string | null {
  const t = useT();
  const { formatDate } = useFormatters();
  if (!dateKey) return null;
  const [start, end] = dateKey.split("_");
  if (!start) return null;
  if (end) {
    return t("edition.masthead.dateRange", {
      start: formatEditionDayKey(start, formatDate, RANGE_DATE_OPTIONS),
      end: formatEditionDayKey(end, formatDate, RANGE_DATE_OPTIONS),
    });
  }
  return formatEditionDayKey(start, formatDate, ISSUE_DATE_OPTIONS);
}

type EditionMastheadProps = {
  /** Sends the nameplate back to the archive. Omit on the archive itself. */
  archiveHref?: string;
  issueNumber?: number | null;
  dateKey?: string;
  title?: string;
  brief?: string;
};

export function EditionMasthead({
  archiveHref,
  issueNumber,
  dateKey,
  title,
  brief,
}: EditionMastheadProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const dateline = useEditionDateline(dateKey);
  const nameplate = t("edition.masthead.nameplate");
  const issue =
    typeof issueNumber === "number"
      ? t("edition.masthead.issue", { number: formatNumber(issueNumber) })
      : null;
  const stamp =
    issue && dateline
      ? t("edition.masthead.dateline", { issue, date: dateline })
      : (issue ?? dateline);

  return (
    <header>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
        {/* guard:allow-eyebrow — deliberate: the nameplate is the newspaper's
            masthead, not a label describing the headline under it. */}
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-plan-text">
          {archiveHref ? (
            <Link
              to={archiveHref}
              className="transition-colors hover:text-plan-muted"
            >
              {nameplate}
            </Link>
          ) : (
            nameplate
          )}
        </p>
        {stamp && (
          <p className={`${EDITION_META_CLASS} tabular-nums`}>{stamp}</p>
        )}
      </div>
      {title && (
        <h1 className="mt-6 max-w-[34ch] text-balance text-[2rem] font-bold leading-[1.04] tracking-[-0.03em] sm:text-[2.7rem]">
          {title}
        </h1>
      )}
      {brief && (
        <p className="mt-4 max-w-[62ch] text-pretty text-lg leading-[1.6] text-plan-muted">
          {brief}
        </p>
      )}
    </header>
  );
}
