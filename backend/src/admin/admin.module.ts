import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { AdminService, adminPlanSchema, extendTrialSchema, reasonSchema } from './admin.service';

const searchSchema = z.object({ search: z.string().trim().max(100).optional() });

@ApiTags('Platform admin')
@ApiBearerAuth()
@RequirePermissions('platform.admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('tenants')
  tenants(@Query(zv(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.admin.tenants(q.search);
  }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.tenant(id);
  }

  @Post('tenants/:id/plan')
  @ApiZodBody(adminPlanSchema)
  plan(@Param('id', ParseUUIDPipe) id: string, @Body(zv(adminPlanSchema)) dto: z.infer<typeof adminPlanSchema>) {
    return this.admin.changePlan(id, dto);
  }

  @Post('tenants/:id/extend-trial')
  @ApiZodBody(extendTrialSchema)
  extend(@Param('id', ParseUUIDPipe) id: string, @Body(zv(extendTrialSchema)) dto: z.infer<typeof extendTrialSchema>) {
    return this.admin.extendTrial(id, dto.days);
  }

  @Post('tenants/:id/suspend')
  @ApiZodBody(reasonSchema)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body(zv(reasonSchema)) dto: z.infer<typeof reasonSchema>) {
    return this.admin.suspend(id, dto.reason);
  }

  @Post('tenants/:id/reactivate')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reactivate(id);
  }

  @Post('tenants/:id/impersonate')
  @ApiZodBody(reasonSchema)
  impersonate(@Param('id', ParseUUIDPipe) id: string, @Body(zv(reasonSchema)) dto: z.infer<typeof reasonSchema>) {
    return this.admin.impersonate(id, dto.reason);
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
