import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { refreshTokens } from '../database/schema';
import { hmacSha256Hex, randomToken } from '../common/utils/crypto';
import { UnauthorizedError } from '../common/errors/app-error';
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Short-lived JWT access tokens + opaque rotating refresh tokens.
 * Refresh tokens are stored as HMAC hashes (peppered with JWT_REFRESH_SECRET) and rotated
 * on every use; presenting an already-rotated token revokes the entire token family.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  private hash(token: string) {
    return hmacSha256Hex(env().JWT_REFRESH_SECRET, token);
  }

  async issue(payload: AccessTokenPayload, meta: { ip?: string; userAgent?: string; familyId?: string } = {}): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(payload, { secret: env().JWT_SECRET, expiresIn: env().JWT_ACCESS_TTL as never });
    const refreshToken = randomToken(48);
    await this.db.insert(refreshTokens).values({
      userId: payload.sub,
      organizationId: payload.org,
      tokenHash: this.hash(refreshToken),
      familyId: meta.familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const decoded = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, refreshToken, expiresIn: decoded.exp - decoded.iat };
  }

  /** Validates + consumes a refresh token. Returns the stored row so the caller can re-issue. */
  async consume(refreshToken: string): Promise<{ userId: string; organizationId: string | null; familyId: string }> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, this.hash(refreshToken)));
    if (!row) throw new UnauthorizedError('REFRESH_INVALID', 'Session expired');
    if (row.revokedAt) {
      // Reuse of a rotated token → likely theft. Kill the whole family.
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedError('REFRESH_REUSED', 'Session revoked for security reasons');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedError('REFRESH_EXPIRED', 'Session expired');
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return { userId: row.userId, organizationId: row.organizationId, familyId: row.familyId };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, this.hash(refreshToken)));
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
