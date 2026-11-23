Slider adjusts a value on a bounded scale. It suits opacity, volume and other values that benefit from immediate visual or audible feedback. A pair of thumbs can describe a range.

`thumbLabel` names the focusable control and can be a function of the thumb index for a range. Arrow keys adjust the focused thumb by its step. SliderControl, SliderTrack and SliderThumb allow custom tracks while retaining keyboard interaction.

```tsx
import { Slider } from "@agent-native/toolkit/ui/base-ui/slider";

<Slider min={0} max={100} step={5} defaultValue={75} thumbLabel="Opacity" />;
```

[Base UI behavior and API](https://base-ui.com/react/components/slider)
