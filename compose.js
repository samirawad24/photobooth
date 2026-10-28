// Lays the finished photos onto a print in one of the four wedding looks.

import { EVENT, PALETTE as P, LAYOUTS } from './config.js';

const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = 'Jost, "Helvetica Neue", Arial, sans-serif';

export function cells(layoutId) {
  const L = LAYOUTS[layoutId];
  const cw = Math.floor((L.W - L.pad * 2 - L.gap * (L.cols - 1)) / L.cols);
  const ch = Math.round(cw / L.aspect);
  const out = [];
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      out.push({ x: L.pad + c * (cw + L.gap), y: L.pad + r * (ch + L.gap), w: cw, h: ch });
    }
  }
  const gridBottom = L.pad + L.rows * ch + (L.rows - 1) * L.gap;
  return { cells: out, cw, ch, footer: { x: 0, y: gridBottom, w: L.W, h: L.H - gridBottom } };
}

// Text helpers

function spaced(ctx, text, x, y, spacing) {
  // Canvas letterSpacing is not in every Safari, so space letters by hand.
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = align;
  return total;
}

function fitFont(ctx, text, family, style, size, maxW) {
  let s = size;
  ctx.font = `${style} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${style} ${s}px ${family}`;
  }
  return s;
}

// Botanical line art, drawn as paths so it stays crisp at print size.

function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function bezTan(p0, p1, p2, t) {
  const u = 1 - t;
  return Math.atan2(2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]), 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]));
}

