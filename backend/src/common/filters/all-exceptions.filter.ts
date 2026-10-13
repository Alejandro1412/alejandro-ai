import { captureException } from '../observability';
import { TenantContext } from '../../database/tenant';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** Maps every thrown error to the standard response envelope. Internal details never leak in production. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toBody(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      const ctx = TenantContext.current();
      captureException(exception, { organizationId: ctx?.organizationId, requestId: ctx?.requestId });
    }
    res.status(status).json(body);
  }

  toBody(exception: unknown): { status: number; body: ErrorBody } {
    const make = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
      status,
      body: { success: false as const, error: { code, message, details } },
    });

    if (exception instanceof AppError) return make(exception.status, exception.code, exception.message, exception.details);
    if (exception instanceof ZodError) {
      return make(400, 'VALIDATION_ERROR', 'Invalid request', {
        issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (exception instanceof ThrottlerException) return make(429, 'RATE_LIMITED', 'Too many requests, please slow down');
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : ((response as { message?: string | string[] }).message ?? exception.message);
      return make(status, HttpStatus[status] ?? 'HTTP_ERROR', Array.isArray(message) ? message.join(', ') : message);
    }
    // Drizzle wraps driver errors (DrizzleQueryError) — the Postgres error is on `cause`.
    const wrapped = exception as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const pg = wrapped?.code ? wrapped : (wrapped?.cause ?? wrapped);
    if (pg?.code === '23P01' && pg.constraint === 'appointments_no_overlap') {
      return make(409, 'APPOINTMENT_CONFLICT', 'The selected time overlaps another appointment for this doctor');
    }
    if (pg?.code === '23505') return make(409, 'DUPLICATE', 'A record with these values already exists', { constraint: pg.constraint });
    return make(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
