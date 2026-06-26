require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ── Global crash guards — log the error, never kill the process ──
process.on('uncaughtException', (err) => {
  console.error('\n[CRASH] uncaughtException:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[CRASH] unhandledRejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure required directories exist
['uploads', 'generated', 'data', 'template-images', 'example-images', 'brand-images'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

const allowedOrigins = [
  'http://localhost:5173',
  'https://fb-ads-generator.netlify.app'
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Render health checks, curl)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed — ' + origin));
  }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving
app.use('/uploads',         express.static(path.join(__dirname, 'uploads')));
app.use('/generated',       express.static(path.join(__dirname, 'generated')));
app.use('/example-images',  express.static(path.join(__dirname, 'example-images')));
app.use('/template-images', express.static(path.join(__dirname, 'template-images')));
app.use('/brand-images',   express.static(path.join(__dirname, 'brand-images')));

// Routes
app.use('/api/save-brief',        require('./routes/saveBrief'));
app.use('/api/generate-copy',    require('./routes/generateCopy'));
app.use('/api/generate-image',   require('./routes/generateImage'));
app.use('/api/generate-prompts', require('./routes/generatePrompts'));
app.use('/api/regenerate-prompt',require('./routes/regeneratePrompt'));
app.use('/api/sessions',         require('./routes/sessions'));
app.use('/api/check-apis',       require('./routes/checkApis'));
app.use('/api/example-prompts',  require('./routes/examplePrompts'));
app.use('/api/ad-templates',     require('./routes/adTemplates'));
app.use('/api/brands',           require('./routes/brands'));
app.use('/api/analyze-template', require('./routes/analyzeTemplate'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Express error handler — catches any unhandled errors from routes
app.use((err, req, res, next) => {
  console.error('[Express error]', req.method, req.path, err.message);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log('\nBackend running at http://localhost:' + PORT);
  console.log('  Anthropic: ' + (process.env.ANTHROPIC_API_KEY ? 'loaded' : 'MISSING'));
  console.log('  OpenAI:    ' + (process.env.OPENAI_API_KEY    ? 'loaded' : 'MISSING'));
  console.log('  Gemini:    ' + (process.env.GEMINI_API_KEY    ? 'loaded' : 'MISSING'));
});
