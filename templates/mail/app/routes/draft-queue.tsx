import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import messages from "@/i18n/en-US";
import { DraftQueuePage } from "@/pages/DraftQueuePage";

export function loader({ params, request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  if (!params.id && !searchParams.has("id") && !searchParams.has("scope")) {
    return withSsrHtmlContentType(redirect("/drafts"));
  }
  return null;
}

export function meta() {
  return [{ title: messages.mail.routeTitles.draftQueue }];
}

export default function DraftQueueRoute() {
  return <DraftQueuePage />;
}
