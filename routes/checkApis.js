require('dotenv').config();
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const https = require('https');
const axios = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.get('/', async (req, res) => {
  const results = {};

  // ── Test 1: OpenAI text (GPT) ──
  try {
    await openai.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 5,
      messages: [{ role: 'user', content: 'hi' }]
    });
    results.openai_text = { ok: true, message: 'GPT-4o-mini works' };
  } catch (e) {
    results.openai_text = { ok: false, message: e.message };
  }

  // ── Test 2: OpenAI DALL-E ──
  try {
    await openai.images.generate({
      model: 'dall-e-2', prompt: 'a red circle', n: 1, size: '256x256'
    });
    results.openai_images = { ok: true, message: 'DALL-E 2 works' };
  } catch (e) {
    const hint = (e.status === 404 || e.message?.includes('does not exist'))
      ? 'Image generation NOT enabled for this key. Fix: platform.openai.com → Project → Enable DALL-E'
      : (e.status === 402 || e.status === 429)
      ? 'Billing/quota issue on OpenAI account'
      : e.message;
    results.openai_images = { ok: false, message: hint };
  }

  // ── Test 3: Gemini — list available models first ──
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    results.gemini_key = { ok: false, message: 'GEMINI_API_KEY not set in .env' };
    results.gemini_models = { ok: false, message: 'Skipped — no key' };
  } else {
    // List models to discover what's available for this key
    try {
      const listR = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
        { timeout: 15000 }
      );
      const models = (listR.data?.models || []).map(m => m.name);
      results.gemini_models = { ok: true, available: models };

      // Find a text-capable model from the list
      const textModels = models.filter(m =>
        m.includes('gemini') && !m.includes('embedding') && !m.includes('aqa')
      );
      results.gemini_key = { ok: true, message: `Key valid ✓ — ${models.length} models available`, textModels };
    } catch (e) {
      const status = e.response?.status;
      const errMsg = e.response?.data?.error?.message || e.message;
      let hint = `[HTTP ${status}] ${errMsg}`;
      if (status === 400 && errMsg?.toLowerCase().includes('api key')) hint = 'Invalid API key format';
      if (status === 401) hint = `Unauthorized [401] — key rejected: ${errMsg}`;
      if (status === 403) hint = `Permission denied [403]: ${errMsg}`;
      results.gemini_key = { ok: false, message: hint, raw: errMsg };
      results.gemini_models = { ok: false, message: hint };
    }
  }

  // ── Test 4: Imagen 4 via /predict (confirmed in this key's model list) ──
  if (results.gemini_key?.ok) {
    const imagenModels = ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001'];
    for (const model of imagenModels) {
      try {
        const r = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${geminiKey}`,
          { instances: [{ prompt: 'a red circle on white background' }], parameters: { sampleCount: 1, aspectRatio: '1:1' } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 45000 }
        );
        const hasImage = !!r.data?.predictions?.[0]?.bytesBase64Encoded;
        results.gemini_imagen = { ok: hasImage, message: hasImage ? `${model} works ✓` : `${model}: no image returned`, model };
        if (hasImage) break;
      } catch (e) {
        const status = e.response?.status;
        const errMsg = e.response?.data?.error?.message || e.message;
        results.gemini_imagen = { ok: false, message: `${model} [HTTP ${status}]: ${errMsg}` };
      }
    }
  } else {
    results.gemini_imagen = { ok: false, message: 'Skipped — Gemini key invalid' };
  }

  // ── Test 5: Gemini image models via /generateContent ──
  if (results.gemini_key?.ok) {
    const flashModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
    for (const model of flashModels) {
      try {
        const r = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          { contents: [{ parts: [{ text: 'a simple red circle on white background' }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 45000 }
        );
        const parts = r.data?.candidates?.[0]?.content?.parts || [];
        const hasImage = parts.some(p => p.inlineData?.mimeType?.startsWith('image/'));
        results.gemini_flash_image = { ok: hasImage, message: hasImage ? `${model} works ✓` : `${model}: no image in response`, model };
        if (hasImage) break;
      } catch (e) {
        const status = e.response?.status;
        const errMsg = e.response?.data?.error?.message || e.message;
        results.gemini_flash_image = { ok: false, message: `${model} [HTTP ${status}]: ${errMsg}` };
      }
    }
  } else {
    results.gemini_flash_image = { ok: false, message: 'Skipped — Gemini key invalid' };
  }

  // ── Test 6: Pollinations.ai ──
  try {
    await new Promise((resolve, reject) => {
      const req = https.get(
        'https://image.pollinations.ai/prompt/red+circle?width=64&height=64',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 },
        (r) => {
          if (r.statusCode === 200 || r.statusCode === 301 || r.statusCode === 302) {
            r.resume(); resolve();
          } else {
            r.resume(); reject(new Error(`HTTP ${r.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
    results.pollinations = { ok: true, message: 'Pollinations reachable' };
  } catch (e) {
    results.pollinations = { ok: false, message: e.message };
  }

  // ── Summary ──
  const anyImageWorks = results.gemini_imagen?.ok || results.gemini_flash_image?.ok ||
                        results.openai_images?.ok || results.pollinations?.ok;

  results.summary = anyImageWorks
    ? '✅ At least one image service is working'
    : '❌ NO image services available. Check Gemini key at: http://localhost:3001/api/check-apis';

  console.log('[check-apis] Results:', JSON.stringify(results, null, 2));
  res.json(results);
});

module.exports = router;
