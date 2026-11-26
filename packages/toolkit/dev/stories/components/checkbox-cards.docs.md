CheckboxCards presents independent options as large checkable targets. This works for choosing several integrations when each option needs an icon, a name or a short detail.

Each CheckboxCardsItem supplies one stable value and its descriptive content. The root receives the array of selected values. Keep links and secondary buttons outside the selectable card so the whole target has one action.

For a card with supporting text, point `aria-labelledby` at its title and `aria-describedby` at its detail.

Set `variant`, `color`, or `highContrast` on an individual option to override the group default. Use the item’s `indicator` prop to replace the trailing checkbox.

```tsx
import {
  CheckboxCards,
  CheckboxCardsItem,
} from "@agent-native/toolkit/ui/base-ui/checkbox-cards";

<CheckboxCards aria-label="Integrations" defaultValue={["calendar"]}>
  <CheckboxCardsItem value="calendar">Calendar</CheckboxCardsItem>
  <CheckboxCardsItem value="mail">Mail</CheckboxCardsItem>
</CheckboxCards>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/checkbox-cards)
