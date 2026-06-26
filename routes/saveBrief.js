require('dotenv').config();
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product_${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// POST /api/save-brief
// Uploads product images, saves session stub, returns sessionId + image URLs
router.post('/', upload.array('productImages', 10), async (req, res) => {
  try {
    const {
      brandName, productOffer, targetAudience, adGoal,
      toneOfVoice, visualStyle, numConcepts, additionalNotes
    } = req.body;

    const files = req.files || [];
    const primaryFile = files[0] || null;
    const PORT = process.env.PORT || 3001;
    const productImageUrl = primaryFile
      ? `http://localhost:${PORT}/uploads/${primaryFile.filename}`
      : null;
    const productImageFilenames = files.map(f => f.filename);

    const tonesArr = Array.isArray(toneOfVoice) ? toneOfVoice : (toneOfVoice ? [toneOfVoice] : []);
    const stylesArr = Array.isArray(visualStyle) ? visualStyle : (visualStyle ? [visualStyle] : []);

    const sessionId = uuidv4();
    const sessionData = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      brief: {
        brandName, productOffer, targetAudience, adGoal,
        toneOfVoice: tonesArr,
        visualStyle: stylesArr,
        numConcepts: parseInt(numConcepts) || 3,
        additionalNotes
      },
      productImageUrl,
      productImageFilename: primaryFile?.filename || null,
      productImageFilenames,
      concepts: [],
      generatedImages: []
    };

    fs.writeFileSync(
      path.join(__dirname, `../data/${sessionId}.json`),
      JSON.stringify(sessionData, null, 2)
    );

    console.log(`[saveBrief] Session ${sessionId} | Brand: ${brandName} | Images: ${files.length}`);

    res.json({
      sessionId,
      productImageUrl,
      hasProductImage: files.length > 0
    });
  } catch (err) {
    console.error('[saveBrief] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
