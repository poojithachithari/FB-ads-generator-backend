const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE   = path.join(__dirname, '../data/brands.json');
const BRAND_IMG_DIR = path.join(__dirname, '../brand-images');

// Ensure brand-images root exists
if (!fs.existsSync(BRAND_IMG_DIR)) fs.mkdirSync(BRAND_IMG_DIR, { recursive: true });

// Extract local file path from a localhost imageUrl
// e.g. "http://localhost:3001/generated/ad_abc.png" -> "{backendDir}/generated/ad_abc.png"
function resolveImagePath(imageUrl) {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl);
    // Strip leading slash, join with backend root
    return path.join(__dirname, '..', u.pathname.replace(/^\//, ''));
  } catch (_) {
    return null;
  }
}

function readBrands() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function writeBrands(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET all brands (summary — no full sessions payload)
router.get('/', (req, res) => {
  const brands = readBrands();
  const summary = brands.map(b => ({
    id: b.id,
    name: b.name,
    briefTemplate: b.briefTemplate,
    createdAt: b.createdAt,
    sessionCount: (b.sessions || []).length,
    lastImage: (b.sessions || []).slice(-1)[0]?.imageUrl || null,
    lastCreatedAt: (b.sessions || []).slice(-1)[0]?.createdAt || null
  }));
  res.json(summary);
});

// GET single brand with all sessions
router.get('/:id', (req, res) => {
  const brands = readBrands();
  const brand = brands.find(b => b.id === req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(brand);
});

// POST create brand
router.post('/', (req, res) => {
  const { name, briefTemplate } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const brands = readBrands();
  if (brands.find(b => b.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'A brand with this name already exists' });
  }

  const brand = {
    id: uuidv4(),
    name: name.trim(),
    briefTemplate: briefTemplate || {},
    createdAt: new Date().toISOString(),
    sessions: []
  };
  brands.push(brand);
  writeBrands(brands);
  res.json(brand);
});

// PUT update brand brief template
router.put('/:id', (req, res) => {
  const brands = readBrands();
  const idx = brands.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Brand not found' });

  if (req.body.name) brands[idx].name = req.body.name.trim();
  if (req.body.briefTemplate) brands[idx].briefTemplate = req.body.briefTemplate;
  writeBrands(brands);
  res.json(brands[idx]);
});

// DELETE brand
router.delete('/:id', (req, res) => {
  const brands = readBrands();
  const idx = brands.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Brand not found' });
  brands.splice(idx, 1);
  writeBrands(brands);
  res.json({ ok: true });
});

// POST save a session (completed ad) to a brand
router.post('/:id/sessions', (req, res) => {
  const brands = readBrands();
  const idx = brands.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Brand not found' });

  const { brief, template, concept, imageUrl, prompts } = req.body;
  const sessionId = uuidv4();

  // ── Permanently store the image ───────────────────────────
  // Copy from generated/ (temp) → brand-images/{brandId}/{sessionId}.png (permanent)
  let permanentImageUrl = imageUrl || null;
  if (imageUrl) {
    try {
      const srcPath = resolveImagePath(imageUrl);
      if (srcPath && fs.existsSync(srcPath)) {
        const brandImgDir = path.join(BRAND_IMG_DIR, brands[idx].id);
        if (!fs.existsSync(brandImgDir)) fs.mkdirSync(brandImgDir, { recursive: true });
        const destPath = path.join(brandImgDir, sessionId + '.png');
        fs.copyFileSync(srcPath, destPath);
        // Store as a relative URL so it works on any port/host
        permanentImageUrl = `/brand-images/${brands[idx].id}/${sessionId}.png`;
        console.log('[brands] Image copied to:', destPath);
      }
    } catch (imgErr) {
      console.warn('[brands] Could not copy image, keeping original URL:', imgErr.message);
    }
  }

  const session = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    brief: brief || {},
    template: template || null,
    concept: concept || {},
    imageUrl: permanentImageUrl,
    prompts: prompts || {}
  };

  if (!brands[idx].sessions) brands[idx].sessions = [];
  brands[idx].sessions.push(session);

  // Keep brief template updated with latest brief data
  if (brief) brands[idx].briefTemplate = brief;

  writeBrands(brands);
  res.json(session);
});

// DELETE a session from a brand
router.delete('/:id/sessions/:sessionId', (req, res) => {
  const brands = readBrands();
  const idx = brands.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Brand not found' });

  const session = (brands[idx].sessions || []).find(s => s.id === req.params.sessionId);

  // Delete the permanent image file if it exists
  if (session?.imageUrl) {
    try {
      const imgPath = path.join(__dirname, '..', session.imageUrl.replace(/^\//, ''));
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
        console.log('[brands] Deleted image:', imgPath);
      }
    } catch (e) {
      console.warn('[brands] Could not delete image file:', e.message);
    }
  }

  brands[idx].sessions = (brands[idx].sessions || []).filter(s => s.id !== req.params.sessionId);
  writeBrands(brands);
  res.json({ ok: true });
});

module.exports = router;
