/**
 * renderAdHtml.js
 * Builds a self-contained HTML page that Puppeteer can screenshot.
 * Supports simple zones (headline, cta, badge, price) AND composite
 * elements (testimonial_card, checklist, arrow_callout, stat_box).
 */

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickTextColor(ts) {
  const s = (ts || '').toLowerCase();
  if (s.match(/\bwhite\b/))           return '#FFFFFF';
  if (s.match(/\bblack\b/))           return '#111111';
  if (s.match(/dark green|forest/))   return '#1B4332';
  if (s.match(/\bgreen\b/))           return '#2D6A4F';
  if (s.match(/navy|dark blue/))      return '#1B2A4A';
  if (s.match(/\bblue\b/))            return '#1E3A8A';
  if (s.match(/dark|charcoal/))       return '#1A1A1A';
  if (s.match(/cream|ivory|beige/))   return '#F5EDD8';
  return '#FFFFFF';
}

function pickBgColor(ts) {
  const s = (ts || '').toLowerCase();
  const m = s.match(/\bon\s+([\w\s]+?)(?:\s+(?:background|bg|pill)|[,;]|$)/);
  if (m) {
    const bg = m[1].trim();
    if (bg.match(/dark green/))      return '#1B4332';
    if (bg.match(/\bgreen\b/))       return '#2D6A4F';
    if (bg.match(/dark|black/))      return '#111111';
    if (bg.match(/white|light/))     return '#FFFFFF';
    if (bg.match(/cream|beige/))     return '#F5EDD8';
    if (bg.match(/navy|dark blue/))  return '#1B2A4A';
    if (bg.match(/\bblue\b/))        return '#1E3A8A';
    if (bg.match(/red/))             return '#C0392B';
    if (bg.match(/orange/))          return '#E67E22';
  }
  return null;
}

// type-aware positioning so subheadline/rating never collide with headline/cta
// splitSide: 'right' | 'left' | null — adjusts horizontal anchor for split-layout templates
function positionToCss(pos, type, splitSide) {
  const p = (pos || '').toLowerCase();
  const css = {};

  // ── Vertical: derived from position string, with per-type sensible defaults ──
  // Position strings from AI: 'top-center', 'upper-left', 'center', 'center-right',
  // 'lower-center', 'bottom-center', 'bottom-left', 'upper-right', etc.
  const isTop    = p.includes('top')    || p.includes('upper');
  const isBottom = p.includes('bottom') || p.includes('lower');
  const isMiddle = !isTop && !isBottom;   // 'center', 'center-right', etc.

  if (type === 'rating') {
    css.bottom = '14%';
  } else if (type === 'cta') {
    if      (isTop)    css.top    = '12%';
    else if (isMiddle) css.bottom = '6%';   // CTA with no qualifier → bottom
    else               css.bottom = '5%';
  } else if (type === 'badge') {
    if      (isBottom) css.bottom = '8%';
    else               css.top    = '6%';   // badge defaults to top
  } else if (type === 'subheadline' || type === 'body') {
    if      (isTop)    css.top = '22%';
    else if (isBottom) css.top = '62%';
    else               css.top = '54%';    // center → lower-center area
  } else {
    // headline, price, logo, etc.
    if      (isTop)    css.top    = '6%';
    else if (isBottom) css.bottom = '5%';
    else               css.top    = '60%'; // center/unqualified → lower-center
  }

  // Horizontal + vertical for split layouts — type-driven stack, not position-string
  if (splitSide === 'right' || splitSide === 'left') {
    // Anchor text to the correct panel side
    if (splitSide === 'right') { css.left = '52%'; css.right = 'auto'; }
    else                       { css.right = '52%'; css.left = 'auto'; }
    // Completely override vertical — clear both top and bottom first, then set one
    delete css.top;
    delete css.bottom;
    if      (type === 'badge')                          css.top    = '6%';
    else if (type === 'headline')                       css.top    = '16%';
    else if (type === 'subheadline' || type === 'body') css.top    = '34%';
    else if (type === 'cta')                            css.bottom = '10%';
    else if (type === 'rating')                         css.bottom = '22%';
    // checklist/arrow_callout/stat_box handle their own vPos in their builder
  } else {
    if      (p.includes('left'))  css.left  = '8%';
    else if (p.includes('right')) css.right = '8%';
    else                          css.left  = '50%';

    const cx     = (!p.includes('left') && !p.includes('right'));
    const cyFull = cx && !p.includes('top') && !p.includes('bottom') && !p.includes('upper') && !p.includes('lower');
    if (cx && cyFull && type !== 'subheadline' && type !== 'body' && type !== 'rating') {
      css.transform = 'translate(-50%, -50%)';
    } else if (cx) {
      css.transform = 'translateX(-50%)';
    }
  }

  return css;
}

