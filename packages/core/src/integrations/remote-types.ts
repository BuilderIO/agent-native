export type RemoteCommandKind =
  | "create-run"
  | "list-runs"
  | "get-run"
  | "append-followup"
  | "approve"
  | "deny"
  | "stop"
  | "status"
  | "computer-operation";

export type ComputerOperationClass =
  | "browser.observe"
  | "browser.control"
  | "desktop.observe"
  | "desktop.control";

export type ComputerApprovalScope = "once" | "run" | "task";

export interface ComputerCommandAction {
  type: string;
  target?: Record<string, unknown> | null;
  input?: unknown;
}

export interface ComputerCommandEnvelope {
  version: 1;
  taskId: string;
  runId: string;
  sequence: number;
  idempotencyKey: string;
  operationClass: ComputerOperationClass;
  action: ComputerCommandAction;
  approval: {
    id?: string | null;
    scope: ComputerApprovalScope;
    actionHash: string;
  };
  issuedAt: number;
  leaseExpiresAt: number;
}

export interface RemoteComputerCapabilities {
  browser?: {
    observe: boolean;
    control: boolean;
    provider?: string | null;
    version?: string | null;
  };
  desktop?: {
    observe: boolean;
    control: boolean;
    accessibility?: boolean;
    screenCapture?: boolean;
    provider?: string | null;
    version?: string | null;
  };
}

export interface RemoteDeviceMetadata extends Record<string, unknown> {
  computerCapabilities?: RemoteComputerCapabilities;
}

export type RemoteCommandStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed";

export type RemoteDeviceStatus = "active" | "inactive";

export interface RemoteDevice {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  label: string;
  platform: string | null;
  appVersion: string | null;
  hostName: string | null;
  metadata: RemoteDeviceMetadata | null;
  deviceTokenHash: string;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicRemoteDevice {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  label: string;
  platform: string | null;
  appVersion: string | null;
  hostName: string | null;
  metadata: RemoteDeviceMetadata | null;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteCommand {
  id: string;
  deviceId: string;
  ownerEmail: string;
  orgId: string | null;
  kind: RemoteCommandKind;
  params: unknown;
  status: RemoteCommandStatus;
  result: unknown;
  platform: string | null;
  externalThreadId: string | null;
  computerOperation?: ComputerCommandEnvelope | null;
  attempts: number;
  nextCheckAt: number;
  claimedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteRunEvent {
  deviceId: string;
  remoteRunId: string;
  seq: number;
  event: unknown;
  createdAt: number;
}

export interface RemoteLiveViewEvent {
  type: "computer.live-view";
  frameHandle: string;
  capturedAt: number;
  width?: number | null;
  height?: number | null;
  targetLabel?: string | null;
}

export type RemotePushRegistrationStatus = "active" | "inactive";

export interface RemotePushRegistration {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  provider: string;
  platform: string | null;
  clientDeviceId: string | null;
  label: string | null;
  token: string;
  tokenHash: string;
  status: RemotePushRegistrationStatus;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicRemotePushRegistration {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  provider: string;
  platform: string | null;
  clientDeviceId: string | null;
  label: string | null;
  status: RemotePushRegistrationStatus;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemotePushNotification {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  registrationId: string;
  payload: unknown;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  createdAt: number;
  updatedAt: number;
}
