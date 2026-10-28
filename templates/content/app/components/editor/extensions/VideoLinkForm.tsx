import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import { useT } from "@agent-native/core/client/i18n";
import { CLIP_EMBED_FLAG } from "@shared/feature-flags";
import { resolveVideoLink, type ResolvedVideoLink } from "@shared/video-link";
import { useState, type FormEvent } from "react";

import { useClipsLinks } from "@/components/editor/clip-embed/use-clips-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { probeVideoSource } from "./video-link-probe";

type Refusal = Extract<ResolvedVideoLink, { kind: "refused" }>["reason"];

const REFUSAL_MESSAGES: Record<Refusal, string> = {
  invalid: "editor.media.pasteValidVideoUrl",
  "clips-disabled": "clipEmbed.linkClipsDisabled",
  "clips-page": "clipEmbed.linkClipsPage",
  "video-page": "clipEmbed.linkVideoPage",
  "not-video": "clipEmbed.linkNotVideo",
};

/**
 * The video block's Link tab. A link it can play becomes the video; a Clips
 * link becomes a Clip block; anything else is refused here, before it can
 * be saved as a video that never plays.
 */
export function VideoLinkForm({
  replace,
  onVideo,
  onClip,
}: {
  replace: boolean;
  onVideo: (src: string) => void;
  onClip: (recordingId: string) => void;
}) {
  const t = useT();
  const clipsEnabled = useFeatureFlag(CLIP_EMBED_FLAG.key);
  const clipsLinks = useClipsLinks();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    if (!input || checking || !clipsLinks.settled) return;
    setRefusal(null);
    setChecking(true);
    const link = await resolveVideoLink(input, {
      clipsOrigins: clipsLinks.linkOrigins,
      clipsEnabled,
      probe: probeVideoSource,
    });
    setChecking(false);
    if (link.kind === "refused") setRefusal(link.reason);
    else if (link.kind === "clip") onClip(link.recordingId);
    else onVideo(link.src);
  }

  return (
    <form
      className="media-source-panel__body"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <Input
        autoFocus
        type="url"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setRefusal(null);
        }}
        placeholder={t("editor.media.pasteVideoLink")}
        aria-invalid={refusal ? true : undefined}
      />
      <Button
        type="submit"
        className="w-full"
        disabled={checking || !clipsLinks.settled}
      >
        {checking
          ? t("clipEmbed.linkChecking")
          : replace
            ? t("editor.media.replaceVideo")
            : t("editor.media.embedVideo")}
      </Button>
      {refusal ? (
        <p role="alert" className="text-center text-xs text-destructive">
          {t(REFUSAL_MESSAGES[refusal])}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {t("editor.media.videoLinkHint")}
        </p>
      )}
    </form>
  );
}
