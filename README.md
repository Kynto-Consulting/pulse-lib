# @arubiku/pulse-lib

Typed client and auth helpers for Pulse WebSocket rooms running on Cloudflare Workers and Durable Objects.

## Install

```bash
npm install @arubiku/pulse-lib
```

## Entry points

- `@arubiku/pulse-lib`: auth helpers, base client and shared exports
- `@arubiku/pulse-lib/react`: React hook `usePulse`
- `@arubiku/pulse-lib/zustand`: Zustand vanilla store factory
- `@arubiku/pulse-lib/protocol`: shared protocol types
- `@arubiku/pulse-lib/store`: framework-agnostic subscribable store

## Example

```ts
import { generatePulseTicket, PulseClient } from '@arubiku/pulse-lib';

const token = await generatePulseTicket({
  roomId: 'board-1',
  userId: 'u-1',
  secret: process.env.PULSE_SECRET!,
});

const client = new PulseClient('http://127.0.0.1:8787', token);
client.connect();
```
