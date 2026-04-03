import { PulseClient, PulseClientOptions } from './client';
import { PulseClientSnapshot, defaultPulseSnapshot } from './protocol';

export interface PulseStateStore<TMessage = unknown> {
  client: PulseClient<TMessage>;
  connect: () => void;
  disconnect: () => void;
  send: (data: unknown) => boolean;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PulseClientSnapshot<TMessage>;
}

export function createPulseStateStore<TMessage = unknown>(
  baseUrl: string,
  token: string,
  options?: PulseClientOptions<TMessage>,
): PulseStateStore<TMessage> {
  const client = new PulseClient<TMessage>(baseUrl, token, options);

  return {
    client,
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    send: (data) => client.send(data),
    subscribe: (listener) => client.subscribe(listener),
    getSnapshot: () => client.getSnapshot() ?? defaultPulseSnapshot(),
  };
}