function cssObjToString(obj) {
  return Object.entries(obj).map(function(entry) {
    const prop = entry[0].replace(/([A-Z])/g, function(m) { return '-' + m.toLowerCase(); });
    return prop + ': ' + entry[1];
  }).join('; ');
}

function buildScrimElements(zones) {
  const renderTypes = new Set(['headline', 'cta', 'badge', 'arrow_callout']);
  const active = (zones || []).filter(function(z) { return renderTypes.has(z.type); });
  if (!active.length) return '';

  const hasBottom = active.some(function(z) {
    const p = (z.position || '').toLowerCase();
    return p.includes('bottom') || p.includes('lower');
  });
  const hasTop = active.some(function(z) {
    const p = (z.position || '').toLowerCase();
    return p.includes('top') || p.includes('upper');
  });
  const hasCenter = active.some(function(z) {
    const p = (z.position || '').toLowerCase();
    return !p.includes('top') && !p.includes('upper') && !p.includes('bottom') && !p.includes('lower');
  });

  const scrims = [];
  if (hasBottom) {
    scrims.push('<div style="position:absolute;bottom:0;left:0;right:0;height:45%;background:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.18) 40%,rgba(0,0,0,0.52) 100%);pointer-events:none;z-index:1;"></div>');
  }
  if (hasTop) {
    scrims.push('<div style="position:absolute;top:0;left:0;right:0;height:35%;background:linear-gradient(to top,transparent 0%,rgba(0,0,0,0.45) 100%);pointer-events:none;z-index:1;"></div>');
  }
  if (hasCenter) {
    scrims.push('<div style="position:absolute;top:30%;left:0;right:0;height:40%;background:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.28) 40%,rgba(0,0,0,0.28) 60%,transparent 100%);pointer-events:none;z-index:1;"></div>');
  }
  return scrims.join('\n    ');
}


// ── Split-layout detection ────────────────────────────────
// Returns 'right', 'left', or null. Split = most text zones on ONE side.
function detectSplitSide(zones) {
  var textTypes = new Set(['headline','subheadline','body','cta','checklist','badge','price','rating']);
  var textZones = (zones || []).filter(function(z) { return textTypes.has(z.type); });
  if (textZones.length < 2) return null;
  var rightCount = textZones.filter(function(z) { return (z.position||'').toLowerCase().includes('right'); }).length;
  var leftCount  = textZones.filter(function(z) { return (z.position||'').toLowerCase().includes('left');  }).length;
  var ratio = textZones.length;
  if (rightCount >= Math.ceil(ratio * 0.6)) return 'right';
  if (leftCount  >= Math.ceil(ratio * 0.6)) return 'left';
  return null;
}

// Build a clean background panel for split-layout templates (white/cream half)
function buildSplitPanel(side, imgW, imgH) {
  var panelW = Math.round(imgW * 0.50);
  var left   = side === 'right' ? (imgW - panelW) + 'px' : '0px';
  // Soft gradient: opaque at edge, fading to transparent toward center
  var gradDir = side === 'right' ? 'to right' : 'to left';
  return '<div style="position:absolute;top:0;left:' + left + ';width:' + panelW + 'px;height:100%;' +
    'background:linear-gradient(' + gradDir + ', rgba(245,243,238,0.97) 55%, rgba(245,243,238,0.60) 80%, transparent 100%);' +
    'pointer-events:none;z-index:1;"></div>';
}

