import { Controller, type DynamicModule, Get, Inject, Module, Param, Res } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Response } from 'express';
import type { Database } from '@barber/shared';
import { ClientPage, type ClientPageView } from './client-page';
import { renderClientPage, renderNotFound } from './render';

// Where the page's images come from: the storage origin its signed URLs name.
function imageOrigins(view: ClientPageView | null): string[] {
  if (!view) return [];
  const urls = [
    ...view.before.map((p) => p.url),
    ...view.previews.map((p) => p.url),
    ...(view.look ? [view.look.url] : []),
    ...(view.afterUrl ? [view.afterUrl] : []),
  ];
  return [...new Set(urls.map((url) => new URL(url).origin))];
}

// No script runs, nothing loads but the images, and the page is never framed.
function contentSecurityPolicy(view: ClientPageView | null): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${[...imageOrigins(view), 'data:'].join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// `/v/<share token>`, as `clientPagePath` builds it.
@Controller('v')
export class ClientPageController {
  constructor(@Inject(ClientPage) private readonly page: ClientPage) {}

  @Get(':token')
  async show(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const view = await this.page.load(token);
    // The signed URLs die within the hour, so a reload signs them anew; the
    // token sits in the URL, so no Referer carries it to the image host.
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': contentSecurityPolicy(view),
      'X-Content-Type-Options': 'nosniff',
    });
    if (!view) {
      res.status(404).type('html').send(renderNotFound());
      return;
    }
    res.status(200).type('html').send(renderClientPage(view));
  }
}

@Module({})
export class ClientPageModule {
  // Service role: the page reads any shop's visit by its token.
  static forRoot(db: SupabaseClient<Database>): DynamicModule {
    return {
      module: ClientPageModule,
      controllers: [ClientPageController],
      providers: [{ provide: ClientPage, useValue: new ClientPage(db) }],
    };
  }
}
