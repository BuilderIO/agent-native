---
name: parameters
description: Make a video parametrizable by adding a Zod schema
metadata:
  tags: parameters, zod, schema
---

To make a video parametrizable, a Zod schema can be added to a composition.

First, `zod` must be installed - it must be exactly version `3.22.3`.

```bash
pnpm i zod@3.22.3
```

Then define a Zod schema alongside the component:

```tsx
import { z } from "zod";

export const MyCompositionSchema = z.object({
  title: z.string(),
});

const MyComponent: React.FC<z.infer<typeof MyCompositionSchema>> = (props) => {
  return <h1>{props.title}</h1>;
};
```

In the root file, pass the schema to the composition:

```tsx
<Composition
  id="MyComposition"
  component={MyComponent}
  durationInFrames={100}
  fps={30}
  width={1080}
  height={1080}
  defaultProps={{ title: "Hello World" }}
  schema={MyCompositionSchema}
/>
```

## Color picker

For a color picker, use `zColor()` from `@remotion/zod-types`:

```bash
pnpm exec remotion add @remotion/zod-types
```

```tsx
import { zColor } from "@remotion/zod-types";

export const MyCompositionSchema = z.object({
  color: zColor(),
});
```
