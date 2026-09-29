import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from '../../database/tenant';

/** Opens a per-request context store. Guards later bind tenant + principal into it. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
    res.setHeader('x-request-id', requestId);
    TenantContext.run({ ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 256), requestId }, () => next());
  }
}
