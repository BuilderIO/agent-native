#!/usr/bin/env ts-node

/**
 * Component Generator CLI
 *
 * Generates a new Remotion composition with animated elements and boilerplate
 *
 * Usage:
 *   npm run generate:component MyDashboard
 *   npm run generate:component MyDashboard --elements Button,Card,Panel
 */

import * as fs from "fs";
import * as path from "path";

interface GeneratorOptions {
  name: string;
  elements: string[];
  outputDir: string;
}

const TEMPLATE_COMPOSITION = (
  name: string,
  elements: string[],
) => `import { AbsoluteFill } from "remotion";
import { CameraHost } from "@/remotion/CameraHost";
import type { AnimationTrack } from "@/types";
import { findTrack } from "@/remotion/trackAnimation";
import { useCurrentElement } from "@/contexts/CurrentElementContext";
import { useEffect, useMemo, useState } from "react";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { initializeDefaultAnimations, AnimationPresets } from "@/remotion/utils/animationHelpers";
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { createInteractiveElements, findClickInElement } from "@/remotion/utils/interactiveElements";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";
${elements.map((el) => `import { ${name}${el} } from "./${name}${el}";`).join("\n")}
import { FALLBACK_TRACKS } from "./${name}Config";

// ⭐ CRITICAL: Initialize animations at module level (before component renders)
initializeDefaultAnimations("${name.toLowerCase()}", [
${elements
  .map(
    (el) => `  AnimationPresets.hoverLift("${el}"),
  AnimationPresets.clickPress("${el}"),`,
  )
  .join("\n")}
]);

export interface ${name}Props {
  tracks?: AnimationTrack[];
}

export const ${name}: React.FC<${name}Props> = ({ tracks = FALLBACK_TRACKS }) => {
  const { setCurrentElement, getAnimationsForElement } = useCurrentElement();

  // Get cursor track and history
  const cursorTrack = findTrack(tracks, "cursor", FALLBACK_TRACKS[1]);
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Extract click start frames for AnimatedElement
  const clickStartFrames = useMemo(() => {
    const prop = cursorTrack?.animatedProps?.find(p => p.property === "isClicking");
    return (prop?.keyframes ?? [])
      .filter(kf => parseFloat(kf.value) > 0.5)
      .map(kf => kf.frame);
  }, [cursorTrack]);

  // ⭐ CRITICAL: Register all interactive UI elements
  // TODO: Add all buttons, inputs, links, cards, etc. as interactive elements
  // This makes them discoverable and ready for cursor animations
  /*
  const INTERACTIVE_ELEMENTS = createInteractiveElements([
    { id: "button1", type: "button", label: "Primary CTA", zone: { x: 100, y: 400, width: 200, height: 60 } },
    { id: "input1", type: "input", label: "Email Input", zone: { x: 350, y: 400, width: 300, height: 60 } },
    { id: "link1", type: "link", label: "Learn More", zone: { x: 500, y: 500, width: 120, height: 30 } },
  ]);

  // Register hover zones for each interactive element
  const button1Hover = useHoverAnimationSmooth(
    cursorHistory,
    INTERACTIVE_ELEMENTS[0].zone,
    { cursorType: INTERACTIVE_ELEMENTS[0].cursorType }
  );

  const input1Hover = useHoverAnimationSmooth(
    cursorHistory,
    INTERACTIVE_ELEMENTS[1].zone,
    { cursorType: INTERACTIVE_ELEMENTS[1].cursorType }
  );

  // Aggregate cursor types (last wins for z-index priority)
  const autoCursorType = useCursorTypeFromHover([
    button1Hover,
    input1Hover,
  ]);

  // Detect clicks on interactive elements
  const button1ClickFrame = findClickInElement(
    cursorTrack,
    INTERACTIVE_ELEMENTS[0].zone,
    { startFrame: 50, endFrame: 150 }
  );
  const wasButton1Clicked = button1ClickFrame ? frame >= button1ClickFrame : false;
  */

  const autoCursorType = undefined; // TODO: Implement interactive elements registration above

  // Track which element is hovered (for Properties panel)
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);

  const handleHoverChange = (elementId: string, hovered: boolean) => {
    if (hovered) {
      setHoveredElement(elementId);
    } else if (hoveredElement === elementId) {
      setHoveredElement(null);
    }
  };

  // Update Properties panel when hover changes
  useEffect(() => {
    if (hoveredElement) {
      const elementMap: Record<string, { type: string; label: string }> = {
${elements.map((el) => `        "${el.toLowerCase()}": { type: "${el}", label: "${el}" },`).join("\n")}
      };
      const element = elementMap[hoveredElement];
      if (element) {
        setCurrentElement({
          id: hoveredElement,
          type: element.type,
          label: element.label,
          compositionId: "${name.toLowerCase()}"
        });
      }
    } else {
      setCurrentElement(null);
    }
  }, [hoveredElement, setCurrentElement]);

  return (
    <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
      {/* ⭐ CRITICAL: CameraHost renders cursor from track automatically */}
      {/* autoCursorType from hover zones overrides track type for realistic cursor behavior */}
      <AbsoluteFill style={{ background: "#0D1519" }}>

        {/* Add your animated elements here */}
${elements
  .map(
    (el, i) => `
        <AnimatedElement
          id="${el.toLowerCase()}"
          elementType="${el}"
          label="${el}"
          compositionId="${name.toLowerCase()}"
          position={{ x: ${100 + i * 250}, y: 400 }}
          size={{ width: 200, height: 100 }}
          baseColor="#3b82f6"
          cursorHistory={cursorHistory}
          getAnimationsForElement={getAnimationsForElement}
          cursorTrack={cursorTrack}
          clickStartFrames={clickStartFrames}
          onHoverChange={handleHoverChange}
        >
          {(animatedStyles) => (
            <${name}${el} animatedStyles={animatedStyles} />
          )}
        </AnimatedElement>`,
  )
  .join("\n")}

      </AbsoluteFill>
    </CameraHost>
  );
};
`;

