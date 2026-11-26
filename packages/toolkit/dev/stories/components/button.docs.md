A Button runs an action, such as saving a document or adding a row. Its text names what will happen. Inside a form, an explicit `type="submit"` routes activation through the form’s submit handler.

During `loading`, the button keeps its name and intrinsic width, displays a spinner and prevents another activation. An icon beside a visible label can be decorative.

```tsx
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

<Button type="submit" loading={saving}>
  Save changes
</Button>;
```

[Base UI behavior and API](https://base-ui.com/react/components/button)
