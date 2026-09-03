import { runScript } from "@agent-native/core/scripts";
import { dispatchActions } from "@agent-native/dispatch/actions";

void runScript({
  packageActions: dispatchActions,
  packageActionLabel: "Dispatch package actions",
});