const BASE_FONT = { badge: 18, headline: 56, subheadline: 26, cta: 22, price: 44 };

// Star/rating chars that don't belong in headline/body copy
var STAR_RE = /[★☆⭐✦✧⭑⭒]/g;

// Dynamic headline font size — scales DOWN for longer text so it stays on 1-2 lines
function headlineFontSize(text, baseFs) {
  var len = String(text || '').length;
  if      (len <= 20)  return baseFs;           // short: full size
  else if (len <= 28)  return Math.round(baseFs * 0.90); // medium
  else if (len <= 38)  return Math.round(baseFs * 0.80); // long
  else                 return Math.round(baseFs * 0.70); // very long
}

// Dynamic subheadline font size — scales for longer body copy
function subheadlineFontSize(text, baseFs) {
  var len = String(text || '').length;
  if      (len <= 60)  return baseFs;
  else if (len <= 90)  return Math.round(baseFs * 0.90);
  else                 return Math.round(baseFs * 0.82);
}

function buildSimpleZone(zone, text, scale, splitSide) {
  if (!text) return '';
  const type      = zone.type;
  const ts        = zone.typographyStyle || '';
  const isSplit   = !!splitSide;
  // In split layouts: use dark text on light panel; in full-bleed: white text with shadow
  const headlineColor  = isSplit ? '#1A2E1A' : '#FFFFFF';
  const subColor       = isSplit ? '#2D3A2D' : '#FFFFFF';
  const headlineShadow = isSplit ? 'none' : '0 3px 16px rgba(0,0,0,0.85),0 1px 0 rgba(0,0,0,0.60)';
  const subShadow      = isSplit ? 'none' : '0 2px 14px rgba(0,0,0,0.95),0 1px 4px rgba(0,0,0,0.90)';
  const textColor = isSplit ? '#1A2E1A' : pickTextColor(ts);
  const bgColor   = pickBgColor(ts);
  const isBold    = !/regular|light|thin/i.test(ts);
  // Only apply uppercase transform to badge/cta — never subheadline/body (looks like shouting)
  const isUpper   = /upper|caps|uppercase/i.test(ts) && (type === 'badge' || type === 'cta');
  // Strip star/rating emoji from headline & subheadline — they belong in the rating zone only
  let cleaned = String(text);
  if (type === 'headline' || type === 'subheadline' || type === 'body') {
    cleaned = cleaned.replace(STAR_RE, '').replace(/\s{2,}/g, ' ').trim();
  }
  const display   = isUpper ? cleaned.toUpperCase() : cleaned;
  const baseFs    = BASE_FONT[type] || 28;
  const scaledFs  = type === 'headline'
    ? headlineFontSize(cleaned, baseFs)
    : (type === 'subheadline' || type === 'body')
      ? subheadlineFontSize(cleaned, baseFs)
      : baseFs;
  const fs        = Math.round(scaledFs * scale);
  const posCSS    = positionToCss(zone.position, type, splitSide);
  const posStr    = cssObjToString(posCSS);

  let wrapStyle = 'position:absolute;' + posStr + ';z-index:2;';
  let innerStyle = '';

  if (type === 'badge') {
    const bg = bgColor || 'rgba(20,50,30,0.92)';
    innerStyle = [
      'font-size:' + fs + 'px',
      'font-weight:800',
      'letter-spacing:2px',
      'text-transform:uppercase',
      'color:' + textColor,
      'background:' + bg,
      'padding:' + Math.round(7*scale) + 'px ' + Math.round(16*scale) + 'px',
      'border-radius:999px',
      'white-space:nowrap',
      'box-shadow:0 2px 10px rgba(0,0,0,0.30)',
    ].join(';') + ';';

  } else if (type === 'cta') {
    const bg = bgColor || '#1B4332';
    innerStyle = [
      'display:inline-block',
      'font-size:' + fs + 'px',
      'font-weight:700',
      'letter-spacing:1.5px',
      isSplit ? 'text-transform:none' : 'text-transform:uppercase',
      'color:#FFFFFF',
      'background:' + bg,
      'padding:' + Math.round(15*scale) + 'px ' + Math.round(40*scale) + 'px',
      'border-radius:999px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
      'white-space:nowrap',
    ].join(';') + ';';

  } else if (type === 'headline') {
    innerStyle = [
      'font-size:' + fs + 'px',
      'font-weight:900',
      'color:' + headlineColor,
      'text-shadow:' + headlineShadow,
      'line-height:1.12',
      isSplit ? 'max-width:44%' : 'max-width:94%',
      isSplit ? 'text-align:left' : 'text-align:center',
      'letter-spacing:-0.5px',
    ].join(';') + ';';

  } else if (type === 'subheadline' || type === 'body') {
    innerStyle = [
      'font-size:' + fs + 'px',
      'font-weight:600',
      'color:' + subColor,
      'text-shadow:' + subShadow,
      'line-height:1.5',
      isSplit ? 'max-width:44%' : 'max-width:78%',
      'text-align:center',
      'letter-spacing:0.15px',
    ].join(';') + ';';

  } else {
    innerStyle = 'font-size:' + fs + 'px;font-weight:bold;color:' + textColor + ';text-shadow:0 2px 8px rgba(0,0,0,0.6);';
  }

  return '<div style="' + wrapStyle + innerStyle + '">' + esc(display) + '</div>';
}

