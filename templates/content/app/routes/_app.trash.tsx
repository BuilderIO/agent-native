import { useSearchParams } from "react-router";

import { TrashBrowser } from "@/components/trash/TrashBrowser";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: `${messagesByLocale["en-US"].sidebar.trash} - Content` }];
}

export default function TrashRoute() {
  const [searchParams] = useSearchParams();
  return (
    <TrashBrowser
      initialPreviewId={searchParams.get("preview")}
      fullPagePreview={searchParams.get("full") === "1"}
    />
  );
}