const TEMPLATE_ELEMENT = (compositionName: string, elementName: string) => `/**
 * ${compositionName} - ${elementName} Component
 */

import React from "react";
import type { AnimatedStyles } from "@/remotion/components/AnimatedElement";

export interface ${compositionName}${elementName}Props {
  animatedStyles: AnimatedStyles;
}

export const ${compositionName}${elementName}: React.FC<${compositionName}${elementName}Props> = ({
  animatedStyles,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: animatedStyles.backgroundColor,
        borderColor: animatedStyles.borderColor,
        borderWidth: animatedStyles.borderWidth,
        borderStyle: "solid",
        borderRadius: animatedStyles.borderRadius,
        boxShadow: animatedStyles.boxShadow,
        transform: animatedStyles.transform,
        filter: animatedStyles.filter,
        opacity: animatedStyles.opacity,
        fontFamily: "Inter, sans-serif",
        fontSize: 18,
        fontWeight: 600,
        color: "white",
      }}
    >
      {/* TODO: Customize your ${elementName} content */}
      ${elementName}
    </div>
  );
};
`;

const TEMPLATE_CONFIG = (name: string) => `/**
 * ${name} Configuration
 * Defines tracks, cursor path, and constants
 */

import type { AnimationTrack } from "@/types";

export const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: 300,
    easing: "linear",
    animatedProps: [
      { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [] },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 300,
    easing: "expo.inOut",
    animatedProps: [
      {
        property: "x",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [
          { frame: 0, value: "100", easing: "expo.inOut" },
          { frame: 100, value: "500", easing: "expo.inOut" },
          { frame: 200, value: "900", easing: "expo.inOut" },
          { frame: 300, value: "100", easing: "expo.inOut" },
        ],
      },
      {
        property: "y",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [
          { frame: 0, value: "540", easing: "expo.inOut" },
          { frame: 100, value: "540", easing: "expo.inOut" },
          { frame: 200, value: "540", easing: "expo.inOut" },
          { frame: 300, value: "540", easing: "expo.inOut" },
        ],
      },
      { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "type", from: "default", to: "default", unit: "", keyframes: [] },
      {
        property: "isClicking",
        from: "0",
        to: "0",
        unit: "",
        keyframes: [
          { frame: 110, value: "1", easing: "linear" },
          { frame: 112, value: "0", easing: "linear" },
        ],
      },
    ],
  },
];
`;

