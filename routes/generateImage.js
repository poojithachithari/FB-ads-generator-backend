require('dotenv').config();
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const https = require('https');
const http = require('http');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { compositeTextOnImage } = require('../utils/addTextOverlay');
const { buildAdHtml }         = require('../utils/renderAdHtml');
const { renderHtmlToPng }     = require('../utils/puppeteerRender');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── helpers ────────────────────────────────────────────
function safeText(t, max) {
  return (t || '').replace(/[^\w\s,.\-]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, max);
}

// Native HTTPS download — more reliable than axios on Windows for image fetches
// rejectUnauthorized:false bypasses SSL cert issues common on Windows corporate networks
const lenientAgent = new https.Agent({ rejectUnauthorized: false });

function fetchUrl(urlStr, maxRedirects = 6) {
  return new Promise((resolve, reject) => {
    const attempt = (u, hops) => {
      if (hops > maxRedirects) return reject(new Error('Too many redirects'));
      const lib = u.startsWith('https') ? https : http;
      const opts = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'image/png,image/jpeg,image/*,*/*'
        },
        agent: u.startsWith('https') ? lenientAgent : undefined
      };
      const req = lib.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return attempt(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(90000, () => { req.destroy(); reject(new Error('Timeout')); });
    };
    attempt(urlStr, 0);
  });
}

// ─── Gemini: text-to-image (no product) ──────────────────
async function generateWithGemini(prompt, aspectRatio = '1:1') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GEMINI_API_KEY set');
  const shortPrompt = prompt;

  // Imagen 4 via /predict
  const imagenModels = ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001'];
  for (const model of imagenModels) {
    try {
      console.log('[img] Imagen 4 text-only ->', model, 'aspectRatio:', aspectRatio);
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${key}`,
        { instances: [{ prompt: shortPrompt }], parameters: { sampleCount: 1, aspectRatio, safetyFilterLevel: 'block_some', personGeneration: 'allow_adult' } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
      );
      const b64 = r.data?.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error('No image data');
      console.log('[img] Imagen 4 OK via', model);
      return Buffer.from(b64, 'base64');
    } catch (e) {
      console.warn(`[img] Imagen 4 ${model} [${e.response?.status}]:`, e.response?.data?.error?.message || e.message);
    }
  }

  // Gemini image models via /generateContent
  const flashModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image'];
  for (const model of flashModels) {
    try {
      console.log('[img] Gemini image model ->', model);
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { contents: [{ parts: [{ text: shortPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
      );
      const parts = r.data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          console.log('[img] Gemini image model OK via', model);
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
      throw new Error('No image part in response');
    } catch (e) {
      console.warn(`[img] Gemini ${model} [${e.response?.status}]:`, e.response?.data?.error?.message || e.message);
    }
  }

  throw new Error('All Gemini text-to-image approaches failed');
}

// ─── Gemini: multimodal product image generation ──────────
// Sends the product PHOTO as vision input → model re-renders it naturally
// in the scene with correct lighting, shadows and perspective (like ChatGPT does)
async function generateWithGeminiProduct(productImagePath, prompt, aspectRatio = '1:1') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GEMINI_API_KEY set');
  const sharp = require('sharp');

  // Prep product image — JPEG gives best results for Gemini vision
  const productBuf = await sharp(productImagePath)
    .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  const productB64 = productBuf.toString('base64');

  const sizeLabel = aspectRatio === '16:9' ? 'landscape 16:9 widescreen' : aspectRatio === '9:16' ? 'vertical 9:16 portrait' : 'square 1:1';
  const productPromptText = `This is the product image I want featured in the ad.
Generate a Facebook/Instagram ad creative (${sizeLabel} format) that naturally integrates this EXACT product into a lifestyle scene.
${prompt}
Requirements:
- Use this exact product packaging — preserve all text, colors, logo, and design details faithfully
- The product must look naturally placed in the scene, NOT pasted or floating
- Match the product's lighting to the environment (shadows, reflections, ambient light)
- Correct perspective and depth — the product should look like it physically belongs there
- No artificial white box or hard edges around the product
- No text overlays on the image. No watermarks. Photorealistic. High quality.`;

  // ── Approach A: Gemini vision + image output (multimodal I/O) ──
  // These models accept an image as input AND generate an image as output
  const visionImageModels = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ];

  for (const model of visionImageModels) {
    try {
      console.log('[img] Gemini vision+image gen ->', model);
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: productB64 } },
              { text: productPromptText }
            ]
          }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      const parts = r.data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          console.log('[img] Gemini vision+image gen OK via', model);
          return { buffer: Buffer.from(part.inlineData.data, 'base64'), method: 'gemini-product' };
        }
      }
      throw new Error('No image part in response');
    } catch (e) {
      console.warn(`[img] Gemini vision+image ${model} [${e.response?.status}]:`, e.response?.data?.error?.message || e.message);
    }
  }

  // ── Approach B: Imagen 4 PRODUCT_IMAGE edit mode ──
  const imagenModels = ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001'];
  for (const model of imagenModels) {
    try {
      console.log('[img] Imagen 4 PRODUCT_IMAGE mode ->', model);
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${key}`,
        {
          instances: [{ prompt: prompt, image: { bytesBase64Encoded: productB64 } }],
          parameters: { sampleCount: 1, aspectRatio, safetyFilterLevel: 'block_some', personGeneration: 'allow_adult', editConfig: { editMode: 'PRODUCT_IMAGE' } }
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      const b64 = r.data?.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error('No image data');
      console.log('[img] Imagen 4 PRODUCT_IMAGE OK via', model);
      return { buffer: Buffer.from(b64, 'base64'), method: 'gemini-product' };
    } catch (e) {
      console.warn(`[img] Imagen 4 PRODUCT_IMAGE ${model} [${e.response?.status}]:`, e.response?.data?.error?.message || e.message);
    }
  }

  throw new Error('All product image generation approaches failed');
}

