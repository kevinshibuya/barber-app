// The client page's HTML: one document, inline CSS, no script. The previews
// strip swipes through CSS scroll snapping alone.
//
// The look traces to `docs/design/picker-references.md`, the picker's
// approved references, so the page reads as the app the barber showed: the
// strip is reference 3's horizontal tile strip; each tile is graft A's
// portrait tile with graft B's caption on a dark scrim; the chosen tile wears
// the spine's outline. Colours, radius and type are the app's theme tokens
// (`apps/mobile/global.css`).
import type { BeforePhoto, ClientPageView, Look, PreviewItem } from './client-page';
import { strings } from './strings';

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root {
  --background: hsl(0 0% 100%);
  --foreground: hsl(0 0% 3.9%);
  --muted-foreground: hsl(0 0% 45.1%);
  --muted: hsl(0 0% 96.1%);
  --primary: hsl(0 0% 9%);
  --radius: 0.625rem;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 480px; margin: 0 auto; padding: 24px 0 40px; }
header, section > h2, .note, .notfound { padding: 0 16px; }
h1 { margin: 0; font-size: 22px; font-weight: 700; }
h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
section { margin-top: 28px; }
img { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--muted); }
.photo { margin: 0 16px; aspect-ratio: 3 / 4; border-radius: var(--radius); overflow: hidden; position: relative; }
.caption {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 32px 12px 10px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.7), rgb(0 0 0 / 0));
  color: #fff;
}
.name { display: block; font-weight: 500; }
.status { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.note { margin: -4px 0 8px; font-size: 13px; color: var(--muted-foreground); }
.strip {
  list-style: none; margin: 0; padding: 3px 16px;
  display: flex; gap: 8px;
  overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 16px;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
}
.strip::-webkit-scrollbar { display: none; }
.strip li {
  flex: 0 0 72%; aspect-ratio: 3 / 4; scroll-snap-align: start;
  position: relative; border-radius: var(--radius); overflow: hidden;
}
.strip li[aria-current="true"] { outline: 3px solid var(--primary); outline-offset: -3px; }
.before { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 0 16px; margin: 0; list-style: none; }
.before li { position: relative; aspect-ratio: 3 / 4; border-radius: var(--radius); overflow: hidden; }
.before .caption { padding: 16px 6px 4px; font-size: 12px; }
.notfound { padding-top: 30vh; text-align: center; }
.notfound p { color: var(--muted-foreground); }
`;

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function image(url: string, alt: string, lazy = false): string {
  return `<img src="${escape(url)}" alt="${escape(alt)}"${lazy ? ' loading="lazy"' : ''}>`;
}

function lookSection(look: Look): string {
  return `<section class="look">
<h2>${escape(strings.look)}</h2>
<div class="photo">${image(look.url, look.name)}<span class="caption"><span class="name">${escape(look.name)}</span></span></div>
</section>`;
}

function afterSection(url: string): string {
  return `<section class="after">
<h2>${escape(strings.after)}</h2>
<div class="photo">${image(url, strings.after)}</div>
</section>`;
}

function previewItem(item: PreviewItem): string {
  const current = item.chosen ? ' aria-current="true"' : '';
  const status = item.chosen ? `<span class="status">${escape(strings.chosen)}</span>` : '';
  return `<li${current}>${image(item.url, item.name, true)}<span class="caption"><span class="name">${escape(item.name)}</span>${status}</span></li>`;
}

function previewsSection(items: PreviewItem[]): string {
  return `<section class="previews">
<h2>${escape(strings.previews)}</h2>
<p class="note">${escape(strings.swipe)}</p>
<ul class="strip">
${items.map(previewItem).join('\n')}
</ul>
</section>`;
}

function beforePhoto(photo: BeforePhoto): string {
  return `<li>${image(photo.url, `${strings.before} · ${photo.label}`)}<span class="caption">${escape(photo.label)}</span></li>`;
}

function beforeSection(photos: BeforePhoto[]): string {
  return `<section class="before-photos">
<h2>${escape(strings.before)}</h2>
<ul class="before">
${photos.map(beforePhoto).join('\n')}
</ul>
</section>`;
}

export function renderClientPage(view: ClientPageView): string {
  const sections = [
    `<header><h1>${escape(view.shopName)}</h1></header>`,
    view.look ? lookSection(view.look) : '',
    view.afterUrl ? afterSection(view.afterUrl) : '',
    view.previews.length > 0 ? previewsSection(view.previews) : '',
    view.before.length > 0 ? beforeSection(view.before) : '',
  ];
  return document(view.shopName, sections.filter(Boolean).join('\n'));
}

export function renderNotFound(): string {
  return document(
    strings.notFound.title,
    `<div class="notfound">
<h1>${escape(strings.notFound.title)}</h1>
<p>${escape(strings.notFound.message)}</p>
</div>`,
  );
}
