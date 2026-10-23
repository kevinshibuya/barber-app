// One provider's renders on one image: a header row naming the styles, then a
// row per input photo, its photo first and its renders across. A cell with no
// render says why instead.
import sharp from 'sharp';
import type { BakeoffOutcome } from './bakeoff';

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 256;
export const HEADER_HEIGHT = 40;

const BACKGROUND = '#111111';

export interface ContactSheetSource {
  title: string;
  inputs: { name: string; image: Buffer }[];
  styles: { slug: string; name: string }[];
  render: (input: string, style: string) => Buffer | undefined;
  outcome: (input: string, style: string) => BakeoffOutcome;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function label(text: string, width: number, height: number, background: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="${background}"/>` +
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#ffffff">${escapeXml(text)}</text></svg>`,
  );
}

function fitCell(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize(CELL_WIDTH, CELL_HEIGHT, { fit: 'contain', background: BACKGROUND })
    .png()
    .toBuffer();
}

export async function contactSheet(source: ContactSheetSource): Promise<Buffer> {
  const { inputs, styles } = source;
  const cells: sharp.OverlayOptions[] = [
    { input: label(source.title, CELL_WIDTH, HEADER_HEIGHT, '#333333'), left: 0, top: 0 },
    ...styles.map((style, col) => ({
      input: label(style.name, CELL_WIDTH, HEADER_HEIGHT, '#222222'),
      left: (col + 1) * CELL_WIDTH,
      top: 0,
    })),
  ];

  for (const [row, input] of inputs.entries()) {
    const top = HEADER_HEIGHT + row * CELL_HEIGHT;
    cells.push({ input: await fitCell(input.image), left: 0, top });
    for (const [col, style] of styles.entries()) {
      const render = source.render(input.name, style.slug);
      const cell = render
        ? await fitCell(render)
        : label(source.outcome(input.name, style.slug), CELL_WIDTH, CELL_HEIGHT, '#5a1e1e');
      cells.push({ input: cell, left: (col + 1) * CELL_WIDTH, top });
    }
  }

  return sharp({
    create: {
      width: (styles.length + 1) * CELL_WIDTH,
      height: HEADER_HEIGHT + inputs.length * CELL_HEIGHT,
      channels: 3,
      background: BACKGROUND,
    },
  })
    .composite(cells)
    .jpeg({ quality: 85 })
    .toBuffer();
}
