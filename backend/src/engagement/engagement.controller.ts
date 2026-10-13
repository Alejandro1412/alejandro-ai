import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { campaignSchema, EngagementService, waitlistSchema } from './engagement.service';

const waitlistQuery = z.object({ status: z.enum(['WAITING', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED']).optional() });
const reportQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const previewSchema = campaignSchema.pick({ kind: true, criteria: true });

@ApiTags('Engagement')
@ApiBearerAuth()
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  // Waitlist
  @Get('waitlist')
  @RequirePermissions('appointments.read')
  @ApiZodQuery(waitlistQuery)
  waitlist(@Query(zv(waitlistQuery)) q: z.infer<typeof waitlistQuery>) {
    return this.engagement.listWaitlist(q.status);
  }

  @Post('waitlist')
  @RequirePermissions('appointments.create')
  @ApiZodBody(waitlistSchema)
  addWaitlist(@Body(zv(waitlistSchema)) dto: z.infer<typeof waitlistSchema>) {
    return this.engagement.addToWaitlist(dto);
  }

  @Delete('waitlist/:id')
  @RequirePermissions('appointments.update')
  removeWaitlist(@Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.removeFromWaitlist(id);
  }

  // Reviews
  @Get('reviews')
  @RequirePermissions('analytics.read')
  reviews() {
    return this.engagement.reviewStats();
  }

  // Campaigns (marketing consent required per recipient)
  @Get('campaigns')
  @RequirePermissions('settings.manage')
  campaigns() {
    return this.engagement.listCampaigns();
  }

  @Post('campaigns/preview')
  @RequirePermissions('settings.manage')
  @ApiZodBody(previewSchema)
  preview(@Body(zv(previewSchema)) dto: z.infer<typeof previewSchema>) {
    return this.engagement.previewAudience(dto);
  }

  @Post('campaigns')
  @RequirePermissions('settings.manage')
  @ApiZodBody(campaignSchema)
  createCampaign(@Body(zv(campaignSchema)) dto: z.infer<typeof campaignSchema>) {
    return this.engagement.createCampaign(dto);
  }

  @Post('campaigns/:id/send')
  @RequirePermissions('settings.manage')
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.sendCampaign(id);
  }

  // Value report
  @Get('reports/value')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Monthly value delivered by the AI receptionist (conversations, bookings, hours saved, no-shows…)' })
  @ApiZodQuery(reportQuery)
  value(@Query(zv(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.engagement.valueReport(q.month);
  }
}
