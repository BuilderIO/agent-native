import { type AvatarOwnProps, avatarProps } from "@agent-native/design-system";
import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface AvatarProps
  extends Omit<BaseAvatar.Root.Props, "color">, AvatarOwnProps {}

/**
 * A person's or workspace's picture, on Base UI's Avatar with Radix Themes'
 * props. Unlike Radix Themes' single element, the image and its fallback are
 * Base UI's parts, placed as children.
 *
 * @import import { Avatar, AvatarImage, AvatarFallback } from "@agent-native/toolkit/ui/base-ui/avatar";
 */
const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>((props, ref) => {
  const [attributes, { className, ...rest }] = splitProps(avatarProps, props);
  return (
    <BaseAvatar.Root
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("avatar", className)}
    />
  );
});
Avatar.displayName = "Avatar";

export type AvatarImageProps = BaseAvatar.Image.Props;

/**
 * The picture, shown once it loads.
 *
 * @import import { AvatarImage } from "@agent-native/toolkit/ui/base-ui/avatar";
 */
const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, ...props }, ref) => (
    <BaseAvatar.Image
      ref={ref}
      className={partClassName("avatar-image", className)}
      {...props}
    />
  ),
);
AvatarImage.displayName = "AvatarImage";

export type AvatarFallbackProps = BaseAvatar.Fallback.Props;

/**
 * The initials or icon shown until the image loads, or when it fails.
 *
 * @import import { AvatarFallback } from "@agent-native/toolkit/ui/base-ui/avatar";
 */
const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <BaseAvatar.Fallback
      ref={ref}
      className={partClassName("avatar-fallback", className)}
      {...props}
    />
  ),
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