// ─── Canvas placeholder — always works, shows real text ──
async function generatePlaceholder(brandName, headline, cta, creativeAngle, visualDescription) {
  // Try @napi-rs/canvas first (has text support, pre-built Windows binaries)
  try {
    const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
    const canvas = createCanvas(1024, 1024);
    const ctx = canvas.getContext('2d');

    const palettes = {
      'Social Proof':     ['#11998e', '#38ef7d'],
      'Urgency':          ['#c0392b', '#e74c3c'],
      'Problem-Solution': ['#4776e6', '#8e54e9'],
      'FOMO':             ['#e67e22', '#f39c12'],
      'Transformation':   ['#6a11cb', '#2575fc'],
      'Curiosity':        ['#b91d73', '#f953c6'],
      'How-To':           ['#00b09b', '#96c93d'],
      'Authority':        ['#1a1a2e', '#3498db'],
    };
    const [c1, c2] = palettes[creativeAngle] || ['#667eea', '#764ba2'];

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    // Semi-transparent overlay card
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(ctx, 60, 60, 904, 904, 28);
    ctx.fill();

    // Decorative circles
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(150, 150, 200, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(874, 874, 220, 0, Math.PI * 2); ctx.fill();

    // Creative angle badge
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, 332, 130, 360, 50, 25);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((creativeAngle || 'Ad Creative').toUpperCase(), 512, 163);

    // Brand name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 12;
    ctx.fillText(brandName || 'Your Brand', 512, 300);
    ctx.shadowBlur = 0;

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(262, 340); ctx.lineTo(762, 340); ctx.stroke();

    // Headline — word-wrapped
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 38px sans-serif';
    wrapText(ctx, (headline || 'Your Ad Headline Here'), 512, 400, 780, 52);

    // Visual description (smaller)
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.font = '24px sans-serif';
    wrapText(ctx, (visualDescription || '').substring(0, 120), 512, 570, 780, 34, 3);

    // CTA button
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(ctx, 312, 780, 400, 72, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, 312, 780, 400, 72, 36);
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(cta || 'Shop Now', 512, 826);

    // "Preview" watermark
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '18px sans-serif';
    ctx.fillText('AI Image Preview — Regenerate for real image', 512, 960);

    return canvas.toBuffer('image/png');
  } catch (e) {
    console.warn('[img] @napi-rs/canvas failed, falling back to shape-only placeholder:', e.message);
    return generateShapePlaceholder(creativeAngle);
  }
}

