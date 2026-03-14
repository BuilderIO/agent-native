---
name: videos
description: Embedding videos in Remotion - trimming, volume, speed, looping, pitch
metadata:
  tags: video, media, trim, volume, speed, loop, pitch
---

# Using videos in Remotion

## Prerequisites

The @remotion/media package needs to be installed:

```bash
pnpm exec remotion add @remotion/media
```

## Basic Usage

```tsx
import { Video } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Video src={staticFile("video.mp4")} />;
};
```

## Trimming

```tsx
const { fps } = useVideoConfig();
<Video
  src={staticFile("video.mp4")}
  trimBefore={2 * fps}
  trimAfter={10 * fps}
/>;
```

## Delaying

```tsx
<Sequence from={1 * fps}>
  <Video src={staticFile("video.mp4")} />
</Sequence>
```

## Volume, Speed, Looping, Pitch

- `volume={0.5}` or `volume={(f) => interpolate(f, [0, fps], [0, 1])}`
- `playbackRate={2}` for 2x speed
- `loop` for looping
- `toneFrequency={1.5}` for higher pitch (server-side only)
- `muted` to silence
