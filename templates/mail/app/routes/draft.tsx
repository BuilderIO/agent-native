import { useSearchParams } from "react-router";

import { DraftCard } from "@/components/email/DraftCard";
import mailMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: mailMessages.mail.routeTitles.draft }];
}

// The card manage-draft embeds in MCP Apps hosts. The inbox deep link stays
// the way to open the draft in all of Mail.
export default function DraftCardRoute() {
  const [params] = useSearchParams();
  const draftId = params.get("id") ?? "";
  // A new ID is a new card, so one draft's unsaved edits never save to another.
  return <DraftCard key={draftId} draftId={draftId} />;
}
