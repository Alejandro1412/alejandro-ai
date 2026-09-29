import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { AnalyticsService } from './analytics.service';

const rangeSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics.read')
  @ApiZodQuery(rangeSchema)
  overview(@Query(zv(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.analytics.overview(q.days);
  }

  @Get('timeseries')
  @RequirePermissions('analytics.read')
  @ApiZodQuery(rangeSchema)
  timeseries(@Query(zv(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.analytics.timeseries(q.days);
  }

  @Get('insights')
  @RequirePermissions('analytics.read')
  @ApiZodQuery(rangeSchema)
  insights(@Query(zv(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.analytics.insights(q.days);
  }

  @Get('recent-activity')
  @RequirePermissions('appointments.read')
  recent() {
    return this.analytics.recentActivity();
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
