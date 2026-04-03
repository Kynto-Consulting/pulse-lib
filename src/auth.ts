import { JWTPayload, SignJWT } from 'jose';
import { PulseFeatureFlags, PulseMetadata } from './protocol';

export interface PulseTicketOptions {
  roomId: string;
  userId: string;
  secret: string;
  expiresIn?: string | number;
  features?: PulseFeatureFlags;
  metadata?: PulseMetadata;
  scopes?: string[];
}

export interface PulseTicketPayload extends JWTPayload {
  roomId: string;
  userId: string;
  features?: PulseFeatureFlags;
  metadata?: PulseMetadata;
  scopes?: string[];
}

export function buildPulseWebSocketUrl(baseUrl: string, token: string): string {
  const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanUrl}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Generates a signed JWT ticket to be used for authenticating WebSocket connections.
 */
export async function generatePulseTicket({ 
  roomId, 
  userId, 
  secret, 
  expiresIn = '1h',
  features,
  metadata,
  scopes,
}: PulseTicketOptions): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  const payload: PulseTicketPayload = { roomId, userId };

  if (features) {
    payload.features = features;
  }

  if (metadata) {
    payload.metadata = metadata;
  }

  if (scopes?.length) {
    payload.scopes = scopes;
  }

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
    
  return jwt;
}
