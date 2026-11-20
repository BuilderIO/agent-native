import type { EmbedVisibility } from "@agent-native/core/shared";
import {
  designScreensWiderThan,
  type DesignScreenData,
} from "@shared/design-screen-block";

type Screen = Pick<DesignScreenData, "screen" | "design">;

/** Screens read from saved pages; `unread` while some can't be weighed yet. */
export interface ScreensRead {
  screens: readonly Screen[];
  unread: boolean;
}

/** The screens a change would show to more people, from one set of pages. */
export interface ScreensGoingWider {
  wider: Screen[];
  unread: boolean;
}

export interface DesignShareCheck {
  page: ScreensGoingWider;
  /**
   * Going public carries the sub-pages that aren't public yet, so their
   * screens count too; null for any other change.
   */
  subPages: ScreensGoingWider | null;
}

/** What the share dialog has read of the sub-pages' screens. */
export interface SubPageScreensQuery {
  data?:
    | {
        screens?: readonly Screen[] | undefined;
        unreadable?: number | undefined;
        more?: boolean | undefined;
      }
    | undefined;
  isError: boolean;
  isFetching: boolean;
}

/**
 * The sub-pages' screens, or unread while they're loading, when the last
 * read failed (a failed refetch keeps the earlier answer), when the answer
 * isn't whole, or when some can't be weighed.
 */
export function subPageScreensRead(query: SubPageScreensQuery): ScreensRead {
  const { data } = query;
  if (
    data === undefined ||
    !Array.isArray(data.screens) ||
    typeof data.unreadable !== "number" ||
    typeof data.more !== "boolean" ||
    data.unreadable > 0 ||
    data.more ||
    query.isError ||
    query.isFetching
  ) {
    return { screens: [], unread: true };
  }
  return { screens: data.screens ?? [], unread: false };
}

function goingWider(to: EmbedVisibility, read: ScreensRead): ScreensGoingWider {
  if (read.unread) return { wider: [], unread: true };
  return { wider: designScreensWiderThan(to, read.screens), unread: false };
}

/**
 * What opening a page to `to` shows to more people: the page's own pinned
 * screens, and when it goes public, those in the sub-pages that go public
 * with it. Sharing is a deliberate step, so it asks and never refuses.
 */
export function designShareCheck(
  to: EmbedVisibility,
  page: ScreensRead,
  subPages: ScreensRead,
): DesignShareCheck {
  return {
    page: goingWider(to, page),
    subPages: to === "public" ? goingWider(to, subPages) : null,
  };
}

/** Whether the share dialog asks before making the change. */
export function designShareAsks(check: DesignShareCheck): boolean {
  return [check.page, check.subPages].some(
    (part) => part !== null && (part.unread || part.wider.length > 0),
  );
}

/** The share dialog's line about the screens going wider, if any. */
export function designShareDetail(
  check: DesignShareCheck,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const describe = (
    part: ScreensGoingWider,
    keys: { unread: string; one: string; many: string },
  ) => {
    if (part.unread) return t(keys.unread);
    if (part.wider.length === 0) return null;
    const designs = [
      ...new Set(part.wider.map((screen) => screen.design.title)),
    ].join(", ");
    return part.wider.length === 1
      ? t(keys.one, { designs })
      : t(keys.many, { count: part.wider.length, designs });
  };
  const parts = [
    describe(check.page, {
      unread: "designScreen.shareDetailUnread",
      one: "designScreen.shareDetailOne",
      many: "designScreen.shareDetail",
    }),
    check.subPages &&
      describe(check.subPages, {
        unread: "designScreen.shareDetailSubPagesUnread",
        one: "designScreen.shareDetailSubPagesOne",
        many: "designScreen.shareDetailSubPages",
      }),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}
