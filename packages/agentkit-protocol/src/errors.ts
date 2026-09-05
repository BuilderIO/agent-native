import type {
  AgentCapabilityId,
  AgentCapabilityUnavailableError,
  AgentCapabilityUnsupportedError,
  AgentError,
  AgentOperationUnsupportedError,
  AgentRequestAbortedError,
  AgentProtocolMetadata,
  AgentProtocolVersionUnsupportedError,
} from "./index.js";

export interface AgentErrorOptions {
  message?: string;
  correlationId?: string;
  details?: unknown;
  metadata?: AgentProtocolMetadata;
}

function optionalErrorFields(
  options: AgentErrorOptions,
): Pick<AgentError, "correlationId" | "details" | "metadata"> {
  return {
    ...(options.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId }),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

/** Error thrown by transports while retaining the serializable wire error. */
export class AgentKitProtocolError<
  TError extends AgentError = AgentError,
> extends Error {
  public readonly code: TError["code"];
  public readonly retryable: TError["retryable"];
  public readonly correlationId: TError["correlationId"];

  public constructor(public readonly protocolError: TError) {
    super(protocolError.message);
    this.name = "AgentKitProtocolError";
    this.code = protocolError.code;
    this.retryable = protocolError.retryable;
    this.correlationId = protocolError.correlationId;
  }
}

export function createCapabilityUnsupportedError(
  capability: AgentCapabilityId,
  options: AgentErrorOptions = {},
): AgentCapabilityUnsupportedError {
  return {
    code: "capability_unsupported",
    capability,
    message:
      options.message ??
      `The ${JSON.stringify(capability)} capability is unsupported.`,
    retryable: false,
    ...optionalErrorFields(options),
  };
}

export function createCapabilityUnavailableError(
  capability: AgentCapabilityId,
  options: AgentErrorOptions & { retryable?: boolean } = {},
): AgentCapabilityUnavailableError {
  return {
    code: "capability_unavailable",
    capability,
    message:
      options.message ??
      `The ${JSON.stringify(capability)} capability is currently unavailable.`,
    retryable: options.retryable ?? true,
    ...optionalErrorFields(options),
  };
}

export function createOperationUnsupportedError(
  operation: string,
  options: AgentErrorOptions = {},
): AgentOperationUnsupportedError {
  return {
    code: "operation_unsupported",
    operation,
    message:
      options.message ??
      `The ${JSON.stringify(operation)} operation is unsupported.`,
    retryable: false,
    ...optionalErrorFields(options),
  };
}

export function createRequestAbortedError(
  options: AgentErrorOptions = {},
): AgentRequestAbortedError {
  return {
    code: "request_aborted",
    message: options.message ?? "The AgentKit operation was aborted.",
    retryable: false,
    ...optionalErrorFields(options),
  };
}

export function createProtocolVersionUnsupportedError(
  supportedVersions: AgentProtocolVersionUnsupportedError["supportedVersions"],
  receivedVersions: number[],
  options: AgentErrorOptions = {},
): AgentProtocolVersionUnsupportedError {
  return {
    code: "protocol_version_unsupported",
    supportedVersions: [...supportedVersions],
    receivedVersions: [...receivedVersions],
    message:
      options.message ??
      `No compatible AgentKit protocol version was offered. Supported versions: ${
        supportedVersions.join(", ") || "none"
      }.`,
    retryable: false,
    ...optionalErrorFields(options),
  };
}

export function isAgentKitProtocolError(
  value: unknown,
): value is AgentKitProtocolError {
  return value instanceof AgentKitProtocolError;
}