// A sprig growing from (x, y) toward `angle` (radians), bending by `bend`.
// kind 'olive' has long pointed leaves, 'eucalyptus' has round coin leaves.
function sprig(ctx, x, y, len, angle, { kind, color, width, fill, bend = 0.18, leaves = 7, side = 1 }) {
  const p0 = [x, y];
  const p2 = [x + Math.cos(angle) * len, y + Math.sin(angle) * len];
  const mid = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
  const n = angle - (Math.PI / 2) * side;
  const p1 = [mid[0] + Math.cos(n) * len * bend, mid[1] + Math.sin(n) * len * bend];

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
  ctx.stroke();

  for (let i = 0; i < leaves; i++) {
    const t = 0.16 + (i / (leaves - 1)) * 0.8;
    const [lx, ly] = bez(p0, p1, p2, t);
    const tan = bezTan(p0, p1, p2, t);
    const flip = i % 2 === 0 ? 1 : -1;
    const scale = 1 - t * 0.45;
    if (kind === 'eucalyptus') {
      const r = len * 0.085 * scale;
      const a = tan + flip * 1.05;
      const stem = r * 0.55;
      const sx = lx + Math.cos(a) * stem, sy = ly + Math.sin(a) * stem;
      const cx = lx + Math.cos(a) * (stem + r), cy = ly + Math.sin(a) * (stem + r);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.88, a, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
      // Center vein
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      const L = len * 0.2 * scale;
      const W = L * 0.24;
      const a = tan + flip * 0.62;
      const tip = [lx + Math.cos(a) * L, ly + Math.sin(a) * L];
      const nx = Math.cos(a + Math.PI / 2) * W, ny = Math.sin(a + Math.PI / 2) * W;
      const m = [lx + Math.cos(a) * L * 0.45, ly + Math.sin(a) * L * 0.45];
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(m[0] + nx * 2, m[1] + ny * 2, tip[0], tip[1]);
      ctx.quadraticCurveTo(m[0] - nx * 2, m[1] - ny * 2, lx, ly);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + Math.cos(a) * L * 0.8, ly + Math.sin(a) * L * 0.8);
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // Tip leaf
  if (kind === 'olive') {
    const tan = bezTan(p0, p1, p2, 1);
    const L = len * 0.13;
    const W = L * 0.24;
    const tip = [p2[0] + Math.cos(tan) * L, p2[1] + Math.sin(tan) * L];
    const nx = Math.cos(tan + Math.PI / 2) * W, ny = Math.sin(tan + Math.PI / 2) * W;
    const m = [p2[0] + Math.cos(tan) * L * 0.45, p2[1] + Math.sin(tan) * L * 0.45];
    ctx.beginPath();
    ctx.moveTo(p2[0], p2[1]);
    ctx.quadraticCurveTo(m[0] + nx * 2, m[1] + ny * 2, tip[0], tip[1]);
    ctx.quadraticCurveTo(m[0] - nx * 2, m[1] - ny * 2, p2[0], p2[1]);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.stroke();
  } else {
    const tan = bezTan(p0, p1, p2, 1);
    const r = len * 0.05;
    ctx.beginPath();
    ctx.ellipse(p2[0] + Math.cos(tan) * r, p2[1] + Math.sin(tan) * r, r, r * 0.88, tan, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.stroke();
  }
  ctx.restore();
}

// Two sprigs reaching out from a shared center, like a pressed-flower spray.
export function spray(ctx, cx, cy, span, opts) {
  const len = span * 0.5;
  sprig(ctx, cx - span * 0.008, cy, len, Math.PI + 0.22, { ...opts, side: 1 });
  sprig(ctx, cx + span * 0.008, cy, len, -0.22, { ...opts, side: -1 });
}

function paper(ctx, W, H, strength) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  const t = tile.getContext('2d');
  const img = t.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 255 * strength;
  }
  t.putImageData(img, 0, 0);
  ctx.save();
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Themes. Each draws the background, frames each photo and fills the footer.

function photoMat(ctx, cell, color, m) {
  ctx.fillStyle = color;
  ctx.fillRect(cell.x - m, cell.y - m, cell.w + m * 2, cell.h + m * 2);
}

function hairline(ctx, cell, color, offset, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(cell.x - offset, cell.y - offset, cell.w + offset * 2, cell.h + offset * 2);
}

const THEMES = {
  sage: {
    bg: P.sage,
    before(ctx, L, g) {
      ctx.fillStyle = P.sage;
      ctx.fillRect(0, 0, L.W, L.H);
      paper(ctx, L.W, L.H, 0.035);
      for (const c of g.cells) photoMat(ctx, c, P.cream, Math.round(L.W * 0.006));
    },
    footer(ctx, L, f) {
      namesBlock(ctx, L, f, { names: P.greenDeep, date: P.green, ornament: { kind: 'olive', color: P.green, fill: 'rgba(62,85,65,0.16)' } });
    },
  },
  cream: {
    bg: P.cream,
    before(ctx, L, g) {
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, L.W, L.H);
      paper(ctx, L.W, L.H, 0.045);
      const i1 = L.pad * 0.36, i2 = L.pad * 0.5;
      ctx.strokeStyle = P.gold;
      ctx.lineWidth = Math.max(2, L.W * 0.0018);
      ctx.strokeRect(i1, i1, L.W - i1 * 2, L.H - i1 * 2);
      ctx.lineWidth = Math.max(1, L.W * 0.0009);
      ctx.strokeRect(i2, i2, L.W - i2 * 2, L.H - i2 * 2);
    },
    after(ctx, L, g) {
      for (const c of g.cells) hairline(ctx, c, 'rgba(70,60,40,0.25)', 0, Math.max(1, L.W * 0.001));
    },
    footer(ctx, L, f) {
      const { nameY, dateY, ornY, nameSize } = metrics(L, f);
      ctx.fillStyle = P.ink;
      ctx.textAlign = 'center';
      fitFont(ctx, names(), SERIF, 'italic 500', nameSize, f.w * 0.78);
      ctx.fillText(names(), f.w / 2, nameY);
      // Gold rule with a small diamond in the middle
      const half = f.w * 0.18;
      const y = ornY + nameSize * 0.12;
      ctx.strokeStyle = P.gold;
      ctx.lineWidth = Math.max(2, L.W * 0.0016);
      ctx.beginPath();
      ctx.moveTo(f.w / 2 - half, y); ctx.lineTo(f.w / 2 - nameSize * 0.16, y);
      ctx.moveTo(f.w / 2 + nameSize * 0.16, y); ctx.lineTo(f.w / 2 + half, y);
      ctx.stroke();
      const d = nameSize * 0.07;
      ctx.fillStyle = P.gold;
      ctx.beginPath();
      ctx.moveTo(f.w / 2, y - d); ctx.lineTo(f.w / 2 + d, y); ctx.lineTo(f.w / 2, y + d); ctx.lineTo(f.w / 2 - d, y);
      ctx.closePath();
      ctx.fill();
      dateLine(ctx, L, f, dateY, '#6A5B3E');
    },
  },
  white: {
    bg: P.white,
    before(ctx, L) {
      ctx.fillStyle = P.white;
      ctx.fillRect(0, 0, L.W, L.H);
    },
    footer(ctx, L, f) {
      const top = f.y + f.h * 0.1;
      const usable = f.h - L.pad * 0.6 - f.h * 0.1;
      const r = Math.min(usable * 0.27, f.w * 0.14);
      const cy = top + r + usable * 0.04;
      ctx.strokeStyle = P.green;
      ctx.lineWidth = Math.max(2, r * 0.025);
      ctx.beginPath();
      ctx.arc(f.w / 2, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = P.green;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `400 ${r * 0.78}px ${SERIF}`;
      ctx.fillText(EVENT.monogram[0], f.w / 2 - r * 0.42, cy - r * 0.02);
      ctx.fillText(EVENT.monogram[1], f.w / 2 + r * 0.44, cy + r * 0.04);
      ctx.font = `italic 400 ${r * 0.34}px ${SERIF}`;
      ctx.fillText('&', f.w / 2 + r * 0.01, cy + r * 0.02);
      ctx.textBaseline = 'alphabetic';
      const capSize = Math.min(usable * 0.075, f.w * 0.034);
      ctx.font = `400 ${capSize}px ${SANS}`;
      ctx.fillStyle = P.ink;
      const ny = cy + r + usable * 0.17;
      spaced(ctx, `${EVENT.first} & ${EVENT.second}`.toUpperCase(), f.w / 2, ny, capSize * 0.32);
      ctx.font = `300 ${capSize * 0.78}px ${SANS}`;
      ctx.fillStyle = P.sageDeep;
      spaced(ctx, EVENT.dateText.toUpperCase(), f.w / 2, ny + capSize * 1.9, capSize * 0.3);
    },
  },
  eucalyptus: {
    bg: P.greenDeep,
    before(ctx, L, g) {
      ctx.fillStyle = P.greenDeep;
      ctx.fillRect(0, 0, L.W, L.H);
      paper(ctx, L.W, L.H, 0.05);
      for (const c of g.cells) hairline(ctx, c, 'rgba(243,236,221,0.75)', Math.round(L.gap * 0.32), Math.max(1.5, L.W * 0.0012));
    },
    footer(ctx, L, f) {
      namesBlock(ctx, L, f, { names: P.cream, date: '#B9C6A8', ornament: { kind: 'eucalyptus', color: 'rgba(243,236,221,0.85)', fill: 'rgba(201,210,189,0.18)' } });
    },
  },
};

const names = () => `${EVENT.first} & ${EVENT.second}`;

function metrics(L, f) {
  const inner = f.h - L.pad;
  const nameSize = Math.min(inner * 0.24, f.w * 0.095);
  return {
    nameSize,
    ornY: f.y + inner * 0.36,
    nameY: f.y + inner * 0.69,
    dateY: f.y + inner * 0.69 + nameSize * 0.78,
  };
}

function dateLine(ctx, L, f, y, color) {
  const size = Math.max(14, Math.min((f.h - L.pad) * 0.06, f.w * 0.028));
  ctx.font = `300 ${size}px ${SANS}`;
  ctx.fillStyle = color;
  spaced(ctx, EVENT.dateText.toUpperCase(), f.w / 2, y, size * 0.38);
}

function namesBlock(ctx, L, f, colors) {
  const { nameY, dateY, ornY, nameSize } = metrics(L, f);
  const span = Math.min(f.w * 0.62, nameSize * 5.2);
  spray(ctx, f.w / 2, ornY, span, { ...colors.ornament, width: Math.max(1.5, nameSize * 0.022), leaves: 7 });
  ctx.fillStyle = colors.names;
  ctx.textAlign = 'center';
  fitFont(ctx, names(), SERIF, 'italic 500', nameSize, f.w * 0.82);
  ctx.fillText(names(), f.w / 2, nameY);
  dateLine(ctx, L, f, dateY, colors.date);
}

export function themeBackground(themeId) {
  return THEMES[themeId].bg;
}

// photos: canvases already filtered and sized to the cell. Missing ones draw
// as soft placeholders (used for the layout previews).
export function compose(layoutId, themeId, photos, out = document.createElement('canvas'), scale = 1) {
  const L = LAYOUTS[layoutId];
  const g = cells(layoutId);
  const T = THEMES[themeId];
  out.width = Math.round(L.W * scale);
  out.height = Math.round(L.H * scale);
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  T.before(ctx, L, g);
  g.cells.forEach((c, i) => {
    const p = photos[i];
    if (p) ctx.drawImage(p, c.x, c.y, c.w, c.h);
    else {
      ctx.fillStyle = themeId === 'eucalyptus' ? 'rgba(243,236,221,0.16)' : 'rgba(62,85,65,0.12)';
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }
  });
  T.after?.(ctx, L, g);
  T.footer(ctx, L, g.footer);
  ctx.restore();
  return out;
}

export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`italic 500 40px ${SERIF}`),
      document.fonts.load(`400 40px ${SERIF}`),
      document.fonts.load(`300 40px ${SANS}`),
      document.fonts.load(`400 40px ${SANS}`),
    ]);
  } catch {}
}
