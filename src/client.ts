import { buildPulseWebSocketUrl } from './auth';
import {
  PulseClientSnapshot,
  PulseConnectionStatus,
  PulseErrorEvent,
  PulsePresenceEvent,
  PulsePresenceMember,
  PulseSystemEvent,
  defaultPulseSnapshot,
} from './protocol';

export type PulseEventType =
  | 'message'
  | 'presence'
  | 'system'
  | 'error'
  | 'raw'
  | 'connect'
  | 'disconnect'
  | 'status';

export type PulseEventMap<TMessage = unknown> = {
  message: TMessage;
  presence: PulsePresenceEvent;
  system: PulseSystemEvent;
  error: Event | PulseErrorEvent;
  raw: MessageEvent['data'];
  connect: undefined;
  disconnect: CloseEvent | undefined;
  status: PulseConnectionStatus;
};

export type PulseEventHandler<TData = unknown> = (data: TData) => void;
export type PulseParser = (raw: MessageEvent['data']) => unknown;
export type PulseSerializer = (data: unknown) => string | ArrayBuffer | Blob | ArrayBufferView;
export type PulseSnapshotListener = () => void;

export interface PulseClientOptions<TMessage = unknown> {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  reconnectBackoffMultiplier?: number;
  maxReconnectInterval?: number;
  queueOfflineMessages?: boolean;
  parser?: PulseParser;
  serializer?: PulseSerializer;
  protocols?: string | string[];
  presenceTracking?: boolean;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
}

