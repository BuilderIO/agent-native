Introduce a feature with a card. The card opens a dialog with details. **Explore styles** takes people directly to the feature from either surface.

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogMedia,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/toolkit/ui/base-ui/dialog";
import {
  ImageCard,
  ImageCardActions,
  ImageCardBody,
  ImageCardTarget,
} from "@agent-native/toolkit/ui/base-ui/image-card";
import { Button, ButtonLink } from "@agent-native/toolkit/ui/base-ui/button";
import { Link } from "@agent-native/toolkit/ui/base-ui/link";

function StyleAnnouncement({
  featureUrl,
  coverUrl,
}: {
  featureUrl: string;
  coverUrl: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ImageCard>
        <ImageCardBody>
          <ImageCardTarget render={<DialogTrigger />}>
            Meet the style library
          </ImageCardTarget>
          <ImageCardActions>
            <Link href={featureUrl}>Explore styles</Link>
          </ImageCardActions>
        </ImageCardBody>
      </ImageCard>
      <DialogPopup closeLabel="Close announcement">
        <DialogMedia>
          <img src={coverUrl} alt="" width={800} height={400} />
        </DialogMedia>
        <DialogBody>
          <DialogTitle>Meet the style library</DialogTitle>
          <DialogDescription>
            Choose a visual style for your next asset.
          </DialogDescription>
          <DialogFooter>
            <DialogClose render={<Button variant="surface" />}>
              Maybe later
            </DialogClose>
            <ButtonLink href={featureUrl} onClick={() => setOpen(false)}>
              Explore styles
            </ButtonLink>
          </DialogFooter>
        </DialogBody>
      </DialogPopup>
    </Dialog>
  );
}
```

## Styles

With tokens and your app theme loaded, import `@agent-native/design-system/components/announcement.css` for the card, dialog, typography, and actions. For a standalone illustrated card, use `components/image-card.css` and import the styles for your chosen actions.

## Actions

Compose `ImageCardTarget` with `DialogTrigger`. Put the link in the sibling `ImageCardActions` so each action has its own tab stop. Escape closes the dialog and returns focus to the card trigger. Both links open the feature in a new tab in Storybook. Following the dialog link dismisses the announcement and pauses its video.

## Media

Place `DialogMedia` above the body for an image or video. Give video a poster, native controls, and `preload="none"`. The example mounts the player when the dialog opens. After playback starts, closing pauses the video and preserves its position.

[Video example](?path=/story/patterns-announcement--video-dialog) · [Image Card](?path=/docs/components-image-card--docs) · [Base UI Dialog](https://base-ui.com/react/components/dialog)
