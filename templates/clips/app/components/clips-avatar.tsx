import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useVisibleAvatarUrl } from "@/lib/use-visible-avatar-url";

interface ClipsAvatarProps {
  email: string | null | undefined;
  alt: string;
  fallback: ReactNode;
  className?: string;
  fallbackClassName?: string;
  title?: string;
}

export function ClipsAvatar({
  email,
  alt,
  fallback,
  className,
  fallbackClassName,
  title,
}: ClipsAvatarProps) {
  const { avatarRef, avatarUrl } = useVisibleAvatarUrl(email);

  return (
    <Avatar ref={avatarRef} className={className} title={title}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={alt} /> : null}
      <AvatarFallback className={fallbackClassName}>{fallback}</AvatarFallback>
    </Avatar>
  );
}