// ── Testimonial card ──────────────────────────────────────
function buildTestimonialCard(zone, content, imgW, imgH, scale) {
  if (!content) return '';
  const quote       = content.quote || '';
  const attribution = content.attribution || '';
  const stars       = content.stars || 5;
  const cta         = content.cta || '';
  const starStr     = '★'.repeat(Math.min(Math.max(stars, 1), 5));
  const cardW       = Math.round(imgW * 0.90);
  const pad         = Math.round(26 * scale);
  const fs_stars    = Math.round(26 * scale);
  const fs_quote    = Math.round(19 * scale);
  const fs_attr     = Math.round(14 * scale);
  const fs_cta      = Math.round(17 * scale);
  const br          = Math.round(20 * scale);
  const btnPadV     = Math.round(12 * scale);
  const btnPadH     = Math.round(30 * scale);
  const gap_sm      = Math.round(10 * scale);
  const gap_md      = Math.round(16 * scale);
  const bottom      = Math.round(16 * scale);

  return '<div style="position:absolute;bottom:' + bottom + 'px;left:50%;transform:translateX(-50%);width:' + cardW + 'px;background:#FFFFFF;border-radius:' + br + 'px;padding:' + pad + 'px;box-shadow:0 8px 40px rgba(0,0,0,0.22);text-align:center;font-family:system-ui,-apple-system,\'Helvetica Neue\',Arial,sans-serif;z-index:4;">' +
    '<div style="color:#2D6A4F;font-size:' + fs_stars + 'px;letter-spacing:4px;margin-bottom:' + gap_sm + 'px;">' + starStr + '</div>' +
    '<div style="font-size:' + fs_quote + 'px;font-weight:600;color:#1a1a1a;line-height:1.45;margin-bottom:' + gap_sm + 'px;">&ldquo;' + esc(quote) + '&rdquo;</div>' +
    '<div style="font-size:' + fs_attr + 'px;color:#888888;margin-bottom:' + gap_md + 'px;">' + esc(attribution) + '</div>' +
    (cta ? '<div style="display:inline-block;background:#2D6A4F;color:#FFFFFF;padding:' + btnPadV + 'px ' + btnPadH + 'px;border-radius:999px;font-size:' + fs_cta + 'px;font-weight:700;letter-spacing:0.5px;">' + esc(cta) + '</div>' : '') +
  '</div>';
}

