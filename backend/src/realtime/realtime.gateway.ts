import { Logger, OnModuleDestroy } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard';

export type RealtimeEvent =
  | 'appointment.changed'
  | 'conversation.updated'
  | 'message.created'
  | 'message.feedback'
  | 'handoff.created'
  | 'handoff.updated'
  | 'notification.created'
  | 'knowledge.updated'
  | 'agent.step'
  | 'waitlist.changed'
  | 'campaign.sent';

/**
 * Socket.IO gateway. Clients authenticate with their access token on the handshake and
 * are joined only to their own clinic room (tenant isolation also applies to realtime).
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: env().CORS_ORIGINS.split(','), credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;
  private redis: Redis[] = [];

  constructor(private readonly jwt: JwtService) {}

  /** With Redis configured, events fan out across all API instances (horizontal scaling). */
  afterInit(server: Server): void {
    const url = env().REDIS_URL;
    if (!url || env().NODE_ENV === 'test') return;
    try {
      const pub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
      const sub = pub.duplicate();
      pub.on('error', (e) => this.logger.warn(`Socket.IO Redis adapter: ${e.message}`));
      sub.on('error', (e) => this.logger.warn(`Socket.IO Redis adapter: ${e.message}`));
      this.redis = [pub, sub];
      server.adapter(createAdapter(pub, sub));
      this.logger.log('Socket.IO Redis adapter enabled');
    } catch (err) {
      this.logger.warn(`Socket.IO Redis adapter not enabled: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.redis.map((r) => r.quit().catch(() => undefined)));
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? '';
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: env().JWT_SECRET });
      await client.join(this.room(payload.org, payload.clinic));
      if (payload.role === 'PATIENT' && payload.patientId) await client.join(`patient:${payload.patientId}`);
      if (payload.role !== 'PATIENT') await client.join(`staff:${payload.org}:${payload.clinic}`);
    } catch {
      client.disconnect(true);
    }
  }

  room(orgId: string, clinicId: string): string {
    return `clinic:${orgId}:${clinicId}`;
  }

  /** Emits to staff of a clinic. */
  toClinic(orgId: string, clinicId: string, event: RealtimeEvent, payload: unknown): void {
    this.server?.to(`staff:${orgId}:${clinicId}`).emit(event, payload);
  }

  toPatient(patientId: string, event: RealtimeEvent, payload: unknown): void {
    this.server?.to(`patient:${patientId}`).emit(event, payload);
  }

  logConnections(): void {
    this.logger.debug(`Connected sockets: ${this.server?.engine.clientsCount ?? 0}`);
  }
}
