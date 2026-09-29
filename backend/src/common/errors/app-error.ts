/**
 * Typed application errors. The global exception filter maps them to the standard envelope:
 * { success: false, error: { code, message, details } }
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details: Record<string, unknown> = {}) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(code = 'UNAUTHORIZED', message = 'Authentication required') {
    super(401, code, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(code = 'FORBIDDEN', message = 'You do not have permission to perform this action', details = {}) {
    super(403, code, message, details);
  }
}
export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(404, 'NOT_FOUND', `${entity} not found`, id ? { entity, id } : { entity });
  }
}
export class ConflictError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(409, code, message, details);
  }
}
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(422, code, message, details);
  }
}
export class PlanLimitError extends AppError {
  constructor(limit: string, details: Record<string, unknown> = {}) {
    super(402, 'PLAN_LIMIT_REACHED', `Your current plan does not allow more ${limit}`, { limit, ...details });
  }
}
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details: Record<string, unknown> = {}) {
    super(502, 'EXTERNAL_SERVICE_ERROR', `${service}: ${message}`, { service, ...details });
  }
}
export class TimeoutError extends AppError {
  constructor(operation: string, ms: number) {
    super(504, 'TIMEOUT', `${operation} timed out after ${ms}ms`, { operation, ms });
  }
}