// ── Checklist ─────────────────────────────────────────────
function buildChecklist(zone, items, scale, splitSide) {
  if (!items || !items.length) return '';
  const pos      = (zone.position || '').toLowerCase();
  const details  = zone.elementDetails || {};
  const isRight  = pos.includes('right');
  const isLeft   = pos.includes('left');
  const isSplit  = !!splitSide;

  // Split-layout: always vertical stacked list on the panel side
  // Centered checklists: horizontal pill row. Left/right: vertical stack.
  const isHoriz  = !isSplit && (details.layout === 'horizontal' || (!isLeft && !isRight));

  // Text/check colors: dark on split panel, white on photo
  const itemColor  = isSplit ? '#2D3A2D' : '#FFFFFF';
  const checkColor = isSplit ? '#2D6A4F' : '#4ADE80';
  const itemShadow = isSplit ? 'none' : '0 2px 10px rgba(0,0,0,0.95),0 1px 3px rgba(0,0,0,0.90)';
  const chkShadow  = isSplit ? 'none' : '0 1px 6px rgba(0,0,0,0.9)';

  const fs_item  = Math.round((isHoriz ? 19 : isSplit ? 24 : 22) * scale);
  const fs_check = Math.round((isHoriz ? 22 : isSplit ? 28 : 26) * scale);
  const itemGap  = Math.round((isHoriz ? 20 : 18) * scale);
  const checkMR  = Math.round(10 * scale);

  // Positioning
  let hPos = '';
  if (isSplit) {
    hPos = splitSide === 'right' ? 'left:53%;' : 'right:53%;';
  } else if (isRight) {
    hPos = 'right:4%;';
  } else if (isLeft) {
    hPos = 'left:4%;';
  } else if (isHoriz) {
    hPos = 'left:5%;';
  } else {
    hPos = 'left:50%;transform:translateX(-50%);';
  }

  let vPos = '';
  if (isSplit) {
    // Position below the headline in the panel (headline at top:18% in split)
    vPos = 'top:42%;';
  } else if (pos.includes('bottom')) {
    vPos = 'bottom:22%;';
  } else if (pos.includes('lower')) {
    vPos = 'top:56%;';
  } else {
    vPos = 'top:23%;';
  }

  let itemsHtml = '';

  if (isHoriz) {
    itemsHtml = items.slice(0, 6).map(function(item) {
      return '<span style="display:inline-flex;align-items:center;margin-right:' + itemGap + 'px;margin-bottom:' + Math.round(10*scale) + 'px;">' +
        '<span style="color:' + checkColor + ';font-size:' + fs_check + 'px;font-weight:800;margin-right:' + checkMR + 'px;line-height:1;text-shadow:' + chkShadow + ';">&#10003;</span>' +
        '<span style="font-size:' + fs_item + 'px;font-weight:700;color:' + itemColor + ';line-height:1.2;text-shadow:' + itemShadow + ';">' + esc(item) + '</span>' +
      '</span>';
    }).join('');
    return '<div style="position:absolute;' + vPos + hPos + 'max-width:92%;z-index:3;display:flex;flex-wrap:wrap;align-items:center;">' +
      itemsHtml +
    '</div>';
  }

  // Vertical stacked list
  const width = isSplit ? '44%' : ((!isRight && !isLeft) ? '80%' : '46%');
  itemsHtml = items.slice(0, 6).map(function(item) {
    return '<div style="display:flex;align-items:center;margin-bottom:' + itemGap + 'px;">' +
      '<span style="color:' + checkColor + ';font-size:' + fs_check + 'px;font-weight:800;margin-right:' + checkMR + 'px;line-height:1;flex-shrink:0;text-shadow:' + chkShadow + ';">&#10003;</span>' +
      '<span style="font-size:' + fs_item + 'px;font-weight:700;color:' + itemColor + ';line-height:1.4;text-shadow:' + itemShadow + ';">' + esc(item) + '</span>' +
    '</div>';
  }).join('');

  return '<div style="position:absolute;' + vPos + hPos + 'width:' + width + ';z-index:3;">' +
    itemsHtml +
  '</div>';
}

