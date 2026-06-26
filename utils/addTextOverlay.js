/**
 * addTextOverlay.js
 * Composites concept text onto a generated image.
 *
 * Primary method: SVG + sharp (zero extra native deps beyond sharp itself).
 * Enhancement: @napi-rs/canvas if available (loaded lazily, never crashes server).
 *
 * All requires are lazy — called inside compositeTextOnImage only.
 */

// ── Position → pixel fractions ────────────────────────────
function parsePosition(pos) {
  const p = (pos || 'center').toLowerCase();
  let xFrac = 0.5, yFrac = 0.5, anchor = 'middle';

  if      (p.includes('top'))    yFrac = 0.08;
  else if (p.includes('upper'))  yFrac = 0.20;
  else if (p.includes('lower'))  yFrac = 0.76;
  else if (p.includes('bottom')) yFrac = 0.88;

  if      (p.includes('left'))  { xFrac = 0.10; anchor = 'start'; }
  else if (p.includes('right')) { xFrac = 0.90; anchor = 'end'; }
  else                          { xFrac = 0.50; anchor = 'middle'; }

  return { xFrac, yFrac, anchor };
}

// ── Simple colour extractor ───────────────────────────────
function pickTextColor(ts) {
  const s = (ts || '').toLowerCase();
  if (s.match(/\bwhite\b/))         return '#FFFFFF';
  if (s.match(/\bblack\b/))         return '#111111';
  if (s.match(/dark green|forest/)) return '#1B4332';
  if (s.match(/\bgreen\b/))         return '#2D6A4F';
  if (s.match(/navy|dark blue/))    return '#1B2A4A';
  if (s.match(/\bblue\b/))          return '#1E3A8A';
  if (s.match(/dark|charcoal/))     return '#1A1A1A';
  if (s.match(/cream|ivory|beige/)) return '#F5EDD8';
  return '#FFFFFF';
}

function pickBgColor(ts) {
  const s = (ts || '').toLowerCase();
  const m = s.match(/\bon\s+([\w\s]+?)(?:\s+(?:background|bg|pill)|[,;]|$)/);
  if (m) {
    const bg = m[1].trim();
    if (bg.match(/dark green/))    return '#1B4332';
    if (bg.match(/\bgreen\b/))     return '#2D6A4F';
    if (bg.match(/dark|black/))    return '#111111';
    if (bg.match(/white|light/))   return '#FFFFFF';
    if (bg.match(/cream|beige/))   return '#F5EDD8';
    if (bg.match(/navy|dark blue/))return '#1B2A4A';
    if (bg.match(/\bblue\b/))      return '#1E3A8A';
    if (bg.match(/red/))           return '#C0392B';
  }
  return null;
}

// ── XML escape ────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Estimate chars per line (for word-wrap in SVG) ────────
function charsPerLine(fontSize, maxPx) {
  return Math.max(8, Math.floor(maxPx / (fontSize * 0.58)));
}

// ── Word-wrap text into SVG tspan lines ───────────────────
function wrapToTspans(text, x, baseY, fontSize, lineH, anchor, maxPx, maxLines = 3) {
  const cpl = charsPerLine(fontSize, maxPx);
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';

  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (test.length > cpl && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) { cur = cur + '…'; break; }
    } else { cur = test; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);

  const totalH = lines.length * lineH;
  const startY = baseY - totalH / 2 + lineH * 0.5;

  return lines.map((l, i) =>
    `<tspan x="${x}" y="${Math.round(startY + i * lineH)}">${esc(l)}</tspan>`
  ).join('');
}

// ── Build text data map from concept ─────────────────────
function buildTextData(concept) {
  return {
    badge:       concept.badge        || null,
    headline:    concept.headline     || null,
    subheadline: concept.primary_text || null,
    body:        concept.primary_text || null,
    cta:         concept.cta          || 'Shop Now',
    price:       null,
    logo:        null,
    rating:      null,
  };
}

// ── Infer shadow colour opposite to text ─────────────────
function shadowForText(textColor) {
  // Dark text → white shadow; light text → dark shadow
  const light = ['#FFFFFF', '#F5EDD8', '#F5F0E8'];
  return light.includes(textColor) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.6)';
}

