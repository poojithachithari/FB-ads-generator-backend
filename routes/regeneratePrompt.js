require('dotenv').config();
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', async (req, res) => {
  try {
    const {
      currentPrompt,
      headline,
      primaryText,
      creativeAngle,
      brandName,
      tone,
      visualStyle,
      hasProductImage,
      instruction // optional: user's specific instruction e.g. "make it more minimalist"
    } = req.body;

    const systemPrompt = `You are an expert AI image prompt engineer specialising in Facebook and Instagram ad creatives.
Your job is to write highly detailed, vivid image generation prompts that produce stunning ad visuals.

Rules:
- Always start with: "Facebook/Instagram feed ad image, square 1:1 format, high-quality professional photography."
- Be extremely specific about: lighting (direction, colour, quality), colours, textures, setting, mood, composition
- Mention camera angle and depth of field where relevant
- Avoid generic phrases like "beautiful", "amazing", "person smiling"
- Always end with: "No text overlays. No watermarks. Clean composition. Photorealistic."
- Output ONLY the prompt — no explanation, no preamble, no quotes`;

    const userMessage = `Rewrite this image prompt for a Facebook ad.

Brand: ${brandName || ''}
Creative angle: ${creativeAngle || ''}
Headline: ${headline || ''}
Ad copy: ${primaryText || ''}
Tone: ${tone || ''}
Visual style: ${visualStyle || ''}
${hasProductImage ? 'Note: The user has uploaded a real product photo — describe a composition that prominently features their product bottle/packaging in the foreground.' : ''}
${instruction ? `User's instruction: ${instruction}` : ''}

Current prompt:
${currentPrompt}

Write an improved, more detailed and visually specific version of this prompt. Make it richer and more cinematic while staying true to the brand and creative angle.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const newPrompt = message.content[0].text.trim();
    res.json({ prompt: newPrompt });
  } catch (err) {
    console.error('regeneratePrompt error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