// ── Arrow callout — bilateral layout ──────────────────────
// Labels split: even indices → left side, odd indices → right side.
// SVG lines drawn from each pill toward the product center.
function buildArrowCallout(zone, labels, imgW, imgH, scale) {
  if (!labels || !labels.length) return '';
  const count = Math.min(labels.length, 6);

  // Separate into left (even-index) and right (odd-index) groups
  var leftLabels  = [];
  var rightLabels = [];
  for (var i = 0; i < count; i++) {
    if (i % 2 === 0) leftLabels.push(labels[i]);
    else             rightLabels.push(labels[i]);
  }

  // Vertical distribution band: 28% – 72% of image height
  var yBandStart = 0.28;
  var yBandEnd   = 0.72;

  function yPositions(n) {
    if (n === 0) return [];
    if (n === 1) return [0.50];
    var step = (yBandEnd - yBandStart) / (n - 1);
    return Array.from({ length: n }, function(_, j) { return yBandStart + j * step; });
  }

  var leftYs  = yPositions(leftLabels.length);
  var rightYs = yPositions(rightLabels.length);

  // Product center x (lines converge here)
  var prodX = Math.round(0.50 * imgW);

  // Pill edges where lines start
  // Left pill right edge sits at ~27% of image width
  var leftLineStart  = Math.round(0.27 * imgW);
  // Right pill left edge sits at ~73% of image width
  var rightLineStart = Math.round(0.73 * imgW);

  // Build SVG lines
  var svgParts = [];
  leftLabels.forEach(function(_, j) {
    var y = Math.round(leftYs[j] * imgH);
    svgParts.push('<circle cx="' + prodX + '" cy="' + y + '" r="4" fill="rgba(60,60,60,0.75)"/>');
    svgParts.push('<line x1="' + leftLineStart + '" y1="' + y + '" x2="' + prodX + '" y2="' + y + '" stroke="rgba(80,80,80,0.65)" stroke-width="1.5"/>');
  });
  rightLabels.forEach(function(_, j) {
    var y = Math.round(rightYs[j] * imgH);
    svgParts.push('<circle cx="' + prodX + '" cy="' + y + '" r="4" fill="rgba(60,60,60,0.75)"/>');
    svgParts.push('<line x1="' + rightLineStart + '" y1="' + y + '" x2="' + prodX + '" y2="' + y + '" stroke="rgba(80,80,80,0.65)" stroke-width="1.5"/>');
  });

  var fs_pill  = Math.round(14 * scale);
  var padV     = Math.round(8  * scale);
  var padH     = Math.round(16 * scale);
  var borderR  = Math.round(10 * scale);
  var pillStyle = 'background:rgba(255,255,255,0.93);color:#1a1a1a;font-size:' + fs_pill + 'px;font-weight:700;padding:' + padV + 'px ' + padH + 'px;border-radius:' + borderR + 'px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.18);font-family:system-ui,sans-serif;max-width:26%;text-align:center;line-height:1.3;';

  // Left pills: anchored left:3%, right-aligned text
  var leftPillsHtml = leftLabels.map(function(label, j) {
    var yPct = (leftYs[j] * 100).toFixed(1);
    return '<div style="position:absolute;left:3%;top:' + yPct + '%;transform:translateY(-50%);z-index:3;' + pillStyle + '">' + esc(label) + '</div>';
  }).join('\n');

  // Right pills: anchored right:3%
  var rightPillsHtml = rightLabels.map(function(label, j) {
    var yPct = (rightYs[j] * 100).toFixed(1);
    return '<div style="position:absolute;right:3%;top:' + yPct + '%;transform:translateY(-50%);z-index:3;' + pillStyle + '">' + esc(label) + '</div>';
  }).join('\n');

  return '<svg style="position:absolute;top:0;left:0;width:' + imgW + 'px;height:' + imgH + 'px;z-index:2;pointer-events:none;" xmlns="http://www.w3.org/2000/svg">\n  ' +
    svgParts.join('\n  ') + '\n</svg>\n' +
    leftPillsHtml + '\n' + rightPillsHtml;
}

