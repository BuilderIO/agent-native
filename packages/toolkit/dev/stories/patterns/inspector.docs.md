Use `Inspector` to assemble a property panel for a specific kind of selection. The Frame and Text Layer examples use the same panel parts with different fields. Give the root an accessible name, then put selection identity and global actions in `InspectorHeader`.

Group related controls in an `InspectorSection`. Put the group heading and any group action in `InspectorSectionHeader`, then arrange editable values with `InspectorContent`, `InspectorGrid` and `InspectorField`. Choose controls according to the value being edited. A toggle turns auto layout on or off, while a two-dimensional alignment control chooses its anchor.

Keep values and edits in the consumer so the panel can share selection and history with other views. Give abbreviated dimension and typography fields complete accessible names. Try the keyboard examples to edit numeric values and move between independent sections.

```tsx
import {
  Inspector,
  InspectorSection,
  InspectorSectionHeader,
  InspectorContent,
} from "@agent-native/toolkit/ui/base-ui/inspector";

<Inspector aria-label="Text properties">
  <InspectorSection>
    <InspectorSectionHeader>
      <h2>Typography</h2>
    </InspectorSectionHeader>
    <InspectorContent>{typeFields}</InspectorContent>
  </InspectorSection>
</Inspector>;
```

See [Property List](?path=/docs/patterns-property-list--docs) for pairing each property label with its control.

### Property tokens

Use `useTokenBinding(property, tokens, onChange)` with the catalog for the property being edited. Render `PropertyTokenField` with that binding and supply the literal editor as its child. Keep catalog arrays immutable so fields can share the lookup index. Store the returned property object in the document through its normal edit action. Render from `binding.resolved`, or call `resolvePropertyToken` outside React.

A bound field shows the token name in a compact badge. The picker shows its resolved value and unit alongside the name. Choose another token to replace it, or use Detach or Backspace to keep the current value as a literal. A renamed token keeps its bindings by ID. A missing token shows its ID and uses the saved fallback until replaced or detached. [Corner radius example](?path=/story/patterns-inspector--radius-token)

Document actions can import `bindPropertyToken`, `resolvePropertyToken`, and `detachPropertyToken` from `@agent-native/toolkit/ui/base-ui/property-token-model`. These functions work on plain data without mounting React. For values that depend on CSS, resolve them in the themed surface before persisting a detached literal.

Keep binding actions inside each property frame. Use `prefix` for an axis or property glyph when adjacent fields can both be bound. The badge sits inside the trigger that opens that field’s menu. Detach appears first in that menu and is also available through Backspace on the focused field. [Adjacent fields](?path=/story/components-property-token--adjacent-fields)
