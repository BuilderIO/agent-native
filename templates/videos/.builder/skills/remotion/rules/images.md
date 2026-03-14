---
name: images
description: Embedding images in Remotion using the Img component
metadata:
  tags: images, img, staticFile, png, jpg, svg, webp
---

# Using images in Remotion

Always use the `<Img>` component from `remotion`. Do NOT use native `<img>`, Next.js `<Image>`, or CSS `background-image`.

```tsx
import { Img, staticFile } from "remotion";

export const MyComposition = () => {
  return <Img src={staticFile("photo.png")} />;
};
```

## Remote images

```tsx
<Img src="https://example.com/image.png" />
```

## Sizing

```tsx
<Img
  src={staticFile("photo.png")}
  style={{ width: 500, height: 300, objectFit: "cover" }}
/>
```

## Getting image dimensions

```tsx
import { getImageDimensions, staticFile } from "remotion";

const { width, height } = await getImageDimensions(staticFile("photo.png"));
```