// ── Stat box ─────────────────────────────────────────────
// If content is an array (multiple stat labels) → bilateral callout layout.
// If content is a single object/string → single centred box.
function buildStatBox(zone, content, imgW, imgH, scale) {
  if (!content) return '';

  // Array of labels → reuse bilateral arrow callout layout
  if (Array.isArray(content)) {
    return buildArrowCallout(zone, content, imgW, imgH, scale);
  }

  const number  = typeof content === 'object' ? (content.number || '') : String(content);
  const label   = typeof content === 'object' ? (content.label  || '') : '';
  const posCSS  = positionToCss(zone.position);
  const posStr  = cssObjToString(posCSS);
  const fs_num  = Math.round(44 * scale);
  const fs_lbl  = Math.round(16 * scale);
  const pad     = Math.round(20 * scale);
  const br      = Math.round(16 * scale);

  return '<div style="position:absolute;' + posStr + ';z-index:2;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:' + br + 'px;padding:' + pad + 'px;text-align:center;font-family:system-ui,sans-serif;">' +
    '<div style="font-size:' + fs_num + 'px;font-weight:800;color:#FFFFFF;line-height:1;">' + esc(number) + '</div>' +
    (label ? '<div style="font-size:' + fs_lbl + 'px;font-weight:500;color:rgba(255,255,255,0.80);margin-top:' + Math.round(6*scale) + 'px;">' + esc(label) + '</div>' : '') +
  '</div>';
}

// ── Rating ────────────────────────────────────────────────
// content: string like "★★★★★ 4.8 · 10,000+ reviews" OR object { stars, count, label }
function buildRating(zone, content, scale) {
  if (!content) return '';

  var starsStr = '★★★★★';
  var reviewStr = '';

  if (typeof content === 'object') {
    starsStr  = '★'.repeat(Math.min(Math.max(content.stars || 5, 1), 5));
    reviewStr = content.label || content.count || '';
  } else {
    var raw = String(content).trim();
    var starMatch = raw.match(/^([★✦⭐]+)/);
    starsStr  = starMatch ? starMatch[1] : '★★★★★';
    reviewStr = raw.replace(/^[★✦⭐\s]+/, '').trim();
  }

  // Smart vertical positioning: rating sits above CTA when both are at bottom.
  // "bottom-center below rating" and similar strings keep CTA at 6%;
  // rating needs to clear CTA height (~14% from bottom).
  var p = (zone.position || '').toLowerCase();
  var hPos = 'left:50%;transform:translateX(-50%);';
  if (p.includes('left'))       hPos = 'left:6%;';
  else if (p.includes('right')) hPos = 'right:6%;';

  // Always keep rating in the clear bottom band — never on the product (center)
  var vPos = 'bottom:14%;'; // default: just above CTA button

  var fs_star = Math.round(24 * scale);
  var fs_rev  = Math.round(14 * scale);
  var padV    = Math.round(6  * scale);
  var padH    = Math.round(14 * scale);
  var br      = Math.round(20 * scale);
  var gap     = Math.round(4  * scale);

  // Pill container for readability on any photo background
  return '<div style="position:absolute;' + vPos + hPos + 'z-index:2;display:inline-flex;flex-direction:column;align-items:center;gap:' + gap + 'px;background:rgba(0,0,0,0.38);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:' + padV + 'px ' + padH + 'px;border-radius:' + br + 'px;">' +
    '<span style="color:#FFD700;font-size:' + fs_star + 'px;letter-spacing:4px;line-height:1;">' + starsStr + '</span>' +
    (reviewStr ? '<span style="font-size:' + fs_rev + 'px;font-weight:600;color:#FFFFFF;letter-spacing:0.3px;line-height:1;">' + esc(reviewStr) + '</span>' : '') +
  '</div>';
}