// Fallback: shapes only (no text) — works even without canvas
async function generateShapePlaceholder(creativeAngle) {
  const sharp = require('sharp');
  const palettes = {
    'Social Proof':     ['#11998e', '#38ef7d', '#fff'],
    'Urgency':          ['#c0392b', '#e74c3c', '#fff'],
    'Problem-Solution': ['#4776e6', '#8e54e9', '#fff'],
    'FOMO':             ['#e67e22', '#f39c12', '#333'],
    'Transformation':   ['#6a11cb', '#2575fc', '#fff'],
    'Curiosity':        ['#b91d73', '#f953c6', '#fff'],
    'How-To':           ['#00b09b', '#96c93d', '#fff'],
    'Authority':        ['#1a1a2e', '#3498db', '#e94560'],
  };
  const [c1, c2, acc] = palettes[creativeAngle] || ['#667eea', '#764ba2', '#fff'];
  const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect x="60" y="60" width="904" height="904" rx="28" fill="rgba(0,0,0,0.22)" stroke="${acc}" stroke-opacity="0.2" stroke-width="1.5"/>
  <circle cx="150" cy="150" r="200" fill="${acc}" fill-opacity="0.07"/>
  <circle cx="874" cy="874" r="220" fill="${acc}" fill-opacity="0.07"/>
  <rect x="362" y="220" width="300" height="440" rx="24" fill="${acc}" fill-opacity="0.14"/>
  <rect x="387" y="200" width="250" height="50" rx="12" fill="${acc}" fill-opacity="0.18"/>
  <rect x="442" y="182" width="140" height="28" rx="8" fill="${acc}" fill-opacity="0.22"/>
  <line x1="212" y1="700" x2="812" y2="700" stroke="${acc}" stroke-opacity="0.25" stroke-width="1.5"/>
  <rect x="312" y="780" width="400" height="70" rx="35" fill="${acc}" fill-opacity="0.22"/>
  <circle cx="212" cy="212" r="8" fill="${acc}" fill-opacity="0.4"/>
  <circle cx="812" cy="212" r="8" fill="${acc}" fill-opacity="0.4"/>
  <circle cx="212" cy="812" r="8" fill="${acc}" fill-opacity="0.4"/>
  <circle cx="812" cy="812" r="8" fill="${acc}" fill-opacity="0.4"/>
</svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Canvas helpers ──────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, cx, y, maxW, lineH, maxLines = 4) {
  const words = text.split(' ');
  let line = '';
  let linesDrawn = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, y);
      line = word;
      y += lineH;
      linesDrawn++;
      if (linesDrawn >= maxLines) { ctx.fillText(line + '...', cx, y); return; }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, cx, y);
}

// ─── Default text zones (used when template analysis has no zones) ───────────
function defaultTextZones() {
  return [
    { type: 'badge',    position: 'top-center',    typographyStyle: 'bold uppercase, white on dark green pill' },
    { type: 'headline', position: 'lower-center',  typographyStyle: 'bold white' },
    { type: 'cta',      position: 'bottom-center', typographyStyle: 'bold white on dark green' }
  ];
}

