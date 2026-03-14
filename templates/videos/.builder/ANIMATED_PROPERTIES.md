# Animated Properties System

## Overview

The Video Studio interactive component system supports **ANY CSS property** for hover and click animations. This means you can animate absolutely anything - colors, sizes, transforms, filters, borders, and more!

## Quick Start

### 1. Make Your Component Interactive

```tsx
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";

const MyComp = ({ cursorHistory }) => {
  const button = useInteractiveComponent({
    id: "my-button",
    elementType: "Button",
    label: "My Button",
    compositionId: "my-comp",
    zone: { x: 100, y: 100, width: 200, height: 60 },
    cursorHistory,
    interactiveElementType: "button",
  });
  
  registerForCursor(button);
  
  return (
    <AnimatedElement interactive={button} as="button">
      Click me!
    </AnimatedElement>
  );
};
```

### 2. Add Animations via UI

1. Hover over the element in the video player
2. Open the "Cursor Interactions" panel (automatically appears)
3. Click "+ Add Hover Animation" or "+ Add Click Animation"
4. Add properties: **backgroundColor**, **scale**, **borderRadius**, etc.
5. See your changes in real-time!

## Supported Properties

### ✅ ALL CSS Properties Work!

The `AnimatedElement` component automatically converts animated properties to appropriate CSS styles. Here are some examples:

#### Transform Properties
- `scale` → `transform: scale()`
- `translateX`, `translateY`, `translateZ` → `transform: translate()`
- `rotate`, `rotateX`, `rotateY`, `rotateZ` → `transform: rotate()`
- `skewX`, `skewY` → `transform: skew()`

#### Filter Properties
- `blur` → `filter: blur()`
- `brightness` → `filter: brightness()`
- `contrast` → `filter: contrast()`
- `saturate` → `filter: saturate()`
- `hueRotate` → `filter: hue-rotate()`

#### Color Properties
- `backgroundColor` or `background`
- `color` or `textColor`
- `borderColor`

#### Size Properties
- `width`, `height`
- `padding`, `margin`
- `borderWidth`
- `borderRadius`

#### Shadow & Effects
- `boxShadow` or `shadow`
- `opacity`

#### Custom Properties
- **ANY** kebab-case CSS property name (e.g., `font-size`, `line-height`)
- **ANY** camelCase CSS property name (e.g., `fontSize`, `lineHeight`)

## How AnimatedElement Works

The `AnimatedElement` component:

1. **Reads** all animated properties from the interactive component state
2. **Converts** them to inline CSS styles automatically
3. **Handles** transforms, filters, and all CSS properties intelligently
4. **Merges** with any additional styles you provide
5. **Applies** everything to the rendered element

### Under the Hood

```tsx
// User adds "backgroundColor" animation from #000000 to #FFFFFF via UI

// AnimatedElement automatically:
// 1. Detects backgroundColor property
// 2. Interpolates value based on hover progress (0 → 1)
// 3. Applies as inline style: backgroundColor: "#888888" (at 50% hover)
```

## Advanced Usage

### Custom Components

```tsx
// Works with ANY component that accepts style prop
<AnimatedElement 
  interactive={myButton} 
  as={CustomButton}
  customProp="value"
>
  Content
</AnimatedElement>
```

### Merge with Static Styles

```tsx
// User-provided styles override animated styles
<AnimatedElement
  interactive={myButton}
  as="div"
  style={{
    backgroundColor: "red",  // This overrides animated backgroundColor
    position: "absolute",     // Static styles work fine
  }}
>
  Content
</AnimatedElement>
```

### Manual Property Extraction

If you need custom logic, extract properties manually:

```tsx
const button = useInteractiveComponent({ ... });

const scale = (button.animatedProperties?.scale as number) ?? 1;
const bgColor = button.animatedProperties?.backgroundColor ?? "transparent";
const customProp = button.animatedProperties?.myCustomProperty;

<div style={{
  transform: `scale(${scale})`,
  backgroundColor: bgColor,
  // Custom logic here
}}>
  Content
</div>
```

## Examples

### Background Color Hover

Via UI:
1. Select element
2. Add hover animation
3. Add property: `backgroundColor`
4. From: `rgba(0,0,0,0.1)`, To: `rgba(0,0,0,0.3)`

