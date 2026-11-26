RadioCards makes a single choice among options with enough detail to warrant a card, such as a plan or template. The card contents can explain the consequences of choosing it.

RadioCardsItem supplies one value and the accessible option text. The root owns the selected value and groups the options for keyboard navigation. A separate link can offer more details outside the radio target.

For a card with supporting text, point `aria-labelledby` at its title and `aria-describedby` at its detail.

Set `variant`, `color`, or `highContrast` on an individual option to override the group default.

```tsx
import {
  RadioCards,
  RadioCardsItem,
} from "@agent-native/toolkit/ui/base-ui/radio-cards";

<RadioCards aria-label="Plan" defaultValue="starter">
  <RadioCardsItem value="starter">Starter · 1 workspace</RadioCardsItem>
  <RadioCardsItem value="team">Team · shared workspaces</RadioCardsItem>
</RadioCards>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/radio-cards)
