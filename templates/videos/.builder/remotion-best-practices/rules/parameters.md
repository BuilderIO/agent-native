---
name: parameters
description: Make a video parametrizable by adding a Zod schema
metadata:
  tags: parameters, zod, schema
---

To make a video parametrizable, a Zod schema can be added to a composition.

First, `zod` must be installed - it must be exactly version `3.22.3`.

Then, a Zod schema can be defined alongside the component:

```tsx
import { z } from "zod";

export const MyCompositionSchema = z.object({
  title: z.string(),
});

const MyComponent: React.FC<z.infer<typeof MyCompositionSchema>> = ({
  title,
}) => {
  return (
    <div>
      <h1>{title}</h1>
    </div>
  );
};
```

In the root file, the schema can be passed to the composition:

```tsx
import { Composition } from "remotion";
import { MyComponent, MyCompositionSchema } from "./MyComposition";

export const RemotionRoot = () => {
  return (
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
  );
};
```

## Color picker

For adding a color picker, use `zColor()` from `@remotion/zod-types`.

```tsx
import { zColor } from "@remotion/zod-types";

export const MyCompositionSchema = z.object({
  color: zColor(),
});
```
