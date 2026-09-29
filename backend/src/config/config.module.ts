import { Global, Module } from '@nestjs/common';
import { env, Env } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): Env => env() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
