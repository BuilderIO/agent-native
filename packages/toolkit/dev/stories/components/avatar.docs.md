An Avatar identifies a person or workspace in a compact space. Initials keep the identity visible while a profile image is unavailable.

Pair an avatar with a visible name when identities could be ambiguous. If adjacent text already names the person, treat the image as decorative. For a profile action, name the surrounding button or link.

```tsx
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@agent-native/toolkit/ui/base-ui/avatar";

<span>
  <Avatar aria-hidden="true">
    <AvatarImage src="/people/ada.webp" alt="" />
    <AvatarFallback>AL</AvatarFallback>
  </Avatar>
  Ada Lovelace
</span>;
```

[Base UI · Avatar](https://base-ui.com/react/components/avatar)
