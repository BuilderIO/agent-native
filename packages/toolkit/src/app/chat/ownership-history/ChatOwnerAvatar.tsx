import { useAvatarUrl } from "@agent-native/core/client/use-avatar";
import { emailToColor } from "@agent-native/toolkit/collab-ui";

/** The 16px owner mark on a shared chat row: profile photo, else a colored initial. */
export function ChatOwnerAvatar({
  email,
  label,
}: {
  email: string;
  label: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  return (
    <span
      role="img"
      aria-label={label}
      className="an-chat-owner-avatar"
      style={avatarUrl ? undefined : { backgroundColor: emailToColor(email) }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="an-chat-owner-avatar__image" />
      ) : (
        (email.trim().charAt(0) || "?").toUpperCase()
      )}
    </span>
  );
}
