import { applyDecorators, Injectable, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, ZodType } from 'zod';
import { ValidationError } from '../errors/app-error';

/** Validates + transforms input with a Zod schema; unknown keys are stripped by default. */
@Injectable()
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) {
      throw new ValidationError('Invalid request', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}

export const zv = <T extends ZodType>(schema: T) => new ZodPipe(schema);

function toOpenApi(schema: ZodType): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete json.$schema;
    return json;
  } catch {
    return { type: 'object' };
  }
}

/** Documents a Zod body schema in Swagger. */
export const ApiZodBody = (schema: ZodType) => applyDecorators(ApiBody({ schema: toOpenApi(schema) as never }));

/** Documents Zod query params in Swagger. */
export function ApiZodQuery(schema: z.ZodObject) {
  const decorators = Object.entries(schema.shape).map(([name, s]) =>
    ApiQuery({ name, required: !(s as ZodType).safeParse(undefined).success, schema: toOpenApi(s as ZodType) as never }),
  );
  return applyDecorators(...decorators);
}
