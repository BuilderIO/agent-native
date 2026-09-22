import { useT } from "@agent-native/core/client/i18n";
import type { EditionReaderStory } from "@shared/edition";
import { planPathForKind } from "@shared/plan-routes";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { editionStoryAnchorId } from "./EditionStory";
import {
  EDITION_LINK_CLASS,
  EDITION_META_CLASS,
  EditionLabel,
  editionStoryNumber,
} from "./editionTypography";

/**
 * Every row the same height, so the eye can run down the column without
 * re-measuring. Nothing in a row is optional: a stat on some rows and not
 * others is what breaks the scan.
 */
const ROW_CLASS =
  "grid h-11 grid-cols-[auto_minmax(0,7rem)_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)]";

/** The tail: stories with no prose of their own, one line each. */
export function EditionQuickLinks({
  stories,
  numberOf,
}: {
  stories: EditionReaderStory[];
  numberOf: Map<string, number>;
}) {
  const t = useT();
  if (stories.length === 0) return null;
  return (
    <section className="mt-14">
      <EditionLabel as="h2">{t("edition.story.quickLinks")}</EditionLabel>
      <ul className="mt-2">
        {stories.map((story) => {
          const recapId = story.recaps.find((recap) => recap.recapId)?.recapId;
          const area = story.tags[0];
          return (
            <li
              key={story.storyId}
              id={editionStoryAnchorId(story.storyId)}
              className={ROW_CLASS}
            >
              <span
                className={cn(EDITION_META_CLASS, "tabular-nums")}
                aria-hidden="true"
              >
                {editionStoryNumber(numberOf.get(story.storyId) ?? 0)}
              </span>
              <span className={cn(EDITION_META_CLASS, "truncate")}>
                {area ? `[${area}]` : null}
              </span>
              {recapId ? (
                <Link
                  to={planPathForKind(recapId, "recap")}
                  className={cn("truncate text-[0.95rem]", EDITION_LINK_CLASS)}
                >
                  {story.headline}
                </Link>
              ) : (
                <span className="truncate text-[0.95rem]">
                  {story.headline}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
