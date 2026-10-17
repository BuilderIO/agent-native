import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function emailToInitial(email: string) {
  return (email.split("@")[0]?.[0] ?? "?").toUpperCase();
}

export function CommentAvatar({
  email,
  name,
  className,
}: {
  email?: string | null;
  name?: string | null;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  const label = name ?? email ?? "";
  return (
    <UserAvatar className={cn("size-7 shrink-0", className)} title={label}>
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback
        className="text-xs font-medium text-primary-foreground"
        style={{ backgroundColor: emailToColor(email ?? "user") }}
      >
        {emailToInitial(label)}
      </UserAvatarFallback>
    </UserAvatar>
  );
}
