# Video Studio

A powerful Remotion-based video composition studio with AI-powered generation, interactive cursor animations, and advanced timeline controls.

## 🚀 Quick Start

```bash
pnpm install
pnpm run dev
```

Open http://localhost:8080 to access the studio.

## 📚 Documentation

- **[Quick Start Guide](QUICK_START.md)** - Get started creating your first composition in minutes
- **[Composition Guide](COMPOSITION_GUIDE.md)** - Complete reference for all features and APIs
- **[Example Script](scripts/create-composition.ts)** - Template for programmatic composition creation

## ✨ Features

### 🎬 AI-Powered Generation
- Describe videos in natural language
- Attach reference images, logos, and assets
- Generates React components and animation tracks automatically

### 🎥 Camera System
- 6 animatable properties: translate X/Y, scale, rotate X/Y, perspective
- Multi-keyframe selection with box-select and shift-click
- Visual camera controls with real-time preview

### 🖱️ Interactive Cursor
- Position tracking with smooth animations
- Hover and click detection
- Component-type based interactions
- Visual cursor with multiple states

### 🎭 Cursor Interactions
- Add hover animations to any component type
- Click effects with timing control
- Scale, translate, and rotate on interaction
- Duration and easing customization

### ⚡ Advanced Timeline
- Multi-keyframe selection and editing
- Visual easing selector (20+ curves)
- View range control for focused editing
- Track properties panel with live preview
- Expression-controlled animations (programmatic)

### 🎨 Built-in Components
- Kinetic Text (typing reveal, drift, explode)
- Logo Reveal (particle burst)
- Logo Explode (SVG scatter)
- Interactive Demo (hover buttons)
- Interactive Card Grid (cursor-reactive cards)
- Slideshow (multi-slide transitions)

## 🛠️ Helper Functions

```typescript
import {
  createBlankComposition,
  addComposition,
} from "@/remotion/registry";

import {
  createCameraTrack,
  createCursorTrack,
  createAnimationTrack,
  createFadeInTrack,
  createSlideInTrack,
  createCursorPath,
  createClickEvents,
  validateComposition,
} from "@/utils/compositionHelpers";

// Create a new composition
const comp = createBlankComposition("My Video");
addComposition(comp);

// Or build manually with full control
const tracks = [
  createCameraTrack(240),
  createCursorTrack(240),
  createFadeInTrack("title", "Title Entrance", 0, 30),
];

validateComposition(tracks); // Ensure it has required tracks
```

## 📖 Key Concepts

### Compositions
- **ID**: URL-friendly slug (auto-generated from title)
- **Tracks**: Animation timelines (camera, cursor, custom)
- **Props**: Component configuration (colors, text, etc.)
- **Dimensions**: Default 1920×1080 @ 30fps

### Tracks
- **Camera**: Controls viewport (required)
- **Cursor**: Tracks pointer position (required for interactions)
- **Custom**: Element-specific animations (optional)

### Keyframes
- **Simple**: from/to values with easing
- **Complex**: Multiple keyframes with individual easing
- **Programmatic**: Code-driven animations with parameters

### Cursor Interactions
- **Hover**: Trigger when cursor enters component bounds
- **Click**: Trigger on cursor click events
- **Component-Type Based**: Apply to all instances globally

## 🎯 Common Workflows

### Create with AI
1. Click "+ New Composition"
2. Describe your video
3. Attach references (optional)
4. Press Enter
5. Edit and customize

### Create Manually
1. Copy `BlankComposition.tsx` as template
2. Modify component code
3. Register in `registry.ts`
4. Export in `compositions/index.ts`
5. Navigate to `/c/your-comp-id`

### Add Cursor Interactions
1. Ensure cursor track exists
2. Add `<Cursor>` to component
3. Use `useHoverAnimation()` hook
4. Configure in Properties → Cursor Interactions

### Multi-Keyframe Editing
1. Box-select: Click+drag in timeline
2. Shift-click: Add individual keyframes
3. Drag selection: Move all together
4. Maintains relative timing

## 📁 Project Structure

```
client/
├── remotion/
│   ├── compositions/        # Video components
│   ├── ui-components/       # Reusable elements (Cursor, etc.)
│   ├── hooks/              # Animation hooks
│   ├── CameraHost.tsx      # Camera wrapper
│   ├── registry.ts         # Composition registry
│   └── trackAnimation.ts   # Track utilities
├── components/             # Studio UI components
├── pages/                  # Routes (Index, CompositionView)
├── utils/                  # Helpers and utilities
└── contexts/              # React context providers

server/
├── routes/                # API endpoints
└── index.ts              # Express server

scripts/
└── create-composition.ts  # Example creation script
```

## 🔧 Development

### Commands

```bash
# Development
pnpm run dev           # Start dev server (http://localhost:8080)

# Build
pnpm run build         # Build client and server
pnpm run build:client  # Build client only
pnpm run build:server  # Build server only

# Production
pnpm start             # Run production server

# Testing
pnpm test              # Run tests
pnpm typecheck         # Type checking
pnpm format.fix        # Format code
```

### Environment

All compositions run at:
- **30fps** (standardized)
- **1920×1080** (Wide format default)
- **240 frames** (8 seconds default duration)

## 🎓 Learn More

- **Remotion Docs**: https://remotion.dev/docs
- **Builder.io Docs**: https://www.builder.io/c/docs/projects
- **Example Compositions**: Check `client/remotion/compositions/` folder

## 📝 License

Private project.

---

**Ready to create?** Click "+ New Composition" and describe your first video! 🎬
