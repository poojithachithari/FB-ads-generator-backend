# FB Ads Generator — Backend

Node.js/Express API server that powers the FB Ads Generator. Handles AI copy generation, image generation, template analysis, brand management, and Puppeteer-based text rendering.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| AI Copy | Anthropic Claude (`claude-sonnet-4-6`) |
| AI Images | Google Gemini (`gemini-2.5-flash`) |
| Text Overlay | Puppeteer (headless Chrome) |
| Image Processing | Sharp |
| File Uploads | Multer |
| Environment | dotenv |

## Prerequisites

- Node.js 18+
- API keys for Anthropic, OpenAI (optional), and Google Gemini

## Installation

```bash
cd backend
npm install
```

## Environment Setup

Copy the example file and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=your_anthropic_key_here
OPENAI_API_KEY=your_openai_key_here
GEMINI_API_KEY=your_gemini_key_here
PORT=3001
```

## Running

**Development** (auto-restarts on `.js` file changes):
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server runs at `http://localhost:3001`.

## API Routes

| Method | Route | Description |
|---|---|---|
| POST | `/api/save-brief` | Save creative brief for a session |
| POST | `/api/generate-copy` | Generate ad copy options using Claude |
| POST | `/api/generate-image` | Generate ad image via Gemini + Puppeteer overlay |
| POST | `/api/generate-prompts` | Generate image generation prompts |
| POST | `/api/regenerate-prompt` | Regenerate a single image prompt |
| POST | `/api/analyze-template` | Vision analysis of an ad template image |
| GET | `/api/sessions` | List saved sessions |
| GET | `/api/ad-templates` | List available ad templates |
| GET | `/api/brands` | List brands |
| POST | `/api/brands` | Create a brand |
| GET | `/api/example-prompts` | Get example prompts |
| GET | `/api/check-apis` | Health check for all API keys |
| GET | `/api/health` | Server health check |

## Folder Structure

```
backend/
├── routes/          # Express route handlers
├── utils/           # renderAdHtml.js, puppeteerRender.js
├── template-images/ # Ad template reference images
├── example-images/  # Example ad images
├── data/            # Session JSON files, brands.json
├── uploads/         # User-uploaded product images (gitignored)
├── generated/       # Generated ad images (gitignored)
├── brand-images/    # Saved brand ad images (gitignored)
├── nodemon.json     # Nodemon config (watches .js only)
├── server.js        # Entry point
├── .env.example     # Environment variable template
└── package.json
```
