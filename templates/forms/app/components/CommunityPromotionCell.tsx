import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconUpload } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePromoteCommunitySubmission } from "@/hooks/use-responses";

import type { FormResponse } from "../../shared/types";

const DOCS_ORIGIN = "https://www.agent-native.com";

export function CommunityPromotionCell({
  response,
}: {
  response: FormResponse;
}) {
  const t = useT();
  const promotion = usePromoteCommunitySubmission();
  const [localError, setLocalError] = useState<string | null>(null);

  function publish() {
    setLocalError(null);
    promotion.mutate(
      { responseId: response.id },
      {
        onError: (error) => {
          setLocalError(
            actionErrorMessage(error) ??
              t("responses.communityPromotionFailed"),
          );
        },
      },
    );
  }

  const status = response.communityPromotion?.status;
  if (status === "published" && response.communityPromotion?.communitySlug) {
    return (
      <div className="flex min-w-32 flex-col items-start gap-1.5">
        <Badge variant="secondary">{t("responses.communityPublished")}</Badge>
        <a
          href={`${DOCS_ORIGIN}/apps/community/${encodeURIComponent(response.communityPromotion.communitySlug)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("responses.communityView")}
          <IconExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    );
  }

  const error = localError ?? response.communityPromotion?.error;
  if (status === "publishing") {
    return (
      <div className="min-w-40 space-y-1">
        <Badge variant="outline">{t("responses.communityNeedsCheck")}</Badge>
        {error ? (
          <p className="m-0 max-w-48 text-xs leading-4 text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (status === "unknown") {
    return (
      <div className="min-w-40 space-y-1.5">
        <Badge variant="outline">{t("responses.communityNeedsCheck")}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={promotion.isPending}
          onClick={publish}
        >
          <IconUpload className="size-3.5" aria-hidden="true" />
          {promotion.isPending
            ? t("responses.communityPublishing")
            : t("common.retry")}
        </Button>
        {error ? (
          <p className="m-0 max-w-48 text-xs leading-4 text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-40 space-y-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        disabled={promotion.isPending}
        onClick={publish}
      >
        <IconUpload className="size-3.5" aria-hidden="true" />
        {promotion.isPending
          ? t("responses.communityPublishing")
          : status === "failed"
            ? t("common.retry")
            : t("responses.communityPublish")}
      </Button>
      {error ? (
        <p className="m-0 max-w-48 text-xs leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
