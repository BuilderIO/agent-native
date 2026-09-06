import type { AgentKitHttpTransportOptions } from "@agent-native/agentkit-adapters";
import type { AgentKitClient } from "@agent-native/agentkit-client";
import type { AgentTransport } from "@agent-native/agentkit-protocol";

import { AgentKitChat, type AgentKitChatProps } from "./components.js";
import {
  AgentKitRoot,
  type AgentKitClientSource,
  type AgentKitManagedClientOptions,
  type AgentKitRootBaseProps,
} from "./root.js";

export type AgentChatClientSource =
  | {
      /** Caller-owned client. AgentChat loads threads but never disposes it. */
      client: AgentKitClient;
      endpoint?: never;
      transport?: never;
      http?: never;
      clientOptions?: never;
    }
  | {
      /** Caller-owned transport wrapped in an AgentChat-owned client. */
      transport: AgentTransport;
      endpoint?: never;
      client?: never;
      http?: never;
      clientOptions?: AgentKitManagedClientOptions;
    }
  | {
      /** Endpoint wrapped in an AgentChat-owned HTTP transport and client. */
      endpoint: string;
      http?: Omit<AgentKitHttpTransportOptions, "baseUrl">;
      client?: never;
      transport?: never;
      clientOptions?: AgentKitManagedClientOptions;
    };

export type AgentChatProps = Omit<AgentKitRootBaseProps, "children"> &
  AgentChatClientSource &
  AgentKitChatProps;

/**
 * Batteries-included AgentKit surface. Pass an endpoint and thread id for the
 * common path; use `AgentKitRoot` when a product needs a custom composition.
 */
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
        emptyComposerPlacement={emptyComposerPlacement}
        autoScroll={autoScroll}
        className={className}
      />
    </AgentKitRoot>
  );
}
