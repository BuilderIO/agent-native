// `import source from "./tasks.ts?bounded-task"` is bundled at build time by
// core's bounded-task plugin into a source the worker runner evaluates.
declare module "*?bounded-task" {
  const source: import("@agent-native/core/collab").BoundedTaskSource;
  export default source;
}
