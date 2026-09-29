import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, RawResponse, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { CalendarsService } from './calendars.service';

const connectSchema = z.object({ provider: z.enum(['MOCK', 'INTERNAL']), doctorId: z.string().uuid().nullable().default(null) });
const googleSchema = z.object({ doctorId: z.string().uuid().nullable().default(null) });

@ApiTags('Calendars')
@Controller('calendars')
export class CalendarsController {
  constructor(private readonly calendars: CalendarsService) {}

  @Get('integrations')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  list() {
    return this.calendars.list();
  }

  @Post('connect')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  @ApiZodBody(connectSchema)
  connect(@Body(zv(connectSchema)) dto: z.infer<typeof connectSchema>) {
    return this.calendars.connectLocal(dto.provider, dto.doctorId);
  }

  @Post('google/auth-url')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  @ApiZodBody(googleSchema)
  googleAuthUrl(@Body(zv(googleSchema)) dto: z.infer<typeof googleSchema>) {
    return this.calendars.googleAuthUrl(dto.doctorId);
  }

  @Public()
  @RawResponse()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const redirect = await this.calendars.googleCallback(code, state);
    res.redirect(302, redirect);
  }

  @Delete('integrations/:id')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.calendars.disconnect(id);
  }
}