// ── Build SVG overlay ─────────────────────────────────────
// Renders: badge (pill), headline (plain text, template color), CTA (pill button).
// Body/subheadline skipped — those belong in the FB ad copy field, not on the image.
function buildSvgOverlay(textZones, textData, imgW, imgH) {
  const parts = [];
  const sc    = imgW / 1024;

  // Build one filter per text colour so shadows always contrast the text
  const filterDark  = `<filter id="fDark"  x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="rgba(0,0,0,0.8)"/></filter>`;
  const filterLight = `<filter id="fLight" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="rgba(255,255,255,0.7)"/></filter>`;
  parts.push(`<defs>${filterDark}${filterLight}</defs>`);

  const SKIP_TYPES = new Set(['body', 'subheadline', 'logo', 'rating']);

  for (const zone of textZones) {
    if (SKIP_TYPES.has(zone.type)) continue;

    const textVal = textData[zone.type];
    if (!textVal) continue;

    const { xFrac, yFrac, anchor } = parsePosition(zone.position);
    const px = Math.round(xFrac * imgW);
    const py = Math.round(yFrac * imgH);

    const textColor = pickTextColor(zone.typographyStyle);
    const bgColor   = pickBgColor(zone.typographyStyle);
    const isUpper   = /upper|caps/i.test(zone.typographyStyle || '');
    const isBold    = !/regular|light|thin/i.test(zone.typographyStyle || '');
    const displayText = isUpper ? String(textVal).toUpperCase() : String(textVal);
    const svgAnchor  = anchor === 'start' ? 'start' : anchor === 'end' ? 'end' : 'middle';

    const fsSrc = { badge: 20, headline: 48, cta: 24, price: 44 };
    const fs    = Math.round((fsSrc[zone.type] || 26) * sc);
    const lineH = Math.round(fs * 1.4);
    const fw    = isBold ? 'bold' : '600';

    // Shadow filter: dark text needs light shadow (fLight), light text needs dark (fDark)
    const lightColors = ['#FFFFFF', '#F5EDD8', '#F5F0E8'];
    const shadowFilter = lightColors.includes(textColor) ? 'url(#fDark)' : 'url(#fLight)';

    // ── BADGE ──
    if (zone.type === 'badge') {
      const label = displayText.toUpperCase();
      const estW  = Math.round(label.length * fs * 0.60 + fs * 1.0);
      const bh    = Math.round(fs * 1.7);
      const bx    = Math.round(px - estW / 2);
      const by    = Math.round(py - bh / 2);
      const rx    = Math.round(bh / 2);
      const bg    = bgColor || 'rgba(20,50,30,0.90)';
      const tc    = textColor || '#FFFFFF';
      parts.push(`<rect x="${bx}" y="${by}" width="${estW}" height="${bh}" rx="${rx}" fill="${bg}"/>`);
      parts.push(`<text x="${px}" y="${py}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="${tc}" text-anchor="middle" dominant-baseline="central" letter-spacing="1.5">${esc(label)}</text>`);
      continue;
    }

    // ── CTA ──
    if (zone.type === 'cta') {
      const label = displayText.toUpperCase();
      const estW  = Math.round(label.length * fs * 0.62 + fs * 2.2);
      const bh    = Math.round(fs * 1.85);
      const bx    = Math.round(px - estW / 2);
      const by    = Math.round(py - bh / 2);
      const rx    = Math.round(bh / 2);
      const bg    = bgColor || '#1B4332';
      const tc    = textColor || '#FFFFFF';
      // Drop shadow for the button itself
      parts.push(`<rect x="${bx + 2}" y="${by + 4}" width="${estW}" height="${bh}" rx="${rx}" fill="rgba(0,0,0,0.22)"/>`);
      parts.push(`<rect x="${bx}" y="${by}" width="${estW}" height="${bh}" rx="${rx}" fill="${bg}"/>`);
      parts.push(`<text x="${px}" y="${py}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="${tc}" text-anchor="middle" dominant-baseline="central" letter-spacing="1.5">${esc(label)}</text>`);
      continue;
    }

    // ── HEADLINE ──
    // No background strip — text sits directly on the image using template colours.
    // A multi-directional shadow makes it readable on any background.
    if (zone.type === 'headline') {
      const maxW   = imgW * 0.86;
      const tspans = wrapToTspans(displayText, px, py, fs, lineH, svgAnchor, maxW, 3);
      parts.push(`<text font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="${fw}" fill="${textColor}" text-anchor="${svgAnchor}" filter="${shadowFilter}">${tspans}</text>`);
      continue;
    }

    // ── PRICE ──
    if (zone.type === 'price') {
      parts.push(`<text x="${px}" y="${py}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="${textColor}" text-anchor="${svgAnchor}" dominant-baseline="central" filter="${shadowFilter}">${esc(displayText)}</text>`);
    }
  }

  return `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">\n${parts.join('\n')}\n</svg>`;
}

