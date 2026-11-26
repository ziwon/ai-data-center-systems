// Draws the 1200x630 Open Graph cards in the restack language: the charcoal
// canvas, the hero's inset panel with the indigo signature glow, the site
// wordmark, and a mono eyebrow over the page title.
//
// astro-og-canvas draws only a single-colour title and description, so the
// card is drawn on the CanvasKit build that astro-og-canvas already ships.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// The renderer cannot read CSS custom properties. These are the dark-face
// values of .site/src/styles/restack/color.css, named after their roles.
export const ogPalette = {
  canvas: '#0c0d12', // --restack-color-canvas (gray-900)
  surfaceSunken: '#101218', // --restack-color-surface-sunken (gray-850)
  border: '#303545', // --restack-color-border (gray-650)
  borderSubtle: '#252935', // --restack-color-border-subtle (gray-700)
  textStrong: '#f3f4f8', // --restack-color-text-strong (gray-075)
  textSecondary: '#b5bbca', // --restack-color-text-secondary (gray-300)
  textMuted: '#9fa6b8', // --restack-color-text-muted (gray-350)
  primaryStrong: '#b2e879', // --restack-color-primary-strong (lime-300)
  signature: '#485cf9', // --restack-color-signature (indigo-500)
  signatureStrong: '#8595fa', // --restack-color-signature-strong (indigo-300)
} as const;

export const ogSiteTitle = 'AI Data Center Systems';

const WIDTH = 1200;
const HEIGHT = 630;
// The inset panel, as the home hero sits on the page.
const PANEL = { x: 24, y: 24, w: WIDTH - 48, h: HEIGHT - 48, radius: 9 };
const PAD_X = 80;
const CONTENT_W = WIDTH - PAD_X * 2;
const BOTTOM = HEIGHT - 76;

const SANS = ['DM Sans', 'DM Sans Ext', 'Pretendard'];
const MONO = ['IBM Plex Mono', 'Pretendard'];

const fontFiles = [
  ['DM Sans', 'src/styles/restack/fonts/DMSans-Latin-wght.woff2'],
  ['DM Sans Ext', 'src/styles/restack/fonts/DMSans-LatinExt-wght.woff2'],
  ['IBM Plex Mono', 'src/styles/restack/fonts/IBMPlexMono-Latin-500.woff2'],
  ['Pretendard', 'node_modules/pretendard/dist/public/static/Pretendard-Regular.otf'],
  ['Pretendard', 'node_modules/pretendard/dist/public/static/Pretendard-SemiBold.otf'],
];
const markFile = 'src/styles/restack/assets/restack-mark.png';

type Card = {
  title: string;
  description?: string;
  eyebrow?: string;
  // The site card sets the wordmark itself as the headline.
  site?: boolean;
};

let setupPromise;

function setup() {
  setupPromise ||= (async () => {
    // Resolve CanvasKit from astro-og-canvas, so the card uses the exact build
    // that package depends on instead of an undeclared copy.
    const require = createRequire(import.meta.url);
    const fromOgCanvas = createRequire(require.resolve('astro-og-canvas'));
    const init = fromOgCanvas('canvaskit-wasm/full');
    const CK = await init({ locateFile: (file) => fromOgCanvas.resolve(`canvaskit-wasm/bin/full/${file}`) });

    const root = process.cwd();
    const provider = CK.TypefaceFontProvider.Make();
    for (const [family, file] of fontFiles) {
      provider.registerFont(toArrayBuffer(await readFile(path.join(root, file))), family);
    }
    const fonts = CK.FontCollection.Make();
    fonts.setDefaultFontManager(provider);
    const mark = CK.MakeImageFromEncoded(toArrayBuffer(await readFile(path.join(root, markFile))));
    return { CK, fonts, mark };
  })();
  return setupPromise;
}

