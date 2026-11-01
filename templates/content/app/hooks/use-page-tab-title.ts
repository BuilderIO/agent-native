import { useSessionPreloading } from "@agent-native/core/client/use-session";
import { useEffect } from "react";

// Names the open page in the browser tab, and puts back the tab's earlier
// title when the page closes, unless something else has renamed it since.
// While the app is mounted hidden ahead of the session read, the page may be
// another account's, and the tab is not hidden: it is named once the app shows.
export function usePageTabTitle(tabTitle: string | null) {
  const preloading = useSessionPreloading();
  useEffect(() => {
    if (tabTitle === null || preloading) return;
    const previousTitle = window.document.title;
    window.document.title = tabTitle;
    return () => {
      if (window.document.title === tabTitle) {
        window.document.title = previousTitle;
      }
    };
  }, [tabTitle, preloading]);
}
