export type PulseConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface PulseFeatureFlags {
  presence?: boolean;
  presenceSync?: boolean;
  selfEcho?: boolean;
}

export interface PulseMetadata {
  [key: string]: unknown;
}

export interface PulsePresenceMember {
  userId: string;
  metadata?: PulseMetadata;
}

export interface PulsePresenceEvent {
  type: 'presence';
  event: 'join' | 'leave' | 'sync';
  userId?: string;
  users?: PulsePresenceMember[];
  metadata?: PulseMetadata;
}

export interface PulseSystemEvent {
  type: 'system';
  event: string;
  roomId?: string;
  userId?: string;
  features?: PulseFeatureFlags;
}

export interface PulseErrorEvent {
  type: 'error';
  code?: string;
  message?: string;
  limit?: number;
}

export interface PulseDisconnectState {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export interface PulseClientMetrics {
  reconnectAttempts: number;
  reconnectScheduled: number;
  successfulReconnects: number;
  queuedMessages: number;
  heartbeatSent: number;
  heartbeatTimeouts: number;
  visibilityState: 'visible' | 'hidden' | 'unknown';
  online: boolean | 'unknown';
}

export interface PulseClientSnapshot<TMessage = unknown> {
  status: PulseConnectionStatus;
  presence: Record<string, PulsePresenceMember>;
  presenceMembers: PulsePresenceMember[];
  lastMessage: TMessage | null;
  lastPresence: PulsePresenceEvent | null;
  lastSystem: PulseSystemEvent | null;
  lastError: Event | PulseErrorEvent | null;
  lastDisconnect: PulseDisconnectState | null;
  metrics: PulseClientMetrics;
}

export const defaultPulseFeatures: Required<PulseFeatureFlags> = {
  presence: true,
  presenceSync: true,
  selfEcho: false,
};

export const defaultPulseSnapshot = (): PulseClientSnapshot => ({
  status: 'disconnected',
  presence: {},
  presenceMembers: [],
  lastMessage: null,
  lastPresence: null,
  lastSystem: null,
  lastError: null,
  lastDisconnect: null,
  metrics: {
    reconnectAttempts: 0,
    reconnectScheduled: 0,
    successfulReconnects: 0,
    queuedMessages: 0,
    heartbeatSent: 0,
    heartbeatTimeouts: 0,
    visibilityState: 'unknown',
    online: 'unknown',
  },
});
