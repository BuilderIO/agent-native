import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { CoreAgentKitRoot } from "./root.js";

const mocks = vi.hoisted(() => ({
  nativeUpload: vi.fn(),
  rootProps: null as AgentKitRootProps | null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }),
}));
vi.mock("@agent-native/core/client/agentkit-chat/transport", () => ({
  getAgentNativeAgentKitUploadDriver: () => mocks.nativeUpload,
  clearAgentNativeAgentKitUploads: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));
vi.mock("../../agentkit/react/root.js", () => ({
  AgentKitRoot: (props: AgentKitRootProps) => {
    mocks.rootProps = props;
    return null;
  },
}));

it("localizes a non-retryable Builder reconnect upload error", async () => {
  mocks.nativeUpload.mockRejectedValue(
    Object.assign(new Error("untrusted"), {
      code: "upload_builder_oauth_reauthorization_required",
      status: 503,
      retryable: false,
    }),
  );
  renderToStaticMarkup(
    <CoreAgentKitRoot
      transport={{
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
      }}
      threadId="thread-1"
    />,
  );
  await expect(
    mocks.rootProps?.clientOptions?.upload?.(
      { uploadId: "id", method: "POST", url: "/upload" },
      { name: "file", mediaType: "text/plain", size: 1, body: new Blob(["x"]) },
    ),
  ).rejects.toMatchObject({
    message: "agentChat.composer.uploadBuilderReconnect",
    code: "upload_builder_oauth_reauthorization_required",
    status: 503,
    retryable: false,
  });
});
