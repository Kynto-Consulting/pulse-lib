import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PulseClient, PulseClientOptions } from './client';
import { PulseClientSnapshot, defaultPulseSnapshot } from './protocol';

export function usePulse<TMessage = unknown>(
  baseUrl: string,
  token: string,
  options?: PulseClientOptions<TMessage>,
) {
  const client = useMemo(() => {
    if (!baseUrl || !token) {
      return null;
    }

    return new PulseClient<TMessage>(baseUrl, token, options);
  }, [baseUrl, token, options]);

  const clientRef = useRef<PulseClient<TMessage> | null>(null);
  clientRef.current = client;

  useEffect(() => {
    if (!client) {
      return;
    }

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [client]);

  const subscribe = useMemo(() => {
    return (listener: () => void) => {
      if (!clientRef.current) {
        return () => {};
      }

      return clientRef.current.subscribe(listener);
    };
  }, []);

  const getSnapshot = useMemo(() => {
    return (): PulseClientSnapshot<TMessage> => clientRef.current?.getSnapshot() ?? (defaultPulseSnapshot() as PulseClientSnapshot<TMessage>);
  }, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...snapshot,
    client,
    connect: () => client?.connect(),
    disconnect: () => client?.disconnect(),
    send: (data: unknown) => client?.send(data) ?? false,
    sendRaw: (data: string | ArrayBuffer | Blob | ArrayBufferView) => client?.sendRaw(data) ?? false,
  };
}
