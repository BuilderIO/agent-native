import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { planPathForKind } from "@shared/plan-routes";
import { IconPlayerPlay } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { EditionMasthead, useEditionDateline } from "./EditionMasthead";
import {
  EditionSignInPrompt,
  isUnauthorizedError,
} from "./EditionSignInPrompt";
import { EDITION_LINK_CLASS, EDITION_META_CLASS } from "./editionTypography";

export type EditionListItem = {
  id: string;
  title: string;
  brief: string;
  dateKey: string;
  windowStart: string;
  windowEnd: string;
  updatedAt: string;
  storyCount: number;
};

export type ListEditionsResult = { editions: EditionListItem[] };

const ARCHIVE_LIMIT = 60;

const ROW_CLASS =
  "grid gap-x-10 gap-y-2 py-5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]";

function ArchiveRow({ edition }: { edition: EditionListItem }) {
  const dateline = useEditionDateline(edition.dateKey);
  return (
    <li className={ROW_CLASS}>
      <p className={`${EDITION_META_CLASS} tabular-nums`}>{dateline}</p>
      <div className="min-w-0">
        <h2 className="text-balance text-xl font-bold leading-[1.2] tracking-[-0.015em]">
          <Link
            to={planPathForKind(edition.id, "edition")}
            className={EDITION_LINK_CLASS}
          >
            {edition.title}
          </Link>
        </h2>
        {edition.brief && (
          <p className="mt-2 max-w-[68ch] text-pretty text-[0.95rem] leading-[1.6] text-plan-muted">
            {edition.brief}
          </p>
        )}
      </div>
    </li>
  );
}

function ArchiveSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-label={t("edition.archive.loading")}>
      <span className="sr-only">{t("edition.archive.loading")}</span>
      <ul aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className={ROW_CLASS}>
            <Skeleton className="h-3 w-28" />
            <div className="flex min-w-0 flex-col gap-3">
              <Skeleton className="h-6 w-full max-w-[26rem]" />
              <Skeleton className="h-4 w-full max-w-[34rem]" />
              <Skeleton className="h-4 w-full max-w-[22rem]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArchiveBody() {
  const t = useT();
  const query = useActionQuery<ListEditionsResult>("list-editions", {
    limit: ARCHIVE_LIMIT,
  });

  if (query.isPending) return <ArchiveSkeleton />;

  // A settled query whose payload has no `editions` array is a broken read,
  // not an empty archive. Reporting it as "no editions yet" would hide it.
  const editions = Array.isArray(query.data?.editions)
    ? query.data.editions
    : null;
  if (isUnauthorizedError(query.error)) return <EditionSignInPrompt />;
  if (query.isError || editions === null) {
    return (
      <div>
        <p className="text-sm leading-[1.55] text-plan-text">
          {t("edition.archive.error")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          {t("edition.archive.retry")}
        </Button>
      </div>
    );
  }

  if (editions.length === 0) {
    return (
      <div>
        <p className="text-sm leading-[1.55] text-plan-muted">
          {t("edition.archive.empty")}
        </p>
        <div className="mt-4">
          <BuildEditionButton label={t("edition.archive.build")} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end">
        <BuildEditionButton label={t("edition.archive.build")} />
      </div>
      <ol className="mt-4">
        {editions.map((edition) => (
          <ArchiveRow key={edition.id} edition={edition} />
        ))}
      </ol>
    </div>
  );
}

/** The index: every published edition, newest first. */

/**
 * The only way to make an edition is to ask the agent — there is no form,
 * because the hard part is editorial judgement, not data entry. This hands the
 * agent a prompt rather than calling a model from the UI, per `delegate-to-agent`.
 */
function BuildEditionButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        sendToAgentChat({
          type: "content",
          submit: true,
          openSidebar: true,
          message:
            "Publish today's edition of the engineering newspaper for the previous day, following the plan-editions skill.",
          context: [
            "The user pressed Build edition on the /editions archive.",
            "Series: daily. Scope: every repo the caller can see.",
            "Fetch the merged-PR ledger through the GitHub provider API, call list-edition-candidates with the window aligned to the caller's timezone, then call create-edition exactly once.",
          ].join("\n"),
        })
      }
    >
      <IconPlayerPlay className="size-3.5" />
      {label}
    </Button>
  );
}

export function EditionArchive() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-10 sm:px-10 sm:py-14">
      <EditionMasthead />
      <div className="mt-8">
        <ArchiveBody />
      </div>
    </div>
  );
}
