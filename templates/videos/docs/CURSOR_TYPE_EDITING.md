# Cursor Type Editing - Feature Overview

## 🎯 Feature

The Cursor Interactions panel now displays and allows editing of cursor types for interactive elements.

---

## UI Location

**Sidebar → Cursor Interactions Panel**

When you hover over an interactive element, the panel shows:

1. Element name/label
2. **Cursor Type selector** (NEW!)
3. Hover/Click animations

---

## How It Works

### Display

**Default State (Inferred)**

```
┌─────────────────────────────────┐
│ Submit Button                   │  ← Element label
├─────────────────────────────────┤
│ 🖱️  Cursor Type                 │  ← Section header
│ [Pointer (👆)     ▼]            │  ← Dropdown selector
│ Using inferred cursor type      │  ← Status message
├─────────────────────────────────┤
│ 🖱️  Hover Animation              │
│ ...                             │
└─────────────────────────────────┘
```

**Custom State (User Modified)**

```
┌─────────────────────────────────┐
│ Email Input                     │
├─────────────────────────────────┤
│ 🖱️  Cursor Type                 │
│ [Pointer (👆)     ▼]   [🗑️]     │  ← Trash to reset
│ Custom cursor type...           │  ← Custom indicator
├─────────────────────────────────┤
│ 🖱️  Hover Animation              │
│ ...                             │
└─────────────────────────────────┘
```

### Options

- **Pointer (👆)** - For buttons, cards, links (clickable elements)
- **Text (I)** - For text inputs, textareas, editable fields
- **Default (➜)** - For custom or non-interactive elements

### States

**Inferred** (default)

- Automatically determined from `interactiveElementType`
- Shows: "Using inferred cursor type"
- No trash icon

**Custom** (user-modified)

- Set by selecting a different type
- Shows: "Custom cursor type (click trash to reset)"
- Trash icon visible - click to reset to inferred

---

## Storage

Cursor types are stored per-composition per-element-type:

```
localStorage["videos-element-cursor-types"] = {
  "my-form:SubmitButton": "pointer",
  "my-form:EmailInput": "text",
  ...
}
```

---

## Priority Order

When determining which cursor type to use:

```
1. User's custom setting (from localStorage)
   ↓
2. Explicit cursorType option (in useInteractiveComponent)
   ↓
3. Inferred from interactiveElementType
   ↓
4. Default: "pointer"
```

---

## Example Workflow

### 1. Create element with auto cursor

```tsx
const emailInput = useInteractiveComponent({
  id: "email",
  elementType: "EmailInput",
  label: "Email Input",
  compositionId: "my-form",
  zone: { x: 400, y: 500, width: 300, height: 40 },
  cursorHistory,
  interactiveElementType: "input", // → cursor: "text"
  hoverAnimation: AnimationPresets.glowHover(20),
});
```

### 2. User hovers element

- Panel shows: **"Text (I)"** selected
- Status: "Using inferred cursor type"

### 3. User changes to "Pointer"

- Dropdown changes to: **"Pointer (👆)"**
- Status: "Custom cursor type (click trash to reset)"
- Trash icon appears
- Saved to localStorage

### 4. User resets

- Clicks trash icon
- Reverts to: **"Text (I)"**
- Status: "Using inferred cursor type"
- Custom setting removed from localStorage

---

## Implementation

### Context Methods

```tsx
const {
  getCursorType, // (compositionId, elementType) => "pointer" | "text" | "default"
  setCursorType, // (compositionId, elementType, cursorType) => void
  deleteCursorType, // (compositionId, elementType) => void
} = useCurrentElement();
```

### Component Integration

`useInteractiveComponent` automatically:

1. Checks for stored cursor type (priority 1)
2. Falls back to explicit `cursorType` option (priority 2)
3. Infers from `interactiveElementType` (priority 3)
4. Defaults to `"pointer"` (priority 4)
5. Passes resolved cursor type to `useRegisterInteractiveElement`

---

## Benefits

✅ **Visibility** - Users can see what cursor each element uses  
✅ **Flexibility** - Easy to override inferred cursor types  
✅ **Persistence** - Settings saved across sessions  
✅ **Reset** - Quick restore to default behavior  
✅ **Consistency** - Same UI pattern as animation editing

---

## See Also

- [Cursor Integration Quick Reference](./CURSOR_INTEGRATION_QUICK_REF.md)
- [Interactive Component Helper Guide](./INTERACTIVE_COMPONENT_HELPER.md)
- [CurrentElementPanel.tsx](../app/components/CurrentElementPanel.tsx)
