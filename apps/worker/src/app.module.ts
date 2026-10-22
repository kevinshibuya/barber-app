import { type DynamicModule, Module } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@barber/shared';
import { ClientPageModule } from './client-page/client-page.module';
import { HealthController } from './health.controller';

export interface AppOptions {
  // Service role, as the worker holds it.
  db: SupabaseClient<Database>;
}

// The bare module answers `/health` only; `forRoot` adds the routes that read
// the database.
@Module({
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(options: AppOptions): DynamicModule {
    return { module: AppModule, imports: [ClientPageModule.forRoot(options.db)] };
  }
}