// ─── Main route ──────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      visualDescription, brandName, tone, creativeAngle,
      sessionId, conceptId, hasProductImage,
      concept: conceptObj, templateAnalysis, copyOptions
    } = req.body;
    if (!visualDescription) return res.status(400).json({ error: 'visualDescription is required' });

    // Get headline and CTA for the placeholder (prefer direct concept object)
    let headline = conceptObj?.headline || '';
    let cta = conceptObj?.cta || 'Shop Now';
    if (!headline && sessionId) {
      try {
        const sPath = path.join(__dirname, `../data/${sessionId}.json`);
        if (fs.existsSync(sPath)) {
          const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
          const concept = s.concepts?.find(c => c.id === conceptId);
          if (concept) { headline = concept.headline || ''; cta = concept.cta || 'Shop Now'; }
        }
      } catch (_) {}
    }

    // Always request no text in the background image — text is added via Puppeteer overlay
    const noTextSuffix = 'No text overlays. No watermarks. Photorealistic. Ultra high resolution.';
    const basePrompt = `${visualDescription} Brand: ${brandName || ''}. Mood: ${tone || 'professional'}. ${noTextSuffix}`;
    let imageBuffer = null;
    let method = 'unknown';

    // Resolve product image path and aspect ratio from session
    let productImagePath = null;
    let aspectRatio = '1:1';
    if (sessionId) {
      try {
        const sPath = path.join(__dirname, `../data/${sessionId}.json`);
        if (fs.existsSync(sPath)) {
          const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
          if (s.brief?.imageSize) aspectRatio = s.brief.imageSize;
          if (hasProductImage && s.productImageFilename) {
            const p = path.join(__dirname, '../uploads', s.productImageFilename);
            if (fs.existsSync(p)) productImagePath = p;
          }
        }
      } catch (_) {}
    }
    console.log('[img] aspectRatio:', aspectRatio);

    // Detect split-panel layout from template zones
    const splitZones = templateAnalysis?.textZones || [];
    function detectSplitSideLocal(zones) {
      const textTypes = new Set(['headline','subheadline','body','cta','checklist','badge','price','rating']);
      const tz = zones.filter(function(z) { return textTypes.has(z.type); });
      if (tz.length < 2) return null;
      const rightCount = tz.filter(function(z) { return (z.position||'').toLowerCase().includes('right'); }).length;
      const leftCount  = tz.filter(function(z) { return (z.position||'').toLowerCase().includes('left');  }).length;
      if (rightCount >= Math.ceil(tz.length * 0.6)) return 'right';
      if (leftCount  >= Math.ceil(tz.length * 0.6)) return 'left';
      return null;
    }
    const splitSideDetected = detectSplitSideLocal(splitZones);
    const isSplitLayout = !!splitSideDetected;

    if (productImagePath && isSplitLayout) {
      // ── SPLIT-PANEL + PRODUCT IMAGE ──
      // Use Gemini vision+image with a split-specific prompt:
      // product hero on the LEFT half, RIGHT half clean/light for text overlay.
      // Gemini handles lighting/shadow blending so the product looks natural.
      console.log('[img] Split-panel + product — Gemini vision split layout');
      const productSide = splitSideDetected === 'right' ? 'LEFT' : 'RIGHT';
      const cleanSide   = splitSideDetected === 'right' ? 'RIGHT' : 'LEFT';
      const splitProductPrompt = `Split-panel Facebook/Instagram ad creative. ` +
        `Place the uploaded product as the hero on the ${productSide} HALF of the image (0-50% horizontally). ` +
        `The ${cleanSide} HALF must be completely clean, light, softly-lit — smooth gradient or pale neutral background, NO objects, NO clutter. ` +
        `Product must NOT cross the vertical center line. ` +
        `Match the product lighting to the environment with natural shadows and reflections. ` +
        `${visualDescription} Brand: ${brandName || ''}. Mood: ${tone || 'professional'}. ` +
        `No text overlays. No watermarks. Photorealistic. Ultra high resolution.`;
      try {
        const res = await generateWithGeminiProduct(productImagePath, splitProductPrompt, aspectRatio);
        imageBuffer = res.buffer; method = res.method;
      } catch (e) {
        console.warn('[img] Gemini split-panel product gen failed:', e.message);
      }
    } else if (productImagePath) {
      // ── FULL-BLEED WITH PRODUCT IMAGE ──
      // Gemini vision+image: sends the product photo to the model, which re-renders
      // it naturally into the scene with matching lighting/shadows (same as ChatGPT)
      console.log('[img] Product image path:', productImagePath);
      try {
        const productPrompt = `Facebook/Instagram ad creative. ${visualDescription} The uploaded product is the hero — place it naturally with correct lighting and shadows. Brand: ${brandName || ''}. Mood: ${tone || 'professional'}. Professional photography. No text. No watermarks.`;
        const res = await generateWithGeminiProduct(productImagePath, productPrompt, aspectRatio);
        imageBuffer = res.buffer; method = res.method;
      } catch (e) { console.warn('[img] Gemini product image gen failed:', e.message); }
    }

    // ── Text-to-image (no product, or product gen failed) ──
    if (!imageBuffer) {
      try { imageBuffer = await generateWithGemini(basePrompt, aspectRatio); method = 'gemini'; }
      catch (e) { console.warn('[img] Gemini text-to-image:', e.message); }
    }

    // Try 3: Canvas placeholder (always works)
    if (!imageBuffer) {
      console.log('[img] All AI services failed — canvas placeholder');
      imageBuffer = await generatePlaceholder(brandName, headline, cta, creativeAngle, visualDescription);
      method = 'placeholder';
    }

    // ── Text overlay — Puppeteer HTML/CSS renderer ────────────
    // If a concept and template zones are provided, composite the selected
    // text (headline, subheadline, CTA) onto the background image using
    // a headless Chrome screenshot. Falls back to SVG overlay, then raw image.
    const hasConceptText = conceptObj && (conceptObj.headline || conceptObj.cta);
    const zones = templateAnalysis?.textZones?.length
      ? templateAnalysis.textZones
      : null; // no template zones = default positioning

    if (hasConceptText) {
      try {
        // Detect mime type from buffer magic bytes
        const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
        const bgMime = isPng ? 'image/png' : 'image/jpeg';

        // Get image dimensions via sharp
        let imgW = 1024, imgH = 1024;
        try {
          const sharp = require('sharp');
          const meta = await sharp(imageBuffer).metadata();
          imgW = meta.width  || 1024;
          imgH = meta.height || 1024;
        } catch (_) {}

        const selectedText = {
          headline:        conceptObj.headline     || null,
          subheadline:     conceptObj.primary_text || null,
          cta:             conceptObj.cta          || null,
          badge:           conceptObj.badge        || null,
          // Rich element content from AI copy generation
          rating:          copyOptions?.rating_text        || null,
          checklist_items: copyOptions?.checklist_items   || [],
          testimonial:     copyOptions?.testimonial       || null,
          callout_labels:  copyOptions?.callout_labels    || [],
          stat_highlight:  copyOptions?.stat_highlight    || null,
          pill_tags:       copyOptions?.pill_tags         || null,
        };

        const effectiveZones = zones || [
          { type: 'headline', position: 'lower-center', typographyStyle: 'bold white' },
          { type: 'cta',      position: 'bottom-center', typographyStyle: 'bold white on dark green' },
        ];

        // Primary: Puppeteer HTML/CSS
        try {
          const html = buildAdHtml(imageBuffer, bgMime, effectiveZones, selectedText, imgW, imgH);
          imageBuffer = await renderHtmlToPng(html, imgW, imgH);
          console.log('[img] Puppeteer text overlay applied');
        } catch (puppErr) {
          console.warn('[img] Puppeteer failed, trying SVG overlay:', puppErr.message);

          // Fallback: SVG overlay via sharp
          try {
            const analysisForSvg = { textZones: effectiveZones };
            imageBuffer = await compositeTextOnImage(imageBuffer, conceptObj, analysisForSvg);
            console.log('[img] SVG text overlay applied (puppeteer fallback)');
          } catch (svgErr) {
            console.warn('[img] SVG overlay also failed:', svgErr.message);
          }
        }
      } catch (overlayErr) {
        console.warn('[img] Text overlay skipped:', overlayErr.message);
      }
    } else {
      console.log('[img] No concept text — returning raw background');
    }

    // Save image file to disk
    const filename = `ad_${uuidv4()}.png`;
    fs.writeFileSync(path.join(__dirname, '../generated', filename), imageBuffer);
    const backendUrl = `${req.protocol}://${req.get('host')}`;
    const imageUrl = `${backendUrl}/generated/${filename}`;
    console.log(`[img] Done via ${method} -> ${filename}`);

    res.json({ imageUrl, filename, method });
  } catch (err) {
    console.error('[img] Unexpected error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

module.exports = router;
