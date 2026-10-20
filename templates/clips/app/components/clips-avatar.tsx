import {
  forwardRef,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useVisibleAvatarUrl } from "@/lib/use-visible-avatar-url";

interface ClipsAvatarProps extends Omit<
  ComponentPropsWithoutRef<typeof Avatar>,
  "children"
> {
  email: string | null | undefined;
  alt: string;
  fallback: ReactNode;
  fallbackClassName?: string;
}

export const ClipsAvatar = forwardRef<HTMLSpanElement, ClipsAvatarProps>(
  function ClipsAvatar(
    { email, alt, fallback, fallbackClassName, ...avatarProps },
    forwardedRef,
  ) {
    const { avatarRef, avatarUrl } = useVisibleAvatarUrl(email);
    const setAvatarRef = useCallback(
      (element: HTMLSpanElement | null) => {
        avatarRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      },
      [avatarRef, forwardedRef],
    );

    return (
      <Avatar {...avatarProps} ref={setAvatarRef}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={alt} /> : null}
        <AvatarFallback className={fallbackClassName}>
          {fallback}
        </AvatarFallback>
      </Avatar>
    );
  },
);
ClipsAvatar.displayName = "ClipsAvatar";
