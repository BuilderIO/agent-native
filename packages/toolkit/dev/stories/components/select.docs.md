Select lets someone choose a value from a defined list while keeping the closed control compact. A short list of publication states works well in an inspector or form.

SelectTrigger opens the popup and SelectValue shows the selected label. Set `aria-label` or `aria-labelledby` on Select to name both the trigger and its listbox. Each SelectItem needs a stable value. Arrow keys move through the options and Escape closes the popup. A `SelectItem` class callback receives `highlighted` as the user navigates, and `selected` for the committed value. [Try keyboard selection](?path=/story/components-select--playground)

```tsx
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@agent-native/toolkit/ui/base-ui/select";

<Select defaultValue="draft" aria-label="Publication state">
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectPopup>
    <SelectItem value="draft">Draft</SelectItem>
    <SelectItem value="published">Published</SelectItem>
  </SelectPopup>
</Select>;
```

In a form, put the submission name on `Field`. Give `FieldLabel` an ID and pass it to `Select` through `aria-labelledby`. The trigger and list use the visible label, and `FormData` receives the selected option’s value. To support a reset button, control the selection and restore its initial value in the form’s `onReset`. [Labeled field](?path=/story/components-select--labeled-field)

Set `multiple` to keep the list open while people toggle options. With a named field, `FormData.getAll(name)` returns one entry per selected value and an empty array when cleared. [Export formats](?path=/story/components-select--multiple)

[Base UI behavior and API](https://base-ui.com/react/components/select)
