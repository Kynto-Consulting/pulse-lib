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

export interface PulseClientSnapshot<TMessage = unknown> {
  status: PulseConnectionStatus;
  presence: Record<string, PulsePresenceMember>;
  presenceMembers: PulsePresenceMember[];
  lastMessage: TMessage | null;
  lastPresence: PulsePresenceEvent | null;
  lastSystem: PulseSystemEvent | null;
  lastError: Event | PulseErrorEvent | null;
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
});
