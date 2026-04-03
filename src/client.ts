import { buildPulseWebSocketUrl } from './auth';
import {
  PulseClientMetrics,
  PulseClientSnapshot,
  PulseConnectionStatus,
  PulseDisconnectState,
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
export type PulseShouldReconnect = (event?: CloseEvent) => boolean;
type PulseIncrementMetricKey =
  | 'reconnectAttempts'
  | 'reconnectScheduled'
  | 'successfulReconnects'
  | 'heartbeatSent'
  | 'heartbeatTimeouts';

export interface PulseClientOptions<TMessage = unknown> {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  reconnectBackoffMultiplier?: number;
  maxReconnectInterval?: number;
  reconnectJitterRatio?: number;
  queueOfflineMessages?: boolean;
  parser?: PulseParser;
  serializer?: PulseSerializer;
  protocols?: string | string[];
  presenceTracking?: boolean;
  pauseWhenHidden?: boolean;
  pauseWhenOffline?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  heartbeatMessage?: unknown;
  shouldReconnect?: PulseShouldReconnect;
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

function isBrowserDocumentAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.addEventListener === 'function';
}

function isNavigatorAvailable(): boolean {
  return typeof navigator !== 'undefined';
}

function createDefaultHeartbeatMessage(): { type: 'pulse'; event: 'ping'; ts: number } {
  return {
    type: 'pulse',
    event: 'ping',
    ts: Date.now(),
  };
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
      | 'reconnectJitterRatio'
      | 'queueOfflineMessages'
      | 'presenceTracking'
      | 'pauseWhenHidden'
      | 'pauseWhenOffline'
      | 'heartbeatIntervalMs'
      | 'heartbeatTimeoutMs'
    >
  > &
    Omit<
      PulseClientOptions<TMessage>,
      | 'autoReconnect'
      | 'reconnectInterval'
      | 'reconnectBackoffMultiplier'
      | 'maxReconnectInterval'
      | 'reconnectJitterRatio'
      | 'queueOfflineMessages'
      | 'presenceTracking'
      | 'pauseWhenHidden'
      | 'pauseWhenOffline'
      | 'heartbeatIntervalMs'
      | 'heartbeatTimeoutMs'
    >;
  private isIntentionalDisconnect = false;
  private reconnectDelay: number;
  private outboundQueue: Array<unknown | string | ArrayBuffer | Blob | ArrayBufferView> = [];
  private snapshot: PulseClientSnapshot<TMessage> = defaultPulseSnapshot() as PulseClientSnapshot<TMessage>;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReconnect = false;
  private heartbeatIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedBefore = false;

  public status: PulseConnectionStatus = 'disconnected';

  constructor(baseUrl: string, ticketToken: string, options: PulseClientOptions<TMessage> = {}) {
    this.url = buildPulseWebSocketUrl(baseUrl, ticketToken);
    this.options = {
      autoReconnect: true,
      reconnectInterval: 3000,
      reconnectBackoffMultiplier: 1.5,
      maxReconnectInterval: 15000,
      reconnectJitterRatio: 0.2,
      queueOfflineMessages: true,
      presenceTracking: true,
      pauseWhenHidden: true,
      pauseWhenOffline: true,
      heartbeatIntervalMs: 0,
      heartbeatTimeoutMs: 10000,
      parser: defaultParser,
      serializer: defaultSerializer,
      heartbeatMessage: createDefaultHeartbeatMessage(),
      shouldReconnect: undefined,
      protocols: undefined,
      webSocketFactory: undefined,
      ...options,
    };
    this.reconnectDelay = this.options.reconnectInterval;
    this.updateConnectivityMetrics();
    this.registerEnvironmentListeners();
  }

  public connect(): void {
    if (this.status === 'connecting' || this.status === 'connected') {
      return;
    }

    this.clearReconnectTimer();
    this.pendingReconnect = false;

    if (!this.canAttemptConnection()) {
      this.pendingReconnect = true;
      return;
    }

    this.isIntentionalDisconnect = false;
    this.setStatus('connecting');

    try {
      const factory = this.options.webSocketFactory;
      this.ws = factory ? factory(this.url, this.options.protocols) : new WebSocket(this.url, this.options.protocols);

      this.ws.onopen = () => {
        this.clearHeartbeatTimeout();
        this.reconnectDelay = this.options.reconnectInterval;
        if (this.hasConnectedBefore) {
          this.incrementMetric('successfulReconnects');
        }
        this.hasConnectedBefore = true;
        this.setStatus('connected');
        this.emit('connect', undefined);
        this.updateSnapshot({ lastDisconnect: null });
        this.flushQueue();
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        this.clearHeartbeatTimeout();
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
          if (parsed.event === 'pong') {
            return;
          }
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
        this.stopHeartbeat();
        this.setStatus('disconnected');
        this.updateSnapshot({
          lastDisconnect: this.toDisconnectState(event),
        });
        this.emit('disconnect', event);

        if (this.options.autoReconnect && !this.isIntentionalDisconnect && this.shouldReconnect(event)) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (event) => {
        this.updateSnapshot({ lastError: event });
        this.emit('error', event);
      };
    } catch (error) {
      this.stopHeartbeat();
      this.setStatus('disconnected');
      this.updateSnapshot({ lastError: error as Event });
      if (this.options.autoReconnect && !this.isIntentionalDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  public disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.pendingReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
  }

  public send(data: unknown): boolean {
    if (!this.ws || this.status !== 'connected') {
      if (this.options.queueOfflineMessages) {
        this.outboundQueue.push(data);
        this.setQueuedMessagesMetric();
        return true;
      }

      return false;
    }

    const serializer = this.options.serializer ?? defaultSerializer;
    this.ws.send(serializer(data) as never);
    return true;
  }

  public sendRaw(data: string | ArrayBuffer | Blob | ArrayBufferView): boolean {
    if (!this.ws || this.status !== 'connected') {
      if (this.options.queueOfflineMessages) {
        this.outboundQueue.push(data);
        this.setQueuedMessagesMetric();
        return true;
      }

      return false;
    }

    this.ws.send(data as never);
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
        this.ws.send(queued as never);
      } else {
        const serializer = this.options.serializer ?? defaultSerializer;
        this.ws.send(serializer(queued) as never);
      }
    }

    this.setQueuedMessagesMetric();
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

  private scheduleReconnect(): void {
    this.incrementMetric('reconnectAttempts');

    if (!this.canAttemptConnection()) {
      this.pendingReconnect = true;
      return;
    }

    const delay = this.applyReconnectJitter(this.reconnectDelay);
    this.incrementMetric('reconnectScheduled');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    this.reconnectDelay = Math.min(
      Math.round(this.reconnectDelay * this.options.reconnectBackoffMultiplier),
      this.options.maxReconnectInterval,
    );
  }

  private startHeartbeat(): void {
    if (this.options.heartbeatIntervalMs <= 0) {
      return;
    }

    this.stopHeartbeat();
    this.heartbeatIntervalTimer = setInterval(() => {
      if (!this.ws || this.status !== 'connected') {
        return;
      }

      const heartbeatMessage =
        typeof this.options.heartbeatMessage === 'function'
          ? this.options.heartbeatMessage()
          : this.options.heartbeatMessage ?? createDefaultHeartbeatMessage();

      this.incrementMetric('heartbeatSent');
      this.send(heartbeatMessage);
      this.clearHeartbeatTimeout();
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.incrementMetric('heartbeatTimeouts');
        this.ws?.close(4000, 'Heartbeat timeout');
      }, this.options.heartbeatTimeoutMs);
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalTimer) {
      clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }

    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private registerEnvironmentListeners(): void {
    if (isBrowserDocumentAvailable()) {
      document.addEventListener('visibilitychange', () => {
        this.updateConnectivityMetrics();
        if (!this.options.pauseWhenHidden) {
          return;
        }

        if (document.visibilityState === 'visible') {
          this.resumePendingReconnect();
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        this.updateConnectivityMetrics();
        this.resumePendingReconnect();
      });
      window.addEventListener('offline', () => {
        this.updateConnectivityMetrics();
      });
    }
  }

  private resumePendingReconnect(): void {
    if (!this.pendingReconnect || this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    if (!this.canAttemptConnection()) {
      return;
    }

    this.pendingReconnect = false;
    this.connect();
  }

  private canAttemptConnection(): boolean {
    if (this.options.pauseWhenHidden && isBrowserDocumentAvailable() && document.visibilityState === 'hidden') {
      return false;
    }

    if (this.options.pauseWhenOffline && isNavigatorAvailable() && typeof navigator.onLine === 'boolean' && navigator.onLine === false) {
      return false;
    }

    return true;
  }

  private shouldReconnect(event?: CloseEvent): boolean {
    if (!event) {
      return true;
    }

    if (this.options.shouldReconnect) {
      return this.options.shouldReconnect(event);
    }

    return ![1000, 1008].includes(event.code);
  }

  private applyReconnectJitter(delay: number): number {
    const jitterRatio = this.options.reconnectJitterRatio;
    if (jitterRatio <= 0) {
      return delay;
    }

    const spread = delay * jitterRatio;
    const jittered = delay - spread + Math.random() * spread * 2;
    return Math.max(0, Math.round(jittered));
  }

  private incrementMetric(metric: PulseIncrementMetricKey): void {
    const nextMetrics = {
      ...this.snapshot.metrics,
      [metric]: this.snapshot.metrics[metric] + 1,
    } as PulseClientMetrics;
    this.updateSnapshot({ metrics: nextMetrics });
  }

  private setQueuedMessagesMetric(): void {
    this.updateSnapshot({
      metrics: {
        ...this.snapshot.metrics,
        queuedMessages: this.outboundQueue.length,
      },
    });
  }

  private updateConnectivityMetrics(): void {
    const visibilityState = isBrowserDocumentAvailable() ? (document.visibilityState === 'hidden' ? 'hidden' : 'visible') : 'unknown';
    const online = isNavigatorAvailable() && typeof navigator.onLine === 'boolean' ? navigator.onLine : 'unknown';
    this.updateSnapshot({
      metrics: {
        ...this.snapshot.metrics,
        visibilityState,
        online,
      },
    });
  }

  private toDisconnectState(event: CloseEvent): PulseDisconnectState {
    return {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    };
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
