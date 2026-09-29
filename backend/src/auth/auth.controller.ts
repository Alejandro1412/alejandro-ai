import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import {
  changePasswordSchema,
  loginSchema,
  patientRegisterSchema,
  registerSchema,
  updateProfileSchema,
  type LoginDto,
  type PatientRegisterDto,
  type RegisterDto,
} from './auth.schemas';
import { AuthService } from './auth.service';
import type { IssuedTokens } from './token.service';
import type { z } from 'zod';

export const REFRESH_COOKIE = 'aai_rt';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env().NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env().JWT_REFRESH_TTL_DAYS * 86_400_000,
});

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Refresh token → httpOnly cookie; only the short-lived access token is returned in the body. */
  private respond(res: Response, t: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, t.refreshToken, cookieOptions());
    return { accessToken: t.accessToken, expiresIn: t.expiresIn };
  }

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 256) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email + password login' })
  @ApiZodBody(loginSchema)
  async login(@Body(zv(loginSchema)) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto, this.meta(req)));
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account, organization and clinic (starts a trial)' })
  @ApiZodBody(registerSchema)
  async register(@Body(zv(registerSchema)) dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto, this.meta(req)));
  }

  @Public()
  @Post('patient/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Patient portal self-registration' })
  @ApiZodBody(patientRegisterSchema)
  async registerPatient(
    @Body(zv(patientRegisterSchema)) dto: PatientRegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.registerPatient(dto, this.meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh cookie and get a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiZodBody(updateProfileSchema)
  updateMe(@CurrentUser() user: AuthUser, @Body(zv(updateProfileSchema)) dto: z.infer<typeof updateProfileSchema>) {
    return this.auth.updateProfile(user.userId, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiZodBody(changePasswordSchema)
  async changePassword(@CurrentUser() user: AuthUser, @Body(zv(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
