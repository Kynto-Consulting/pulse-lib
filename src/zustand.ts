import { createStore } from 'zustand/vanilla';
import { PulseClient, PulseClientOptions } from './client';
import { PulseClientSnapshot, defaultPulseSnapshot } from './protocol';

export interface PulseState<TMessage = unknown> extends PulseClientSnapshot<TMessage> {
  client: PulseClient<TMessage> | null;
  connect: (baseUrl: string, token: string, options?: PulseClientOptions<TMessage>) => void;
  disconnect: () => void;
  send: (data: unknown) => boolean;
  sendRaw: (data: string | ArrayBuffer | Blob | ArrayBufferView) => boolean;
}

export const createPulseStore = <TMessage = unknown>() => {
  let unsubscribeClient: (() => void) | null = null;

  return createStore<PulseState<TMessage>>((set, get) => ({
    ...(defaultPulseSnapshot() as PulseClientSnapshot<TMessage>),
    client: null,

    connect: (baseUrl, token, options) => {
      unsubscribeClient?.();
      const currentClient = get().client;
      currentClient?.disconnect();

      const client = new PulseClient<TMessage>(baseUrl, token, options);
      unsubscribeClient = client.subscribe(() => {
        set({
          ...(client.getSnapshot() as PulseClientSnapshot<TMessage>),
          client,
        });
      });

      set({
        ...(client.getSnapshot() as PulseClientSnapshot<TMessage>),
        client,
      });
      client.connect();
    },

    disconnect: () => {
      unsubscribeClient?.();
      unsubscribeClient = null;
      const client = get().client;
      client?.disconnect();
      set({
        ...(defaultPulseSnapshot() as PulseClientSnapshot<TMessage>),
        client: null,
      });
    },

    send: (data) => {
      return get().client?.send(data) ?? false;
    },

    sendRaw: (data) => {
      return get().client?.sendRaw(data) ?? false;
    },
  }));
};
