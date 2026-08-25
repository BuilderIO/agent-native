import {
  IconCheckbox,
  IconFile,
  IconFileText,
  IconFolder,
  IconMail,
  IconMessageChatbot,
  IconPresentation,
  IconStack2,
  IconUser,
} from "@tabler/icons-react";

import type { MentionItemMedia as MentionItemMediaValue } from "./types.js";

const iconProps = { size: 14, className: "shrink-0 text-muted-foreground" };

export interface MentionItemMediaProps {
  icon?: string;
  media?: MentionItemMediaValue | null;
  size?: "sm" | "md";
  fallbackIcon?: "file" | "stack";
}

function LegacyMentionIcon({
  icon,
  fallbackIcon = "file",
}: Pick<MentionItemMediaProps, "icon" | "fallbackIcon">) {
  switch (icon) {
    case "folder":
      return <IconFolder {...iconProps} />;
    case "document":
      return <IconFileText {...iconProps} />;
    case "form":
      return <IconCheckbox {...iconProps} />;
    case "email":
      return <IconMail {...iconProps} />;
    case "user":
      return <IconUser {...iconProps} />;
    case "deck":
      return <IconPresentation {...iconProps} />;
    case "agent":
      return <IconMessageChatbot {...iconProps} />;
    case "file":
      return <IconFile {...iconProps} />;
    default:
      return fallbackIcon === "stack" ? (
        <IconStack2 {...iconProps} />
      ) : (
        <IconFile {...iconProps} />
      );
  }
}

export function MentionItemMedia({
  icon,
  media,
  size = "md",
  fallbackIcon = "file",
}: MentionItemMediaProps) {
  if (media?.type === "none") return null;
  if (media?.type === "text" && media.text.trim()) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${
          size === "sm" ? "size-4" : "size-5"
        }`}
        style={
          media.backgroundColor
            ? { backgroundColor: media.backgroundColor }
            : undefined
        }
      >
        <span
          className={`inline-grid place-items-center whitespace-nowrap leading-none ${
            size === "sm" ? "size-2 text-[8px]" : "size-3 text-[9px]"
          }`}
        >
          {media.text}
        </span>
      </span>
    );
  }
  if (media?.type === "image" && media.src.trim()) {
    const coversFrame = media.fit === "cover";
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${
          size === "sm" ? "size-4" : "size-5"
        }`}
        style={
          media.backgroundColor
            ? { backgroundColor: media.backgroundColor }
            : undefined
        }
      >
        <img
          alt=""
          src={media.src}
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          className={
            coversFrame
              ? "size-full object-cover"
              : size === "sm"
                ? "size-2 object-contain"
                : "size-3 object-contain"
          }
        />
      </span>
    );
  }
  return <LegacyMentionIcon icon={icon} fallbackIcon={fallbackIcon} />;
}
