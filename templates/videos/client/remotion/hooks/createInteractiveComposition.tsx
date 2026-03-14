import React from "react";
import { CameraHost } from "../CameraHost";
import { findTrack } from "../trackAnimation";
import { useCursorHistory } from "./useCursorHistory";
import { useInteractiveComponentsCursor } from "./useInteractiveComponent";
import { createCameraTrack, createCursorTrack } from "../trackHelpers";
import type { AnimationTrack } from "@/types";
import type { CursorFrame } from "./useCursorHistory";
import type { InteractiveComponentState } from "./useInteractiveComponent";

/**
 * createInteractiveComposition - The standard way to create Video Studio compositions
 *
 * AUTOMATICALLY HANDLES:
 * ✓ Cursor history setup for hover detection
 * ✓ Track finding with fallbacks
 * ✓ Cursor type aggregation from interactive components
 * ✓ CameraHost wrapping for camera animations
 * ✓ Component registration system
 *
 * REDUCES CODE: ~320 lines → ~100 lines (70% reduction!)
 *
 * BEST PRACTICES FOR ALL COMPONENTS:
 *
 * 1. ALWAYS make components interactive from the start:
 *    - Use useInteractiveComponent hook
 *    - Define precise zones { x, y, width, height }
 *    - Register with registerForCursor()
 *
 * 2. ALWAYS use AnimatedElement to apply properties (RECOMMENDED):
 *    - import { AnimatedElement } from "@/remotion/components/AnimatedElement";
 *    - <AnimatedElement interactive={button} as="button">
 *        Click me
 *      </AnimatedElement>
 *    - ALL properties (scale, backgroundColor, blur, etc.) work automatically!
 *    - Users can add ANY CSS property via UI without code changes
 *
 * 3. ALWAYS register in useEffect:
 *    - React.useEffect(() => {
 *        registerForCursor(interactive);
 *      }, [interactive.hover.isHovering, interactive.click.isClicking]);
 *
 * 4. Manual extraction only for custom logic (not recommended for most cases):
 *    - const glow = (interactive.animatedProperties?.glow as number) ?? 0;
 *    - Use for dynamic child element effects only
 *
 * WHY THIS MATTERS:
 * - Components are immediately discoverable (hover to select)
 * - No setup friction (works without animations configured)
 * - Graceful degradation (safe fallbacks prevent errors)
 * - Instant feedback (shows in Cursor Interactions panel)
 * - User-friendly (animations can be added through UI)
 */

export type InteractiveCompositionContext = {
  /** Cursor history for hover detection (already configured) */
  cursorHistory: CursorFrame[];
  /** All tracks (with fallbacks applied) */
  tracks: AnimationTrack[];
  /** Camera track (already found) */
  cameraTrack: AnimationTrack;
  /** Cursor track (already found) */
  cursorTrack: AnimationTrack;
};

export type InteractiveCompositionRenderProps = InteractiveCompositionContext & {
  /** Register an interactive component for cursor aggregation */
  registerForCursor: (component: InteractiveComponentState) => void;
};

export type InteractiveCompositionConfig<TProps> = {
  /** Fallback tracks when tracks prop is missing/incomplete */
  fallbackTracks: AnimationTrack[];
  
  /** 
   * Render function - receives context with pre-configured cursor history
   * Return your composition UI using the context
   */
  render: (context: InteractiveCompositionRenderProps, props: TProps) => React.ReactNode;
  
  /**
   * Optional: Custom cursor history buffer size (default: 6 frames)
   * Larger = smoother hover detection, smaller = more responsive
   */
  cursorHistorySize?: number;
};

/**
 * Creates an interactive composition component with automatic setup
 * 
 * @example
 * ```tsx
 * export const MyComp = createInteractiveComposition<MyCompProps>({
 *   fallbackTracks: FALLBACK_TRACKS,
 *   render: ({ cursorHistory, tracks, registerForCursor }, props) => {
 *     const button = useInteractiveComponent({
 *       compositionId: "my-comp",
 *       id: "submit-btn",
 *       elementType: "Button",
 *       label: "Submit",
 *       zone: { x: 100, y: 100, width: 120, height: 40 },
 *       cursorHistory,
 *       tracks,
 *       interactiveElementType: "button",
 *     });
 *     
 *     registerForCursor(button);
 *     
 *     return (
 *       <div>
 *         <button style={{ transform: `scale(${1 + button.hover.progress * 0.1})` }}>
 *           Submit
 *         </button>
 *       </div>
 *     );
 *   }
 * });
 * ```
 */
// Default tracks for when no fallbacks provided - use helper functions to ensure correct pattern
const DEFAULT_CAMERA_TRACK: AnimationTrack = createCameraTrack(150);
const DEFAULT_CURSOR_TRACK: AnimationTrack = createCursorTrack(150);

