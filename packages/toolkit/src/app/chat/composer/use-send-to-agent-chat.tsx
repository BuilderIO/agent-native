import { useSendToAgentChat as useCoreSendToAgentChat } from "@agent-native/core/client/agent-chat";

import { CodeRequiredDialog } from "../components/CodeRequiredDialog.js";

export function useSendToAgentChat() {
  const { codeRequiredRequest, dismissCodeRequiredRequest, ...state } =
    useCoreSendToAgentChat();

  return {
    ...state,
    codeRequiredDialog: codeRequiredRequest ? (
      <CodeRequiredDialog
        open
        featureLabel={codeRequiredRequest.featureLabel}
        onClose={dismissCodeRequiredRequest}
      />
    ) : null,
  };
}
