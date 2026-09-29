import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Paginated } from '../utils/pagination';

export const RAW_RESPONSE = 'raw_response';

/** Wraps successful responses: { success: true, data, meta? } */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = Reflect.getMetadata(RAW_RESPONSE, context.getHandler()) as boolean | undefined;
    if (raw) return next.handle();
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof Paginated) return { success: true, data: value.items, meta: value.meta };
        return { success: true, data: value ?? null };
      }),
    );
  }
}
