# @arubiku/pulse-lib

![npm version](https://img.shields.io/npm/v/%40arubiku%2Fpulse-lib)
![npm downloads](https://img.shields.io/npm/dm/%40arubiku%2Fpulse-lib)
![runtime](https://img.shields.io/badge/runtime-browser%20%7C%20node%20%7C%20workers-0f172a)

Typed auth helpers, a WebSocket client, framework adapters and a small state layer for apps that connect to Pulse rooms running on Cloudflare Workers.

Use this package when you want to:

- generate short-lived JWT tickets from your backend
- connect clients to a Pulse Worker from vanilla JS
- use React through `usePulse`
- manage a shared connection with Zustand
- build your own adapter on top of the framework-agnostic state store

## Install

```bash
npm install @arubiku/pulse-lib
```

Optional peers depending on your stack:

```bash
npm install react zustand
```

## Entry points

- `@arubiku/pulse-lib`
  Auth helpers, base client and shared exports.

- `@arubiku/pulse-lib/react`
  React hook `usePulse`.

- `@arubiku/pulse-lib/zustand`
  Zustand vanilla store factory.

- `@arubiku/pulse-lib/protocol`
  Shared protocol types and snapshot shape.

- `@arubiku/pulse-lib/store`
  Framework-agnostic subscribable state store.

## Quick start

### 1. Generate a ticket on your backend

```ts
import { generatePulseTicket } from '@arubiku/pulse-lib';

const token = await generatePulseTicket({
  roomId: 'board-1',
  userId: 'user-42',
  secret: process.env.PULSE_SECRET!,
  expiresIn: '15m',
  features: {
    presence: true,
    presenceSync: true,
    selfEcho: false,
  },
  metadata: {
    name: 'Jane',
    role: 'editor',
  },
});
```

### 2. Connect from the frontend

```ts
import { PulseClient } from '@arubiku/pulse-lib';

const client = new PulseClient('https://your-worker.workers.dev', token, {
  reconnectInterval: 1500,
});

client.on('message', (message) => {
  console.log(message);
});

client.connect();
```

## Why Pulse instead of Ably?

If you already like Ably, the point of Pulse is not that Ably is bad. The point is control and economics.

Why teams may prefer Pulse:

- your realtime layer runs in your own Cloudflare account
- your auth model stays fully under your control through JWT tickets
- your transport lives closer to users through Cloudflare's edge network
- you can add your own rules, scopes, validation and room behavior without waiting for vendor features
- your frontend and worker can stay in the same Cloudflare-centric architecture

Practical difference in the free tier model:

- managed realtime vendors like Ably usually gate free usage with explicit connection and message limits that can change over time by plan
- with Pulse on Cloudflare Workers, the important limit is the Worker request quota and each new WebSocket handshake counts as a request
- that means you are not paying or budgeting the same way as a per-message SaaS transport layer

For example, on Cloudflare Workers Free, the commonly relevant quota is on the order of `100k` requests per day, not per month. In a WebSocket setup that means up to `100k` new connection handshakes per day before you hit that specific quota. Existing sockets and message flow are a different cost model than a hosted Pub/Sub product. Always verify current Cloudflare and Ably pricing pages before quoting exact limits because plans change.

Latency angle:

- if your app already serves traffic through Cloudflare, Pulse can reduce extra network hops because the socket entrypoint is already on the edge
- that usually gives you a better path for browser-to-edge communication than sending traffic first to a separate vendor platform and then back into your own stack

Choose Pulse when you want:

- a custom realtime layer inside your own infra
- lower vendor dependency
- Cloudflare-native deployment
- control over auth and room semantics

Choose Ably when you want:

- a fully managed realtime product
- built-in vendor features you do not want to maintain yourself
- less infrastructure ownership in exchange for platform limits and pricing

## API overview

### `generatePulseTicket`

Creates a signed JWT that `pulse-worker` can verify.

Supported options:

- `roomId`
- `userId`
- `secret`
- `expiresIn`
- `features`
- `metadata`
- `scopes`

### `buildPulseWebSocketUrl`

Builds the final `wss://.../ws?token=...` URL from a base worker URL and a token.

### `PulseClient`

Low-level client with:

- auto reconnect
- reconnect backoff
- offline queue
- parser and serializer hooks
- event listeners
- subscribable snapshots
- presence tracking

### `usePulse`

React adapter that wraps `PulseClient` and exposes:

- connection `status`
- `presenceMembers`
- `lastMessage`
- `lastPresence`
- `lastSystem`
- `lastError`
- `send`
- `sendRaw`

### `createPulseStore`

Zustand adapter for a shared app-level connection.

### `createPulseStateStore`

Framework-neutral state layer useful for Astro islands, custom state managers or your own hooks.

## Usage by stack

### Vanilla JS

```ts
import { PulseClient } from '@arubiku/pulse-lib';

const client = new PulseClient('https://your-worker.workers.dev', token);
client.connect();
```

### React

```tsx
import { usePulse } from '@arubiku/pulse-lib/react';

export function Board({ token }: { token: string }) {
  const { status, presenceMembers, send } = usePulse('https://your-worker.workers.dev', token);

  return (
    <button onClick={() => send({ type: 'update', entity: 'card', id: '1' })}>
      {status} / {presenceMembers.length}
    </button>
  );
}
```

### Zustand

```ts
import { createPulseStore } from '@arubiku/pulse-lib/zustand';

export const pulseStore = createPulseStore();
pulseStore.getState().connect('https://your-worker.workers.dev', token);
```

### Custom adapter

```ts
import { createPulseStateStore } from '@arubiku/pulse-lib/store';

const pulse = createPulseStateStore('https://your-worker.workers.dev', token);
pulse.connect();
```

## Event model

The client automatically recognizes three message groups coming from the worker:

- `system`
- `presence`
- user messages

Presence snapshots and incremental events update the internal `presenceMembers` list when `presenceTracking` is enabled.

## Local development

If you are working inside this repo:

```bash
npm install
npm run build
```

## Release flow

This package ships with a simple npm release flow similar to the CLI workflow used elsewhere in your workspace.

Available scripts:

- `npm run build`
- `npm run typecheck`
- `npm run npm:auth:check`
- `npm run deploy:publish`
- `npm run release:auto`
- `npm run bump:patch:deploy:publish`
- `npm run bump:minor:deploy:publish`
- `npm run bump:major:deploy:publish`

## Related repos

- `pulse-worker`: Cloudflare Worker and Durable Object broker
- `pulse-samples`: examples for native JS, server scripts, Astro, React and Zustand

## Troubleshooting

### `Invalid ticket`

Make sure the backend signs the JWT with the same `PULSE_SECRET` configured in the worker.

### No messages arrive

Check that both clients are connecting to the same `roomId` and the same deployed worker URL.

### Presence is empty

Enable `features.presenceSync` in the token if you want an initial snapshot on connect.

### My sender does not receive its own message

That is expected by default. Set `features.selfEcho = true` in the token if you want echo behavior.

### Imports fail in React or Zustand

Install the corresponding peer dependencies in the consuming project:

```bash
npm install react zustand
```

## Notes

This package intentionally does not own your business data. It only handles ticket generation, connection state and message transport helpers around the worker protocol.