const defaultParser: PulseParser = (raw) => {
  if (typeof raw !== 'string') {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const defaultSerializer: PulseSerializer = (data) => {
  if (
    typeof data === 'string' ||
    data instanceof ArrayBuffer ||
    data instanceof Blob ||
    ArrayBuffer.isView(data)
  ) {
    return data;
  }

  return JSON.stringify(data);
};

function isPresenceEvent(value: unknown): value is PulsePresenceEvent {
  return !!value && typeof value === 'object' && (value as { type?: string }).type === 'presence';
}

function isSystemEvent(value: unknown): value is PulseSystemEvent {
  return !!value && typeof value === 'object' && (value as { type?: string }).type === 'system';
}

function isErrorEvent(value: unknown): value is PulseErrorEvent {
  return !!value && typeof value === 'object' && (value as { type?: string }).type === 'error';
}

export class PulseClient<TMessage = unknown> {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: { [K in PulseEventType]: Set<PulseEventHandler<PulseEventMap<TMessage>[K]>> } = {
    message: new Set(),
    presence: new Set(),
    system: new Set(),
    error: new Set(),
    raw: new Set(),
    connect: new Set(),
    disconnect: new Set(),
    status: new Set(),
  };
  private snapshotListeners = new Set<PulseSnapshotListener>();
  private options: Required<
    Pick<
      PulseClientOptions<TMessage>,
      | 'autoReconnect'
      | 'reconnectInterval'
      | 'reconnectBackoffMultiplier'
      | 'maxReconnectInterval'
      | 'queueOfflineMessages'
      | 'presenceTracking'
    >
  > &
    Omit<
      PulseClientOptions<TMessage>,
      | 'autoReconnect'
      | 'reconnectInterval'
      | 'reconnectBackoffMultiplier'
      | 'maxReconnectInterval'
      | 'queueOfflineMessages'
      | 'presenceTracking'
    >;
  private isIntentionalDisconnect = false;
  private reconnectDelay: number;
  private outboundQueue: Array<unknown | string | ArrayBuffer | Blob | ArrayBufferView> = [];
  private snapshot: PulseClientSnapshot<TMessage> = defaultPulseSnapshot() as PulseClientSnapshot<TMessage>;

  public status: PulseConnectionStatus = 'disconnected';

  constructor(baseUrl: string, ticketToken: string, options: PulseClientOptions<TMessage> = {}) {
    this.url = buildPulseWebSocketUrl(baseUrl, ticketToken);
    this.options = {
      autoReconnect: true,
      reconnectInterval: 3000,
      reconnectBackoffMultiplier: 1.5,
      maxReconnectInterval: 15000,
      queueOfflineMessages: true,
      presenceTracking: true,
      parser: defaultParser,
      serializer: defaultSerializer,
      protocols: undefined,
      webSocketFactory: undefined,
      ...options,
    };
    this.reconnectDelay = this.options.reconnectInterval;
  }

  public connect(): void {
    if (this.status === 'connecting' || this.status === 'connected') {
      return;
    }

    this.isIntentionalDisconnect = false;
    this.setStatus('connecting');

    try {
      const factory = this.options.webSocketFactory;
      this.ws = factory ? factory(this.url, this.options.protocols) : new WebSocket(this.url, this.options.protocols);

      this.ws.onopen = () => {
        this.reconnectDelay = this.options.reconnectInterval;
        this.setStatus('connected');
        this.emit('connect', undefined);
        this.flushQueue();
      };

      this.ws.onmessage = (event) => {
        this.emit('raw', event.data);
        const parser = this.options.parser ?? defaultParser;
        const parsed = parser(event.data);

        if (isPresenceEvent(parsed)) {
          this.handlePresence(parsed);
          this.emit('presence', parsed);
          return;
        }

        if (isSystemEvent(parsed)) {
          this.updateSnapshot({ lastSystem: parsed });
          this.emit('system', parsed);
          return;
        }

        if (isErrorEvent(parsed)) {
          this.updateSnapshot({ lastError: parsed });
          this.emit('error', parsed);
          return;
        }

        this.updateSnapshot({ lastMessage: parsed as TMessage });
        this.emit('message', parsed as TMessage);
      };

      this.ws.onclose = (event) => {
        this.ws = null;
        this.setStatus('disconnected');
        this.emit('disconnect', event);

        if (this.options.autoReconnect && !this.isIntentionalDisconnect) {
          const delay = this.reconnectDelay;
          this.reconnectDelay = Math.min(
            Math.round(this.reconnectDelay * this.options.reconnectBackoffMultiplier),
            this.options.maxReconnectInterval,
          );
          setTimeout(() => this.connect(), delay);
        }
      };

      this.ws.onerror = (event) => {
        this.updateSnapshot({ lastError: event });
        this.emit('error', event);
      };
    } catch (error) {
      this.setStatus('disconnected');
      this.updateSnapshot({ lastError: error as Event });
    }
  }

  public disconnect(): void {
    this.isIntentionalDisconnect = true;
    if (this.ws) {
      this.ws.close();
    }
  }

  public send(data: unknown): boolean {
    if (!this.ws || this.status !== 'connected') {
      if (this.options.queueOfflineMessages) {
        this.outboundQueue.push(data);
        return true;
      }

      return false;
    }

  const serializer = this.options.serializer ?? defaultSerializer;
  this.ws.send(serializer(data) as any);
    return true;
  }

  public sendRaw(data: string | ArrayBuffer | Blob | ArrayBufferView): boolean {
    if (!this.ws || this.status !== 'connected') {
      if (this.options.queueOfflineMessages) {
        this.outboundQueue.push(data);
        return true;
      }

      return false;
    }

    this.ws.send(data as any);
    return true;
  }

  public on<K extends PulseEventType>(event: K, callback: PulseEventHandler<PulseEventMap<TMessage>[K]>): () => void {
    this.listeners[event].add(callback as PulseEventHandler<PulseEventMap<TMessage>[K]>);
    return () => this.off(event, callback);
  }

  public off<K extends PulseEventType>(event: K, callback: PulseEventHandler<PulseEventMap<TMessage>[K]>): void {
    this.listeners[event].delete(callback as PulseEventHandler<PulseEventMap<TMessage>[K]>);
  }

  public subscribe(listener: PulseSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  public getSnapshot(): PulseClientSnapshot<TMessage> {
    return this.snapshot;
  }

  public getPresenceMembers(): PulsePresenceMember[] {
    return this.snapshot.presenceMembers;
  }

  private flushQueue(): void {
    if (!this.ws || this.status !== 'connected' || this.outboundQueue.length === 0) {
      return;
    }

    for (const queued of this.outboundQueue.splice(0)) {
      if (
        typeof queued === 'string' ||
        queued instanceof ArrayBuffer ||
        queued instanceof Blob ||
        ArrayBuffer.isView(queued)
      ) {
        this.ws.send(queued as any);
      } else {
        const serializer = this.options.serializer ?? defaultSerializer;
        this.ws.send(serializer(queued) as any);
      }
    }
  }

  private handlePresence(event: PulsePresenceEvent): void {
    if (!this.options.presenceTracking) {
      this.updateSnapshot({ lastPresence: event });
      return;
    }

    if (event.event === 'sync') {
      const nextPresence: Record<string, PulsePresenceMember> = {};
      for (const member of event.users ?? []) {
        nextPresence[member.userId] = member;
      }

      this.updateSnapshot({
        presence: nextPresence,
        presenceMembers: Object.values(nextPresence),
        lastPresence: event,
      });
      return;
    }

    const presence = { ...this.snapshot.presence };

    if (event.userId) {
      if (event.event === 'leave') {
        delete presence[event.userId];
      } else {
        presence[event.userId] = {
          userId: event.userId,
          metadata: event.metadata,
        };
      }
    }

    this.updateSnapshot({
      presence,
      presenceMembers: Object.values(presence),
      lastPresence: event,
    });
  }

  private setStatus(status: PulseConnectionStatus): void {
    this.status = status;
    this.updateSnapshot({ status });
    this.emit('status', status);
  }

  private updateSnapshot(partial: Partial<PulseClientSnapshot<TMessage>>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };

    for (const listener of this.snapshotListeners) {
      listener();
    }
  }

  private emit<K extends PulseEventType>(event: K, data: PulseEventMap<TMessage>[K]): void {
    const callbacks = this.listeners[event] ?? new Set();
    for (const callback of callbacks) {
      callback(data);
    }
  }
}
