const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// List all sessions
router.get('/', (req, res) => {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) return res.json([]);

    const sessions = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json'))
      .map(file => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
          return {
            id: data.id,
            createdAt: data.createdAt,
            brandName: data.brief?.brandName,
            productOffer: data.brief?.productOffer,
            numConcepts: data.concepts?.length || 0,
            hasGeneratedImages: data.generatedImages?.length > 0
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single session
router.get('/:id', (req, res) => {
  try {
    const sessionPath = path.join(__dirname, `../data/${req.params.id}.json`);
    if (!fs.existsSync(sessionPath)) return res.status(404).json({ error: 'Session not found' });
    res.json(JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a generated image to the session (explicit "Save to Templates")
router.post('/:id/images', (req, res) => {
  try {
    const sessionPath = path.join(__dirname, `../data/${req.params.id}.json`);
    if (!fs.existsSync(sessionPath)) return res.status(404).json({ error: 'Session not found' });

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const { conceptId, filename, imageUrl, prompt, method } = req.body;

    if (!imageUrl || !filename) return res.status(400).json({ error: 'imageUrl and filename are required' });

    if (!session.generatedImages) session.generatedImages = [];
    const entry = { conceptId, filename, imageUrl, prompt, method, generatedAt: new Date().toISOString() };
    session.generatedImages.push(entry);
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a single generated image from a session (by index)
router.delete('/:id/images/:imageIndex', (req, res) => {
  try {
    const sessionPath = path.join(__dirname, `../data/${req.params.id}.json`);
    if (!fs.existsSync(sessionPath)) return res.status(404).json({ error: 'Session not found' });

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const idx = parseInt(req.params.imageIndex, 10);

    if (!session.generatedImages || idx < 0 || idx >= session.generatedImages.length) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Optionally delete the physical file
    const img = session.generatedImages[idx];
    if (img.imageUrl) {
      const filename = img.imageUrl.split('/').pop();
      const filePath = path.join(__dirname, '../generated', filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    }

    session.generatedImages.splice(idx, 1);
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
