import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { paginationSchema } from '../common/utils/pagination';
import { AuditService } from './audit.service';

const auditQuery = paginationSchema.extend({
  action: z.string().max(64).optional(),
  actorType: z.enum(['USER', 'AI_AGENT', 'SYSTEM', 'WEBHOOK', 'PATIENT']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiZodQuery(auditQuery)
  list(@Query(zv(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.audit.list(q);
  }
}
