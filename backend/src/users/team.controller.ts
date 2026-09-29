import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { changeRoleSchema, inviteSchema, TeamService } from './team.service';

@ApiTags('Team')
@ApiBearerAuth()
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions('team.manage')
  list() {
    return this.team.list();
  }

  @Get('roles')
  @RequirePermissions('team.manage')
  roles() {
    return this.team.roles();
  }

  @Post()
  @RequirePermissions('team.manage')
  @ApiZodBody(inviteSchema)
  invite(@Body(zv(inviteSchema)) dto: z.infer<typeof inviteSchema>) {
    return this.team.invite(dto);
  }

  @Patch(':membershipId')
  @RequirePermissions('team.manage')
  @ApiZodBody(changeRoleSchema)
  changeRole(@Param('membershipId', ParseUUIDPipe) id: string, @Body(zv(changeRoleSchema)) dto: z.infer<typeof changeRoleSchema>) {
    return this.team.changeRole(id, dto.role);
  }

  @Delete(':membershipId')
  @RequirePermissions('team.manage')
  remove(@Param('membershipId', ParseUUIDPipe) id: string) {
    return this.team.remove(id);
  }
}
