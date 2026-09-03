import { dispatchActions } from "@agent-native/dispatch/actions";

// Keep the template action registry aligned with the package action. The
// package implementation is also what the shared Dispatch metrics screen
// exercises, including personal scope and prompt attribution.
export default dispatchActions["list-dispatch-usage-metrics"];