// ── Main dispatcher ───────────────────────────────────────
function buildZoneElement(zone, content, scale, imgW, imgH, splitSide) {
  const type = zone.type;
  if (type === 'testimonial_card') return buildTestimonialCard(zone, content, imgW, imgH, scale);
  if (type === 'checklist')        return buildChecklist(zone, content, scale, splitSide);
  if (type === 'arrow_callout')    return buildArrowCallout(zone, content, imgW, imgH, scale);
  if (type === 'stat_box')         return buildStatBox(zone, content, imgW, imgH, scale);
  if (type === 'rating')           return buildRating(zone, content, scale);
  if (typeof content === 'string' || content === null) return buildSimpleZone(zone, content, scale, splitSide);
  return '';
}

// ── Main export ───────────────────────────────────────────
function buildAdHtml(bgImageBuffer, bgMimeType, zones, selectedText, imgW, imgH) {
  const bgB64  = bgImageBuffer.toString('base64');
  const bgData = 'data:' + (bgMimeType || 'image/png') + ';base64,' + bgB64;
  const scale  = imgW / 1024;

  const RENDER_TYPES = new Set([
    'badge', 'headline', 'subheadline', 'body', 'cta', 'price', 'rating',
    'testimonial_card', 'checklist', 'arrow_callout', 'stat_box', 'pill_tag_row'
  ]);

  // callout_labels feeds both arrow_callout AND stat_box (bilateral layout)
  const calloutLabels = (selectedText.callout_labels && selectedText.callout_labels.length)
    ? selectedText.callout_labels
    : null;

  // If template has both subheadline AND body zones, body would duplicate the text.
  // Only give body the text when there is no subheadline zone in the template.
  const hasSubheadlineZone = (zones || []).some(function(z) { return z.type === 'subheadline'; });

  const textForType = {
    badge:            selectedText.badge         || null,
    headline:         selectedText.headline      || null,
    subheadline:      selectedText.subheadline   || null,
    body:             hasSubheadlineZone ? null : (selectedText.subheadline || null),
      cta:              selectedText.cta           || null,
    price:            selectedText.price         || null,
    rating:           selectedText.rating        || null,
    testimonial_card: selectedText.testimonial
      ? Object.assign({}, selectedText.testimonial, { cta: selectedText.cta })
      : null,
    checklist:        (selectedText.checklist_items && selectedText.checklist_items.length)
      ? selectedText.checklist_items
      : null,
    arrow_callout:    calloutLabels,
    stat_box:         calloutLabels || selectedText.stat_highlight || null,
    pill_tag_row:     selectedText.pill_tags     || null,
  };

  const effectiveZones = (zones && zones.length > 0) ? zones : [
    { type: 'headline', position: 'lower-center', typographyStyle: 'bold white' },
    { type: 'cta',      position: 'bottom-center', typographyStyle: 'bold white on dark green' },
  ];

  // Detect split-panel layout (e.g. template-5: product left, text panel right)
  const splitSide = detectSplitSide(effectiveZones);


  // For split layouts: suppress gradient scrims (text is on clean panel, not photo)
  const scrimElements = splitSide ? '' : buildScrimElements(effectiveZones);

  // Split panel background (white/cream overlay on the text side)
  const splitPanelHtml = splitSide ? buildSplitPanel(splitSide, imgW, imgH) : '';

  const overlayHtml = effectiveZones
    .map(function(zone) { return buildZoneElement(zone, textForType[zone.type], scale, imgW, imgH, splitSide); })
    .filter(Boolean)
    .join('\n');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }' +
    'html, body { width: ' + imgW + 'px; height: ' + imgH + 'px; overflow: hidden; background: #000; }' +
    '.canvas { position: relative; width: ' + imgW + 'px; height: ' + imgH + 'px;' +
    'background-image: url("' + bgData + '");' +
    'background-size: cover; background-position: center;' +
    'font-family: system-ui, -apple-system, Arial, sans-serif; }' +
    '</style></head><body>' +
    '<div class="canvas">\n    ' + scrimElements + splitPanelHtml + '\n    ' + overlayHtml + '\n</div>' +
    '</body></html>';
}

module.exports = { buildAdHtml };
