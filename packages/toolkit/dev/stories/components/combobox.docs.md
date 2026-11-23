Use Combobox to choose from a collection. The search text filters the list. The selected item is the value your app receives. Use [Autocomplete](?path=/docs/components-autocomplete--docs) when people can enter their own value.

```tsx
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@agent-native/toolkit/ui/base-ui/combobox";

<Combobox aria-label="City" items={["London", "Tokyo", "Toronto"]}>
  <ComboboxInput />
  <ComboboxPopup>
    <ComboboxList>
      {(city) => (
        <ComboboxItem key={city} value={city}>
          {city}
        </ComboboxItem>
      )}
    </ComboboxList>
    <ComboboxEmpty>No matching cities.</ComboboxEmpty>
  </ComboboxPopup>
</Combobox>;
```

## Choosing a list

- **Inline.** Set `inline` and `open`, then render `ComboboxList` directly after the input. Use this layout when people need to read or operate nearby fields while browsing results. [Inline picker](?path=/story/components-combobox--inline)
- **Search in a popup.** Compose `ComboboxTrigger` with a Button through `render`. Place the input inside the popup. For a footer action, place the button after the list so Tab reaches it from search. [Searchable popup](?path=/story/components-combobox--search-in-popup) · [Popup action](?path=/story/components-combobox--popup-action)
- **Nonmodal popup.** For a floating picker beside other form controls, place an inline Combobox inside a Popover. Focus the search input on open and close the popover when a value is chosen. [Nonmodal picker](?path=/story/components-combobox--nonmodal-picker)
- **Confirmation.** Place an inline picker in a Dialog. Apply commits the draft selection. Cancel and Escape discard it. [Confirmation dialog](?path=/story/components-combobox--confirm-selection)

## Selection and filtering

Use `createComboboxItems(data, { getValue, getLabel })` to select a stable ID while searching by label. It accepts flat or grouped records. Create static collections once, or memoize them when the data changes. [Grouped time zones](?path=/story/components-combobox--groups)

Set `name` on the root to include the selected value in `FormData`. For object items, use `itemToStringValue` to submit a stable identifier. [Time zone form](?path=/story/components-combobox--search-in-popup)

With `multiple`, the value is an array. Pass a component that renders `ComboboxChips` to the input’s `chips` prop. Backspace in an empty input removes the last value. Use the horizontal arrows to focus a chip, then press Delete or Backspace to remove it. Set `removeLabel` to localize the remove button’s name. [Multiple selections](?path=/story/components-combobox--multiple)

The remote-search example waits 150 ms after typing and cancels superseded requests. Keep the selection in `items` and supply matches through `filteredItems`. For a large local catalog, set `limit` to bound the rendered options while searching the whole collection. [Async filtering](?path=/story/components-combobox--async-filtering) · [10,000-item picker](?path=/story/components-combobox--large-catalog)

Set `variant`, `color`, and `highContrast` on the list for inline results or on the popup for floating results. Both use the input’s size.

## Keyboard and accessibility

Use `aria-labelledby` on the root to name the input and list from a visible label. Give an icon-only action a localized `aria-label`. When search lives inside the popup, use `ComboboxLabel` to give the value trigger a visible field name.

Escape closes the popup. Tab and Shift+Tab continue through the form. Inside a dialog, the first Escape closes the list and the second dismisses the dialog. [Picker in a dialog](?path=/story/components-combobox--in-dialog)

With an external input, Base UI 1.9.0 hides surrounding controls from assistive technology while the popup is open, even when those controls remain in the tab order. Escape closes the popup and restores their exposure. In single selection, Clear and Show options skip the tab order. The accessible Dismiss action restores the selected label. [Base UI issue #6071](https://github.com/mui/base-ui/issues/6071)

When the input is inside the popup, Chromium can briefly report hidden focus guards as tabbable during opening. Wait for keyboard focus to settle in the search field when testing navigation.

For custom exit animations, call `details.preventUnmountOnClose()` in `onOpenChange`, then `actionsRef.current.unmount()` when the animation finishes. [Base UI behavior and API](https://base-ui.com/react/components/combobox)