export async function renderOgCard(card: Card) {
  const { CK, fonts, mark } = await setup();
  const color = (hex, alpha = 1) => {
    const n = parseInt(hex.slice(1), 16);
    return CK.Color((n >> 16) & 255, (n >> 8) & 255, n & 255, alpha);
  };
  const trash = [];
  const keep = (obj) => (trash.push(obj), obj);

  // DM Sans is a variable face: the weight is set on its wght axis, and the
  // static Pretendard faces are picked by fontStyle.
  const style = ({ size, weight = 400, ink, families = SANS, tracking = 0, leading = 1.2 }) => ({
    color: color(ink),
    fontFamilies: families,
    fontSize: size,
    fontStyle: { weight: { value: weight } },
    fontVariations: [{ axis: 'wght', value: weight }],
    letterSpacing: tracking * size,
    heightMultiplier: leading,
    halfLeading: true,
  });
  const paragraph = (runs, width = 100000) => {
    const builder = keep(
      CK.ParagraphBuilder.MakeFromFontCollection(new CK.ParagraphStyle({ textStyle: runs[0][1] }), fonts),
    );
    for (const [text, runStyle] of runs) {
      builder.pushStyle(new CK.TextStyle(runStyle));
      builder.addText(text);
      builder.pop();
    }
    const para = keep(builder.build());
    para.layout(width);
    return para;
  };
  const measure = (text, textStyle) => paragraph([[text, textStyle]]).getMaxIntrinsicWidth();

  // Korean breaks between words, never inside one (CSS word-break: keep-all),
  // which the paragraph's own line breaker does not do.
  const wrap = (text, textStyle, maxLines) => {
    const words = text.replace(/\s+([—–])\s+/g, ' $1 ').trim().split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next, textStyle) <= CONTENT_W) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = `${kept[maxLines - 1]} ${lines[maxLines]}`;
    while (last.includes(' ') && measure(`${last}…`, textStyle) > CONTENT_W) last = last.replace(/\s+\S+$/, '');
    kept[maxLines - 1] = `${last.replace(/[\s,.;:·—–-]+$/, '')}…`;
    return kept;
  };

  const surface = CK.MakeSurface(WIDTH, HEIGHT);
  const canvas = surface.getCanvas();
  const fill = (ink, alpha = 1) => {
    const paint = keep(new CK.Paint());
    paint.setAntiAlias(true);
    paint.setColor(color(ink, alpha));
    return paint;
  };

  // Ground and panel.
  canvas.drawRect(CK.XYWHRect(0, 0, WIDTH, HEIGHT), fill(ogPalette.canvas));
  const panel = CK.RRectXY(CK.XYWHRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h), PANEL.radius, PANEL.radius);
  canvas.drawRRect(panel, fill(ogPalette.surfaceSunken));

  // --restack-gradient-signature, painted bottom layer first as CSS stacks it.
  canvas.save();
  canvas.clipRRect(panel, CK.ClipOp.Intersect, true);
  const glows = [
    [96, 100, 48, 70, ogPalette.signature, 0.3, 0.72],
    [94, 104, 22, 30, ogPalette.signatureStrong, 0.34, 1],
    [10, 60, 55, 85, ogPalette.signature, 0.38, 0.72],
    [14, 58, 18, 26, ogPalette.signatureStrong, 0.3, 1],
  ];
  for (const [cx, cy, rx, ry, ink, alpha, end] of glows) {
    const [x, y] = [PANEL.x + (PANEL.w * cx) / 100, PANEL.y + (PANEL.h * cy) / 100];
    const [rxPx, ryPx] = [(PANEL.w * rx) / 100, (PANEL.h * ry) / 100];
    const paint = keep(new CK.Paint());
    paint.setShader(
      keep(
        CK.Shader.MakeRadialGradient(
          [x, y],
          rxPx,
          [color(ink, alpha), color(ink, 0)],
          [0, end],
          CK.TileMode.Clamp,
          CK.Matrix.multiply(CK.Matrix.translated(x, y), CK.Matrix.scaled(1, ryPx / rxPx), CK.Matrix.translated(-x, -y)),
        ),
      ),
    );
    canvas.drawRect(CK.XYWHRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h), paint);
  }
  canvas.restore();

  const hairline = (ink) => {
    const paint = fill(ink);
    paint.setStyle(CK.PaintStyle.Stroke);
    paint.setStrokeWidth(1);
    return paint;
  };
  canvas.drawRRect(
    CK.RRectXY(CK.XYWHRect(PANEL.x + 0.5, PANEL.y + 0.5, PANEL.w - 1, PANEL.h - 1), PANEL.radius, PANEL.radius),
    hairline(ogPalette.border),
  );

  // The restack face mark, a white alpha mask tinted with the strong text colour.
  const drawMark = (x, y, h) => {
    const paint = keep(new CK.Paint());
    paint.setColorFilter(keep(CK.ColorFilter.MakeBlend(color(ogPalette.textStrong), CK.BlendMode.SrcIn)));
    const w = (h * mark.width()) / mark.height();
    canvas.drawImageRectOptions(
      mark,
      CK.XYWHRect(0, 0, mark.width(), mark.height()),
      CK.XYWHRect(x, y, w, h),
      CK.FilterMode.Linear,
      CK.MipmapMode.Linear,
      paint,
    );
    return w;
  };

  // The wordmark: last word in lime, the signal dot raised after it, as in
  // SiteTitle.astro. Returns its right edge.
  const drawWordmark = (x, top, size) => {
    const base = { size, weight: 600, tracking: -0.01, leading: 1.2 };
    const para = paragraph([
      ['AI Data Center ', style({ ...base, ink: ogPalette.textStrong })],
      ['Systems', style({ ...base, ink: ogPalette.primaryStrong })],
    ]);
    canvas.drawParagraph(para, x, top);
    const baseline = top + para.getLineMetrics()[0].baseline;
    const dot = 0.4 * size;
    const dotX = x + para.getMaxIntrinsicWidth() + 0.14 * size + dot / 2;
    canvas.drawCircle(dotX, baseline - 0.55 * size - dot / 2, dot / 2, fill(ogPalette.primaryStrong));
    return { right: dotX + dot / 2, height: para.getHeight() };
  };

  const host = (() => {
    try {
      return new URL(import.meta.env.SITE).host;
    } catch {
      return '';
    }
  })();
  const drawHost = (centerY) => {
    if (!host) return;
    const para = paragraph([[host, style({ size: 20, weight: 500, ink: ogPalette.textMuted, families: MONO, tracking: 0.02 })]]);
    canvas.drawParagraph(para, WIDTH - PAD_X - para.getMaxIntrinsicWidth(), centerY - para.getHeight() / 2);
  };

  // Bottom-aligned text block, laid out from the bottom edge upward.
  let cursor = BOTTOM;
  const placeLines = (lines, textStyle, gapBelow) => {
    if (!lines.length) return;
    const para = paragraph([[lines.join('\n'), textStyle]], CONTENT_W);
    cursor -= gapBelow + para.getHeight();
    canvas.drawParagraph(para, PAD_X, cursor);
  };

  const descriptionStyle = style({ size: 28, ink: ogPalette.textSecondary, leading: 1.4 });

  if (card.site) {
    const markH = 56;
    drawMark(PAD_X, 72, markH);
    drawHost(72 + markH / 2);
    placeLines(wrap(card.description || '', descriptionStyle, 2), descriptionStyle, 0);
    const size = 84;
    const height = paragraph([[ogSiteTitle, style({ size, weight: 600, ink: ogPalette.textStrong, leading: 1.2 })]]).getHeight();
    cursor -= 26 + height;
    drawWordmark(PAD_X, cursor, size);
  } else {
    // Brand row, then a hairline under it.
    const rowY = 66;
    const brandSize = 28;
    const markH = 1.4 * brandSize;
    const markW = drawMark(PAD_X, rowY - 0.16 * brandSize, markH);
    drawWordmark(PAD_X + markW + 0.48 * brandSize, rowY + (markH - 1.2 * brandSize) / 2, brandSize);
    drawHost(rowY + markH / 2);
    const ruleY = rowY + markH + 34.5;
    canvas.drawLine(PAD_X, ruleY, WIDTH - PAD_X, ruleY, hairline(ogPalette.borderSubtle));

    // The title takes the largest size that fits in three lines.
    let titleStyle;
    let titleLines;
    for (const size of [64, 58, 52, 46]) {
      titleStyle = style({ size, weight: 600, ink: ogPalette.textStrong, tracking: -0.02, leading: 1.12 });
      titleLines = wrap(card.title, titleStyle, 3);
      if (!titleLines.at(-1).endsWith('…')) break;
    }
    const descriptionLines = card.description ? wrap(card.description, descriptionStyle, titleLines.length > 2 ? 1 : 2) : [];
    placeLines(descriptionLines, descriptionStyle, 0);
    placeLines(titleLines, titleStyle, descriptionLines.length ? 22 : 0);
    if (card.eyebrow) {
      const eyebrowStyle = style({ size: 20, weight: 500, ink: ogPalette.textMuted, families: MONO, tracking: 0.1 });
      placeLines([card.eyebrow.toUpperCase()], eyebrowStyle, 20);
    }
  }

  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(CK.ImageFormat.PNG, 100);
  snapshot.delete();
  surface.dispose();
  for (const obj of trash.reverse()) obj.delete?.();
  return Buffer.from(bytes);
}

export function ogResponse(image) {
  return new Response(image, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
