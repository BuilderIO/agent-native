import { useActionMutation } from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  IDLE,
  REQUEST_TIMEOUT_MS,
  liveTestFor,
  liveTestReducer,
  type LiveTest,
} from "./api-request-test";
import {
  liveAnswerOf,
  liveAnswerOfRefusal,
  type ApiTestResult,
} from "./node-details/api-request-output";
import { readActionFailure } from "./workflow-errors";

interface Input {
  factoryId: string;
  workflowId: string;
  /** The step open in the window; none when it is closed. */
  nodeId: string | undefined;
  /** Saves the page's edits first, as Test step does. Resolves to whether they are saved. */
  save: () => Promise<boolean>;
  /** The text for a failure that carries none. */
  unknownMessage: string;
}

/**
 * Sends one API request step through `test-api-request-step` and holds the
 * answer in this component's state alone. The mutation keeps nothing: it is
 * dropped from react-query's cache the moment it settles, and the answer is not
 * in the URL, in storage or in any query. Opening another step or closing the
 * window clears it.
 */
export function useApiRequestTest({
  factoryId,
  workflowId,
  nodeId,
  save,
  unknownMessage,
}: Input): { state: LiveTest; running: boolean; run: () => void } {
  const [state, dispatch] = useReducer(liveTestReducer, IDLE);
  const token = useRef(0);
  const { mutateAsync, reset } = useActionMutation<
    ApiTestResult,
    { factoryId: string; workflowId: string; nodeId: string }
  >("test-api-request-step", {
    uiOnly: true,
    skipActionQueryInvalidation: true,
    timeoutMs: REQUEST_TIMEOUT_MS,
    // The result is customer data: the cache does not keep a settled mutation.
    gcTime: 0,
  });

  useEffect(() => {
    dispatch({ type: "clear" });
  }, [nodeId]);

  const run = useCallback(() => {
    if (nodeId === undefined) return;
    token.current += 1;
    const mine = token.current;
    // The area answers before anything is saved or sent.
    dispatch({ type: "start", nodeId, token: mine });
    void (async () => {
      if (!(await save())) {
        dispatch({ type: "abandon", nodeId, token: mine });
        return;
      }
      try {
        const result = await mutateAsync({ factoryId, workflowId, nodeId });
        dispatch({
          type: "finish",
          nodeId,
          token: mine,
          answer: liveAnswerOf(result),
        });
      } catch (error) {
        const failure = readActionFailure(error, unknownMessage);
        dispatch({
          type: "finish",
          nodeId,
          token: mine,
          answer: liveAnswerOfRefusal(failure.errorCode, failure.message),
        });
      } finally {
        reset();
      }
    })();
  }, [factoryId, mutateAsync, nodeId, reset, save, unknownMessage, workflowId]);

  const shown = liveTestFor(state, nodeId);
  return { state: shown, running: shown.phase === "running", run };
}
