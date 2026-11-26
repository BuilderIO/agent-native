import { Navigate, useParams, useSearchParams } from "react-router";

import messages from "@/i18n/en-US";
import { DraftQueuePage } from "@/pages/DraftQueuePage";

export function meta() {
  return [{ title: messages.mail.routeTitles.draftQueue }];
}

export default function DraftQueueRoute() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  if (!id && !searchParams.has("id") && !searchParams.has("scope")) {
    return <Navigate to="/drafts" replace />;
  }
  return <DraftQueuePage />;
}