const TEMPLATE_README = (
  name: string,
  elements: string[],
) => `# ${name} Composition

Auto-generated Remotion composition with animated elements.

## Elements

${elements.map((el) => `- **${el}**: Animated component with hover and click interactions`).join("\n")}

## Customization

1. **Edit element appearance**: Modify \`${name}*.tsx\` component files
2. **Add animations**: Use the Properties panel in the Video Studio UI
3. **⭐ Customize cursor path**: Edit cursor track in \`${name}Config.ts\` (**NEVER hardcode cursor movement in component!**)
4. **Add more elements**: Create new components and register in \`${name}.tsx\`

## 🎯 CRITICAL: Cursor Animation Pattern

**Always define cursor animations as tracks**, never hardcode them:

✅ **CORRECT** (cursor defined in config):
\`\`\`typescript
// In ${name}Config.ts
{
  id: "cursor",
  animatedProps: [
    { property: "x", keyframes: [...] },
    { property: "y", keyframes: [...] },
    { property: "type", keyframes: [...] },
  ]
}

// In ${name}.tsx
<CameraHost tracks={tracks}>
  {/* Cursor renders automatically from track */}
</CameraHost>
\`\`\`

❌ **WRONG** (hardcoded in component):
\`\`\`typescript
// DON'T DO THIS
const cursorX = interpolate(frame, [0, 100], [0, 1920]);
<Cursor x={cursorX} y={cursorY} />
\`\`\`

## File Structure

\`\`\`
${name}/
├── ${name}.tsx              # Main composition
├── ${name}Config.ts         # Tracks and configuration
${elements.map((el) => `├── ${name}${el}.tsx       # ${el} component`).join("\n")}
└── README.md                # This file
\`\`\`

## Adding to Registry

Add to \`app/remotion/registry.ts\`:

\`\`\`typescript
import { ${name} } from "@/remotion/compositions/${name}";

{
  id: "${name.toLowerCase()}",
  title: "${name}",
  description: "TODO: Add description",
  component: ${name},
  durationInFrames: 300,
  fps: 30,
  width: 1920,
  height: 1080,
  defaultProps: {} satisfies ${name}Props,
  tracks: FALLBACK_TRACKS, // Import from ${name}Config
}
\`\`\`
`;

function generateComponent(options: GeneratorOptions): void {
  const { name, elements, outputDir } = options;

  console.log(`\n🎬 Generating animated composition: ${name}`);
  console.log(`📦 Elements: ${elements.join(", ")}\n`);

  // Create output directory
  const compDir = path.join(outputDir, name);
  if (!fs.existsSync(compDir)) {
    fs.mkdirSync(compDir, { recursive: true });
  } else {
    console.error(`❌ Directory already exists: ${compDir}`);
    throw new Error("Script failed");
  }

  // Generate main composition file
  const compositionPath = path.join(compDir, `${name}.tsx`);
  fs.writeFileSync(compositionPath, TEMPLATE_COMPOSITION(name, elements));
  console.log(`✅ Created ${compositionPath}`);

  // Generate config file
  const configPath = path.join(compDir, `${name}Config.ts`);
  fs.writeFileSync(configPath, TEMPLATE_CONFIG(name));
  console.log(`✅ Created ${configPath}`);

  // Generate element components
  elements.forEach((element) => {
    const elementPath = path.join(compDir, `${name}${element}.tsx`);
    fs.writeFileSync(elementPath, TEMPLATE_ELEMENT(name, element));
    console.log(`✅ Created ${elementPath}`);
  });

  // Generate README
  const readmePath = path.join(compDir, "README.md");
  fs.writeFileSync(readmePath, TEMPLATE_README(name, elements));
  console.log(`✅ Created ${readmePath}`);

  console.log(`\n✨ Successfully generated composition!`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Customize element components in ${compDir}/`);
  console.log(`   2. Add to registry in app/remotion/registry.ts`);
  console.log(`   3. Open in Video Studio UI to configure animations\n`);
}

// Parse CLI arguments
function parseArgs(): GeneratorOptions {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
📦 Animated Component Generator

Usage:
  npm run generate:component <ComponentName> [options]

Options:
  --elements <Element1,Element2>   Comma-separated list of element types (default: Button,Card)
  --output <dir>                   Output directory (default: app/remotion/compositions)

Examples:
  npm run generate:component MyDashboard
  npm run generate:component MyDashboard --elements Button,Card,Panel,Toggle
  npm run generate:component MyApp --elements Hero,Feature,CTA --output src/components
    `);
    return;
  }

  const name = args[0];
  const elementsArg = args.find((arg, i) => args[i - 1] === "--elements");
  const outputArg = args.find((arg, i) => args[i - 1] === "--output");

  return {
    name,
    elements: elementsArg ? elementsArg.split(",") : ["Button", "Card"],
    outputDir: outputArg || "app/remotion/compositions",
  };
}

// Run generator
const options = parseArgs();
generateComponent(options);
