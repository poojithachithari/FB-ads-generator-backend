const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const FILE = path.join(__dirname, '../data/example-prompts.json');
const IMG_DIR = path.join(__dirname, '../example-images');

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: IMG_DIR,
    filename: (req, file, cb) => cb(null, `ex_${uuidv4()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// GET all examples
router.get('/', (req, res) => res.json(load()));

// POST add a new example (with optional image)
router.post('/', upload.single('image'), (req, res) => {
  const prompt = req.body?.prompt?.trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const examples = load();
  const entry = {
    id: uuidv4(),
    prompt,
    label: req.body?.label?.trim() || '',
    imageFilename: req.file?.filename || null,
    imageUrl: req.file ? `/example-images/${req.file.filename}` : null,
    addedAt: new Date().toISOString()
  };
  examples.push(entry);
  save(examples);
  res.json(entry);
});

// POST upload/replace image for existing example
router.post('/:id/image', upload.single('image'), (req, res) => {
  const examples = load();
  const idx = examples.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // Delete old image if exists
  if (examples[idx].imageFilename) {
    const old = path.join(IMG_DIR, examples[idx].imageFilename);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  examples[idx].imageFilename = req.file.filename;
  examples[idx].imageUrl = `/example-images/${req.file.filename}`;
  save(examples);
  res.json(examples[idx]);
});

// PUT update prompt/label
router.put('/:id', (req, res) => {
  const examples = load();
  const idx = examples.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (req.body.prompt?.trim()) examples[idx].prompt = req.body.prompt.trim();
  if (req.body.label !== undefined) examples[idx].label = req.body.label.trim();
  save(examples);
  res.json(examples[idx]);
});

// DELETE an example (also removes its image)
router.delete('/:id', (req, res) => {
  const examples = load();
  const ex = examples.find(e => e.id === req.params.id);
  if (ex?.imageFilename) {
    const imgPath = path.join(IMG_DIR, ex.imageFilename);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  save(examples.filter(e => e.id !== req.params.id));
  res.json({ ok: true });
});

module.exports = router;
