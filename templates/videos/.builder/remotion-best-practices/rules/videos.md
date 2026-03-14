---
name: videos
description: Embedding videos in Remotion - trimming, volume, speed, looping, pitch
metadata:
  tags: video, media, trim, volume, speed, loop, pitch
---

# Using videos in Remotion

## Prerequisites

First, the @remotion/media package needs to be installed.

Use `<Video>` from `@remotion/media` to embed videos into your composition.

```tsx
import { Video } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Video src={staticFile("video.mp4")} />;
};
```

## Trimming

Use `trimBefore` and `trimAfter` to remove portions of the video. Values are in seconds.

## Sizing and Position

Use the `style` prop to control size and position.

## Volume

Set a static volume (0 to 1):

```tsx
<Video src={staticFile("video.mp4")} volume={0.5} />
```

## Speed

Use `playbackRate` to change the playback speed.

## Looping

Use `loop` to loop the video indefinitely.

## Pitch

Use `toneFrequency` to adjust the pitch without affecting speed.
Pitch shifting only works during server-side rendering, not in the Remotion Studio preview or in the `<Player />`.
