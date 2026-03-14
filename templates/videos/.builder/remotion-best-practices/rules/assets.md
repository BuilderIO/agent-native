---
name: assets
description: Importing images, videos, audio, and fonts into Remotion
metadata:
  tags: assets, staticFile, images, fonts, public
---

# Importing assets in Remotion

## The public folder

Place assets in the `public/` folder at your project root.

## Using staticFile()

You MUST use `staticFile()` to reference files from the `public/` folder:

```tsx
import {Img, staticFile} from 'remotion';

export const MyComposition = () => {
  return <Img src={staticFile('logo.png')} />;
};
```

## Using with components

**Images:**
```tsx
import {Img, staticFile} from 'remotion';
<Img src={staticFile('photo.png')} />;
```

**Videos:**
```tsx
import {Video} from '@remotion/media';
import {staticFile} from 'remotion';
<Video src={staticFile('clip.mp4')} />;
```

**Audio:**
```tsx
import {Audio} from '@remotion/media';
import {staticFile} from 'remotion';
<Audio src={staticFile('music.mp3')} />;
```

## Remote URLs

Remote URLs can be used directly without `staticFile()`:

```tsx
<Img src="https://example.com/image.png" />
```

## Important notes

- Remotion components (`<Img>`, `<Video>`, `<Audio>`) ensure assets are fully loaded before rendering
- Special characters in filenames (`#`, `?`, `&`) are automatically encoded
