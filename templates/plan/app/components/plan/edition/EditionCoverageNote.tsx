import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { EditionCoverageData, EditionMissingPr } from "@shared/edition";

import { EditionStatUnavailable } from "./editionStats";
import { EditionLabel } from "./editionTypography";

/**
 * The colophon: what this edition could and could not see. Recap coverage runs
 * well under 100%, so the uncovered pull requests are listed by name — an
 * edition that quietly reads as the whole day is the failure this states.
 */
export function EditionCoverageNote({
  coverage,
}: {
  coverage: EditionCoverageData;
}) {
  const t = useT();
  const { formatList } = useFormatters();
  const missing = coverage.missingPrs;
  const stale = coverage.stalePrs ?? [];

  return (
    <section>
      <EditionLabel as="h2">{t("edition.coverage.label")}</EditionLabel>
      <dl className="mt-3 flex flex-col gap-3 text-sm text-plan-muted">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt>{t("edition.coverage.reposLabel")}</dt>
          <dd className="text-plan-text">
            {coverage.reposCovered.length > 0 ? (
              formatList(coverage.reposCovered)
            ) : (
              <EditionStatUnavailable
                label={t("edition.coverage.reposUnavailable")}
              />
            )}
          </dd>
        </div>
      </dl>
      {missing.length > 0 ? (
        <CoverageGap note={t("edition.coverage.missingNote")} prs={missing} />
      ) : null}
      {stale.length > 0 ? (
        <CoverageGap note={t("edition.coverage.staleNote")} prs={stale} />
      ) : null}
      {missing.length === 0 && stale.length === 0 ? (
        <p className="mt-4 max-w-[62ch] text-sm leading-[1.55] text-plan-muted">
          {t("edition.coverage.complete")}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A named gap plus the pull requests it covers. "No recap at all" and "a recap
 * that never got re-published at merge" are different gaps with different
 * fixes, so they render as separate lists instead of one merged count.
 */
function CoverageGap({ note, prs }: { note: string; prs: EditionMissingPr[] }) {
  return (
    <div className="mt-5">
      <p className="max-w-[62ch] text-sm leading-[1.55] text-plan-text">
        {note}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-snug text-plan-muted">
        {prs.map((pr) => (
          <li key={`${pr.repo}#${pr.prNumber}`}>
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-plan-text underline decoration-plan-line underline-offset-4 transition-[text-decoration-color] hover:decoration-current"
            >
              {`${pr.repo}#${pr.prNumber}`}
            </a>{" "}
            {pr.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
