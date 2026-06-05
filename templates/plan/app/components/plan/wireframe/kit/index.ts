/*
 * Plan wireframe kit — hand-drawn low-fi primitives + the node registry.
 *
 * The MODEL emits a lean kit tree (PlanWireframeNode[]); this kit owns ALL
 * visual quality. Import the design tokens once (they scope to `.plan-wf`), use
 * `renderNodes` to draw a screen tree, and `Screen` as the root frame.
 */
import "./plan-wireframe-tokens.css";

export * from "./primitives";
export * from "./wobble";
export {
  NODE_REGISTRY,
  renderNode,
  renderNodes,
  hasRenderer,
} from "./registry";