// ── Main export ───────────────────────────────────────────
/**
 * compositeTextOnImage
 * @param {Buffer} imageBuffer       - Base generated image
 * @param {object} concept           - { headline, badge, cta, primary_text }
 * @param {object} templateAnalysis  - { textZones, hasTextOverlays }
 * @returns {Buffer} PNG with text composited on top
 */
async function compositeTextOnImage(imageBuffer, concept, templateAnalysis) {
  if (!templateAnalysis?.textZones?.length) return imageBuffer;

  // Lazy-load sharp — never crashes server on module load
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.warn('[textOverlay] sharp not available:', e.message);
    return imageBuffer;
  }

  const meta = await sharp(imageBuffer).metadata();
  const imgW  = meta.width  || 1024;
  const imgH  = meta.height || 1024;
  const textData = buildTextData(concept);

  // ── Try SVG method first (most reliable — no extra native deps) ──
  try {
    const svgStr    = buildSvgOverlay(templateAnalysis.textZones, textData, imgW, imgH);
    const svgBuffer = Buffer.from(svgStr);
    const result    = await sharp(imageBuffer)
      .composite([{ input: svgBuffer, top: 0, left: 0 }])
      .png()
      .toBuffer();
    console.log('[textOverlay] SVG overlay applied for', templateAnalysis.textZones.length, 'zone(s)');
    return result;
  } catch (svgErr) {
    console.warn('[textOverlay] SVG method failed:', svgErr.message);
  }

  // ── Fallback: @napi-rs/canvas ──
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(imgW, imgH);
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, imgW, imgH);

    for (const zone of templateAnalysis.textZones) {
      const textVal = textData[zone.type];
      if (!textVal) continue;
      const { xFrac, yFrac } = parsePosition(zone.position);
      const px = Math.round(xFrac * imgW);
      const py = Math.round(yFrac * imgH);
      const sizeMap = { badge:22, headline:50, subheadline:28, body:24, cta:26, price:46 };
      const fs = Math.round((sizeMap[zone.type] || 26) * (imgW / 1024));
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = pickTextColor(zone.typographyStyle);
      ctx.fillText(String(textVal).substring(0, 60), px, py);
      ctx.shadowBlur = 0;
    }

    const overlayBuf = canvas.toBuffer('image/png');
    const result = await sharp(imageBuffer)
      .composite([{ input: overlayBuf, top: 0, left: 0 }])
      .png()
      .toBuffer();
        console.log('[textOverlay] SVG overlay applied for', templateAnalysis.textZones.length, 'zone(s)');
    return result;
  } catch (svgErr) {
    console.warn('[textOverlay] SVG method failed:', svgErr.message);
  }

  // Canvas fallback
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(imgW, imgH);
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, imgW, imgH);

    for (const zone of templateAnalysis.textZones) {
      const textVal = textData[zone.type];
      if (!textVal) continue;
      const { xFrac, yFrac } = parsePosition(zone.position);
      const px = Math.round(xFrac * imgW);
      const py = Math.round(yFrac * imgH);
      const sizeMap = { badge:20, headline:48, cta:24, price:44 };
      const fs = Math.round((sizeMap[zone.type] || 26) * (imgW / 1024));
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = pickTextColor(zone.typographyStyle);
      ctx.fillText(String(textVal).substring(0, 60), px, py);
      ctx.shadowBlur  = 0;
    }

    const overlayBuf = canvas.toBuffer('image/png');
    const result = await sharp(imageBuffer)
      .composite([{ input: overlayBuf, top: 0, left: 0 }])
      .png()
      .toBuffer();
    console.log('[textOverlay] Canvas fallback applied');
    return result;
  } catch (canvasErr) {
    console.warn('[textOverlay] Canvas fallback also failed:', canvasErr.message);
    return imageBuffer;
  }
}

module.exports = { compositeTextOnImage };
