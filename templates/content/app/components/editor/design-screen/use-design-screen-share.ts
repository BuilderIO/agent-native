import { useActionQuery } from "@agent-native/core/client/hooks";
import type { EmbedVisibility } from "@agent-native/core/shared";
import {
  DESIGN_SCREEN_TAG,
  type DesignScreenData,
} from "@shared/design-screen-block";
import { designScreensInBody } from "@shared/design-screens-in-body";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  designShareCheck,
  subPageScreensRead,
  type DesignShareCheck,
  type ScreensRead,
} from "./design-screen-share";

const NO_SCREENS: DesignScreenData[] = [];
const WIDGET_SUB_PAGES: ScreensRead = { screens: NO_SCREENS, unread: false };

export function useDesignScreenShareCheck(args: {
  documentId: string;
  documentContent: string | undefined;
  shareMounted: boolean;
  inWidget: boolean;
}): {
  check: (to: EmbedVisibility) => DesignShareCheck;
  subPagesReadAt: number;
  readSubPagesAgain: () => unknown;
} {
  const { documentId, documentContent, shareMounted, inWidget } = args;
  const [scan, setScan] = useState<{
    content: string | undefined;
    screens: DesignScreenData[];
    unreadable: number;
  } | null>(null);
  useEffect(() => {
    if (!shareMounted) return;
    let cancelled = false;
    designScreensInBody(documentContent).then(
      ({ screens, unreadable }) => {
        if (!cancelled) {
          setScan({ content: documentContent, screens, unreadable });
        }
      },
      () => {
        if (!cancelled) {
          setScan({ content: documentContent, screens: [], unreadable: 1 });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [documentContent, shareMounted]);
  const scanned =
    scan !== null && scan.content === documentContent ? scan : null;
  const screens = scanned ? scanned.screens : NO_SCREENS;
  const unread =
    Boolean(documentContent?.includes(`<${DESIGN_SCREEN_TAG}`)) &&
    (!scanned || scanned.unreadable > 0);
  const subPageScreens = useActionQuery(
    "list-sub-page-design-screens",
    { documentId },
    {
      enabled: shareMounted && !inWidget && Boolean(documentId),
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const subPageRead = useMemo(
    () =>
      inWidget
        ? WIDGET_SUB_PAGES
        : subPageScreensRead({
            data: subPageScreens.data,
            isError: subPageScreens.isError,
            isFetching: subPageScreens.isFetching,
          }),
    [
      inWidget,
      subPageScreens.data,
      subPageScreens.isError,
      subPageScreens.isFetching,
    ],
  );
  const check = useCallback(
    (to: EmbedVisibility) =>
      designShareCheck(to, { screens, unread }, subPageRead),
    [screens, unread, subPageRead],
  );
  const { dataUpdatedAt: subPagesReadAt, refetch: readSubPagesAgain } =
    subPageScreens;
  return useMemo(
    () => ({ check, subPagesReadAt, readSubPagesAgain }),
    [check, subPagesReadAt, readSubPagesAgain],
  );
}