export function createInteractiveComposition<TProps extends { tracks?: AnimationTrack[] }>(
  config: InteractiveCompositionConfig<TProps>
): React.FC<TProps> {
  const { fallbackTracks, render, cursorHistorySize = 6 } = config;

  return (props: TProps) => {
    const tracks = props.tracks || fallbackTracks || [];

    // Find camera and cursor tracks with fallbacks
    const cameraFallback = fallbackTracks?.find(t => t.id === "camera") || fallbackTracks?.[0] || DEFAULT_CAMERA_TRACK;
    const cameraTrack = findTrack(tracks, "camera", cameraFallback);

    const cursorFallback = fallbackTracks?.find(t => t.id === "cursor") || fallbackTracks?.[1] || DEFAULT_CURSOR_TRACK;
    const cursorTrack = findTrack(tracks, "cursor", cursorFallback);
    
    // Set up cursor history
    const cursorHistory = useCursorHistory(cursorTrack, cursorHistorySize);
    
    // Collect interactive components for cursor aggregation
    // Use ref for storage + state counter to force re-renders only when hover changes
    const componentsRef = React.useRef<InteractiveComponentState[]>([]);
    const [, setUpdateCounter] = React.useState(0);
    
    const registerForCursor = React.useCallback((component: InteractiveComponentState) => {
      // Check if already registered (by ID, not zone object identity!)
      const existingIndex = componentsRef.current.findIndex(c => c.id === component.id);
      
      if (existingIndex >= 0) {
        const existing = componentsRef.current[existingIndex];
        // Only update if hover state actually changed (to prevent infinite loops)
        if (existing.hover.isHovering !== component.hover.isHovering) {
          componentsRef.current[existingIndex] = component;
          // Force a re-render only when hover state changes
          setUpdateCounter(c => c + 1);
        }
      } else {
        // Add new component
        componentsRef.current.push(component);
        // Only trigger update if this component is hovering (otherwise wait)
        if (component.hover.isHovering) {
          setUpdateCounter(c => c + 1);
        }
      }
    }, []);
    
    // Aggregate cursor types from all registered components
    const autoCursorType = useInteractiveComponentsCursor(componentsRef.current);
    
    // Build context
    const context: InteractiveCompositionRenderProps = {
      cursorHistory,
      tracks,
      cameraTrack,
      cursorTrack,
      registerForCursor,
    };
    
    // Render user content wrapped in CameraHost
    return (
      <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
        {render(context, props)}
      </CameraHost>
    );
  };
}

/**
 * Alternative pattern: Hook-based (for more control)
 * 
 * Use this when you want to manage CameraHost yourself or need more flexibility.
 * 
 * @example
 * ```tsx
 * export const MyComp: React.FC<MyCompProps> = ({ tracks = FALLBACK_TRACKS }) => {
 *   const { cursorHistory, autoCursorType, registerForCursor } = useInteractiveComposition({
 *     tracks,
 *     fallbackTracks: FALLBACK_TRACKS,
 *   });
 *   
 *   const button = useInteractiveComponent({ ... });
 *   registerForCursor(button);
 *   
 *   return (
 *     <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
 *       {/* Your UI *\/}
 *     </CameraHost>
 *   );
 * };
 * ```
 */
export function useInteractiveComposition(options: {
  tracks: AnimationTrack[];
  fallbackTracks: AnimationTrack[];
  cursorHistorySize?: number;
}) {
  const { tracks, fallbackTracks, cursorHistorySize = 6 } = options;
  
  const cursorTrack = findTrack(
    tracks,
    "cursor",
    fallbackTracks.find(t => t.id === "cursor") || fallbackTracks[1]
  );
  
  const cursorHistory = useCursorHistory(cursorTrack, cursorHistorySize);
  
  // Use ref for storage + state counter to force re-renders only when hover changes
  const componentsRef = React.useRef<InteractiveComponentState[]>([]);
  const [, setUpdateCounter] = React.useState(0);
  
  const registerForCursor = React.useCallback((component: InteractiveComponentState) => {
    const existingIndex = componentsRef.current.findIndex(c => c.id === component.id);
    
    if (existingIndex >= 0) {
      const existing = componentsRef.current[existingIndex];
      // Only update if hover state actually changed
      if (existing.hover.isHovering !== component.hover.isHovering) {
        componentsRef.current[existingIndex] = component;
        setUpdateCounter(c => c + 1);
      }
    } else {
      componentsRef.current.push(component);
      if (component.hover.isHovering) {
        setUpdateCounter(c => c + 1);
      }
    }
  }, []);
  
  const autoCursorType = useInteractiveComponentsCursor(componentsRef.current);
  
  return {
    cursorHistory,
    cursorTrack,
    autoCursorType,
    registerForCursor,
  };
}
