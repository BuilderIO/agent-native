/**
 * JiraAvatar - User avatar component
 */

import React from "react";

interface JiraAvatarProps {
  src: string;
  size?: number;
  alt?: string;
}

export const JiraAvatar: React.FC<JiraAvatarProps> = ({
  src,
  size = 48,
  alt = "User avatar",
}) => {
  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        objectFit: "contain",
      }}
    />
  );
};
