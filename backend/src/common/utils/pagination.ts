import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: { page: number; pageSize: number; total: number; totalPages: number },
  ) {}

  static of<T>(items: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> {
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
  }
}

export const offsetOf = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Escapes LIKE wildcards in user input. */
export const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
