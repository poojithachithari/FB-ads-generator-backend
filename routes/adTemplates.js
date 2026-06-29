const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '../data/ad-templates.json');
const IMG_DIR   = path.join(__dirname, '../template-images');

// Ensure directories exist
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

function readTemplates() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {}
  return [];
}
function writeTemplates(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMG_DIR),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|webp|gif/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// GET all templates — rewrite relative imageUrls to absolute so cross-origin frontends can load them
router.get('/', (req, res) => {
  const backendUrl = `${req.protocol}://${req.get('host')}`;
  const templates = readTemplates().map(t => ({
    ...t,
    imageUrl: t.imageUrl && t.imageUrl.startsWith('/')
      ? `${backendUrl}${t.imageUrl}`
      : t.imageUrl
  }));
  res.json(templates);
});

// POST add template
router.post('/', upload.single('image'), (req, res) => {
  const { name } = req.body;
  if (!name || !req.file) return res.status(400).json({ error: 'name and image are required' });

  const templates = readTemplates();
  const backendUrl = `${req.protocol}://${req.get('host')}`;
  const entry = {
    id:        uuidv4(),
    name:      name.trim(),
    filename:  req.file.filename,
    imageUrl:  `${backendUrl}/template-images/${req.file.filename}`,
    createdAt: new Date().toISOString()
  };
  templates.push(entry);
  writeTemplates(templates);
  res.json(entry);
});

// DELETE template
router.delete('/:id', (req, res) => {
  const templates = readTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const [removed] = templates.splice(idx, 1);
  try {
    const imgPath = path.join(IMG_DIR, removed.filename);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  } catch (_) {}

  writeTemplates(templates);
  res.json({ ok: true });
});

module.exports = router;
