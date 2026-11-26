Use Autocomplete to suggest completions while accepting whatever someone types. Use [Combobox](?path=/docs/components-combobox--docs) when the value must come from a collection.

```tsx
import {
  Autocomplete,
  AutocompleteInput,
  AutocompletePopup,
  AutocompleteList,
  AutocompleteItem,
} from "@agent-native/toolkit/ui/base-ui/autocomplete";

<Autocomplete
  aria-label="Search tags"
  items={["accessibility", "animation", "analytics"]}
>
  <AutocompleteInput />
  <AutocompletePopup>
    <AutocompleteList>
      {(tag) => (
        <AutocompleteItem key={tag} value={tag}>
          {tag}
        </AutocompleteItem>
      )}
    </AutocompleteList>
  </AutocompletePopup>
</Autocomplete>;
```

## Suggestions

The [remote-search example](?path=/story/components-autocomplete--async-filtering) waits 150 ms after typing and cancels superseded requests.

For grouped suggestions, pass groups with an `items` array. The `filter` callback receives each suggestion. The [grouped search example](?path=/story/components-autocomplete--groups) matches word prefixes in any order.

Use `AutocompleteEmpty` for an empty result set and `AutocompleteStatus` to announce an asynchronous search.

For suggestions that stay visible beside other fields, set `inline` and `open`. Render `AutocompleteList` directly after the input. To accept an inline suggestion, control `value` and set it from the item’s `onClick`, which also runs on keyboard activation. Only attach this handler when the field is editable. A read-only input stays focusable so its text can be copied. [Inline suggestions](?path=/story/components-autocomplete--inline)

Set `variant`, `color`, and `highContrast` on the list for inline results or on the popup for floating results. Both use the input’s size.

## Keyboard and accessibility

Use `aria-labelledby` on the root to name the input and list from a visible label. Give icon-only actions a localized `aria-label`.

Arrow keys highlight suggestions while focus stays in the input. Escape closes the popup. Tab and Shift+Tab dismiss it and move through the form unless the host keeps it open. The built-in Clear button skips the tab order. The accessible Dismiss action preserves typed text.

With an external input, Base UI 1.9.0 hides surrounding controls from assistive technology while the popup is open, even when those controls remain in the tab order. Escape closes the popup and restores their exposure. Use inline suggestions when people need access to the rest of the form during search. [Base UI issue #6071](https://github.com/mui/base-ui/issues/6071) · [Base UI behavior and API](https://base-ui.com/react/components/autocomplete)
