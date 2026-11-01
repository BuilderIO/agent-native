import { useSessionPreloading } from "@agent-native/core/client/use-session";
import { useEffect } from "react";

// Names the open page in the browser tab, and puts back the tab's earlier
// title when the page closes, unless something else has renamed it since.
// The tab is never hidden, so it names only a page this session may show:
// not while the app is mounted hidden ahead of the session read, and not
// until the page's read has been accepted for the session that answered
// (`accepted`); before that, the page may be another account's.
export function usePageTabTitle(tabTitle: string | null, accepted: boolean) {
  const preloading = useSessionPreloading();
  const shownTitle = accepted && !preloading ? tabTitle : null;
  useEffect(() => {
    if (shownTitle === null) return;
    const previousTitle = window.document.title;
    window.document.title = shownTitle;
    return () => {
      if (window.document.title === shownTitle) {
        window.document.title = previousTitle;
      }
    };
  }, [shownTitle]);
}