### Multi-Property Animation

Via UI:
1. Select element
2. Add hover animation
3. Add properties:
   - `scale`: From `1`, To `1.05`
   - `backgroundColor`: From `#f0f0f0`, To `#ffffff`
   - `borderRadius`: From `8px`, To `16px`
   - `boxShadow`: From `0 2px 4px rgba(0,0,0,0.1)`, To `0 8px 16px rgba(0,0,0,0.2)`

All properties animate smoothly together!

### Click Feedback

Via UI:
1. Select element
2. Add click animation (duration: 6 frames)
3. Add properties:
   - `scale`: From `1`, To `0.95`
   - `brightness`: From `100%`, To `90%`

Element "presses down" on click!

## Property Types

### Number Properties
- Automatically adds `px` for size properties (width, padding, etc.)
- Automatically adds `deg` for rotation properties
- Automatically adds `%` for filter properties (brightness, contrast)

### String Properties
- Used as-is for colors, shadows, etc.
- Example: `#ff0000`, `rgba(0,0,0,0.5)`, `0 4px 8px rgba(0,0,0,0.2)`

### Units
When adding properties via UI, include units in the value:
- `10px` ✅
- `50%` ✅
- `1.5em` ✅
- `10` ⚠️ (interpreted as pixels for size properties)

## Best Practices

### 1. Use AnimatedElement by Default
```tsx
// ✅ RECOMMENDED - Works with ANY property
<AnimatedElement interactive={button} as="button">
  Click me
</AnimatedElement>

// ❌ MANUAL - Requires updating code for each property
<button style={{
  transform: `scale(${scale})`,
  // Forgot to add backgroundColor? Need to update code!
}}>
  Click me
</button>
```

### 2. Keep Animations Subtle
- Hover scale: 1.05 - 1.15 (not 2.0!)
- Lift: 4px - 12px (not 50px!)
- Color shifts: Slight variations (not black → white!)

### 3. Use Appropriate Durations
- Hover: 6-12 frames (fast, responsive)
- Click: 3-6 frames (immediate feedback)
- Complex: 12-24 frames (smooth, elegant)

### 4. Test on Actual Hardware
- What looks good at 60fps may feel sluggish at 30fps
- Test hover responsiveness with real mouse movement
- Check click feedback feels immediate

## Troubleshooting

### Properties Not Applying?

**Check:**
1. ✅ Using `AnimatedElement` component?
2. ✅ Passing `interactive` prop correctly?
3. ✅ Registered component with `registerForCursor()`?
4. ✅ Property name matches exactly (case-sensitive)?

### Common Mistakes

**Wrong:** Using className instead of inline styles in Remotion
```tsx
<AnimatedElement interactive={button} className="hover:bg-red-500">
  Won't work - Remotion doesn't support className animations
</AnimatedElement>
```

**Right:** AnimatedElement handles everything
```tsx
<AnimatedElement interactive={button}>
  Works - animatedProperties applied as inline styles!
</AnimatedElement>
```

### Debugging

Log animated properties to see what's available:

```tsx
console.log(button.animatedProperties);
// Output: { scale: 1.05, backgroundColor: "#ffffff", ... }
```

## Architecture

### Data Flow

```
User hovers over element
  ↓
useInteractiveComponent detects hover
  ↓
Retrieves animations from CurrentElementContext
  ↓
Calculates property values at current hover progress
  ↓
Stores in animatedProperties object
  ↓
AnimatedElement reads animatedProperties
  ↓
Converts to inline styles
  ↓
Applies to rendered element
```

### Storage

Animations are stored in:
- `CurrentElementContext` - In-memory state
- `localStorage` - Persistent across reloads (per-composition)

### Interpolation

Property values are interpolated using:
- Easing functions (expo.out, power2.inOut, etc.)
- Progress value (0 → 1 for hover/click)
- Keyframes (from → to values)

## Summary

✅ **ANY CSS property can be animated**  
✅ **Use AnimatedElement for automatic application**  
✅ **Add properties via UI - no code changes needed**  
✅ **Works with transforms, filters, colors, sizes, and more**  
✅ **Fully customizable and extensible**

The animated properties system is designed to be **completely flexible**. If you can style it with CSS, you can animate it in Video Studio!
