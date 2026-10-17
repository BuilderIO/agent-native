import type { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentKitHttpTransportOptions } from "@agent-native/agentkit/http";
import type { AgentTransport } from "@agent-native/agentkit/protocol";

import { AgentKitChat, type AgentKitChatProps } from "./components.js";
import {
  AgentKitRoot,
  type AgentKitClientSource,
  type AgentKitManagedClientOptions,
  type AgentKitRootBaseProps,
} from "./root.js";

export type AgentChatClientSource =
  | {
      client: AgentKitClient;
      endpoint?: never;
      transport?: never;
      http?: never;
      clientOptions?: never;
    }
  | {
      transport: AgentTransport;
      endpoint?: never;
      client?: never;
      http?: never;
      clientOptions?: AgentKitManagedClientOptions;
    }
  | {
      endpoint: string;
      http?: Omit<AgentKitHttpTransportOptions, "baseUrl">;
      client?: never;
      transport?: never;
      clientOptions?: AgentKitManagedClientOptions;
    };

export type AgentChatProps = Omit<AgentKitRootBaseProps, "children"> &
  AgentChatClientSource &
  AgentKitChatProps;

export function AgentChat(props: AgentChatProps) {
  const {
    client,
    transport,
    endpoint,
    http,
    clientOptions,
    title,
    toolbar,
    composer,
    composerProps,
    hasRenderedMessages,
    emptyComposerPlacement,
    autoScroll,
    className,
    ...rootProps
  } = props;
  const sourceCount =
    Number(client !== undefined) +
    Number(transport !== undefined) +
    Number(endpoint !== undefined);
  if (sourceCount !== 1) {
    throw new Error(
      "AgentChat requires exactly one client, transport, or HTTP endpoint.",
    );
  }
  const rootSource: AgentKitClientSource =
    client !== undefined
      ? { controller: client }
      : transport !== undefined
        ? { transport, clientOptions }
        : { endpoint: endpoint as string, http, clientOptions };
  return (
    <AgentKitRoot {...rootProps} {...rootSource}>
      <AgentKitChat
        title={title}
        toolbar={toolbar}
        composer={composer}
        composerProps={composerProps}
        hasRenderedMessages={hasRenderedMessages}
        emptyComposerPlacement={emptyComposerPlacement}
        autoScroll={autoScroll}
        className={className}
      />
    </AgentKitRoot>
  );
}
