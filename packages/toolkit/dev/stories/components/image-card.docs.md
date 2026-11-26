Use an Image Card when artwork helps someone recognize a feature, collection, or destination.

```tsx
import {
  ImageCard,
  ImageCardBody,
  ImageCardMedia,
  ImageCardTarget,
} from "@agent-native/toolkit/ui/base-ui/image-card";

<ImageCard>
  <ImageCardMedia>
    <img src="/paper.webp" alt="" width={800} height={400} />
  </ImageCardMedia>
  <ImageCardBody>
    <ImageCardTarget render={<a href="/library/paper" />}>
      Paper studies
    </ImageCardTarget>
  </ImageCardBody>
</ImageCard>;
```

### Media

Images fill a 2:1 frame. Use `picture` for responsive sources or pass an image or video through `ImageCardMedia`’s `render` prop. Videos keep their full frame and native controls. Use empty alt text for decorative images and describe artwork that adds information.

For a different frame, render the media slot as `<AspectRatio ratio={3 / 4} />`. [Portrait cover](?path=/story/components-image-card--portrait-cover)

### Actions

Use `ImageCardTarget` for the primary link or button. Place secondary controls in a sibling `ImageCardActions` so each has its own keyboard stop. Button targets default to `type="button"`. Set `type="submit"` to submit a form.

[Radix Themes · Card](https://www.radix-ui.com/themes/docs/components/card)
