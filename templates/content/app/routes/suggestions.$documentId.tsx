import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { contentSuggestionPath } from "@shared/suggestion-link";
import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";

import { SuggestionReviewCard } from "@/components/editor/SuggestionReviewCard";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].root.metaTitle }];
}

export function suggestionReviewIds(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

// The card is for hosts that embed it. In a browser tab, or a host that opens
// the link instead, the reviewer lands on the suggestion in its page.
function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  return window.self !== window.top || Boolean(getEmbedAuthToken());
}

export default function SuggestionReviewPage() {
  const { documentId = "" } = useParams<{ documentId: string }>();
  const [searchParams] = useSearchParams();
  const suggestionIds = useMemo(
    () => suggestionReviewIds(searchParams.get("ids")),
    [searchParams],
  );
  const [embedded] = useState(isEmbedded);

  if (!embedded) {
    const [first] = suggestionIds;
    return (
      <Navigate
        replace
        to={
          first
            ? contentSuggestionPath(documentId, first)
            : `/page/${encodeURIComponent(documentId)}`
        }
      />
    );
  }
  return (
    <SuggestionReviewCard
      documentId={documentId}
      suggestionIds={suggestionIds}
    />
  );
}
