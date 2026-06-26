require('dotenv').config();
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TEMPLATE_DIR = path.join(__dirname, '../template-images');

function extractJSON(raw) {
  let text = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in vision response');
  text = match[0].replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(text);
}

router.post('/', async (req, res) => {
  try {
    const { imageUrl, templateName } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

    const filename = path.basename(imageUrl);
    const filePath = path.join(TEMPLATE_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Template image not found on server' });
    }

    const imageData   = fs.readFileSync(filePath);
    const base64Image = imageData.toString('base64');

    // Detect actual format from magic bytes (not extension — files may be mislabeled)
    function detectMediaType(buf) {
      if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';           // JPEG
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'; // PNG
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp'; // WEBP
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'; // GIF
      const ext = path.extname(filename).toLowerCase();
      return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
           : ext === '.webp' ? 'image/webp'
           : 'image/png';
    }
    const mediaType = detectMediaType(imageData);

    const systemPrompt = `You are an expert Facebook/Instagram ad creative analyst and AI image prompt engineer.
Your job is to deeply analyze ad template images and extract everything needed to:
1. Generate ad copy that fits the template's content structure
2. Recreate the template's visual style with a different product

Be precise and specific. Your analysis directly drives an AI image generation system.`;

    const userPrompt = `Analyze this Facebook/Instagram ad template image${templateName ? ' named "' + templateName + '"' : ''}.

Return a JSON object with EXACTLY this structure:

{
  "templateType": "Short label e.g. 'Product Editorial', 'Lifestyle UGC', 'Before-After', 'Quote Testimonial', 'Bold Graphic', 'Checklist', 'Arrow Callout', 'Testimonial Card'",
  "visualStyle": "Detailed description of the photography/design style: composition layout, background, lighting, colour palette, props, mood, depth of field.",
  "hasTextOverlays": true or false,
  "textZones": [
    {
      "position": "top-center, upper-right, center-right, bottom-center, lower-center, etc.",
      "type": "One of: badge | headline | subheadline | body | cta | price | logo | rating | testimonial_card | checklist | arrow_callout | stat_box | pill_tag_row",
      "typographyStyle": "e.g. 'bold uppercase sans-serif, white on dark green pill background'",
      "approximateContent": "What the text/element says or contains in this template",
      "purpose": "Why this element exists -- credibility, value prop, CTA, social proof, feature list, etc.",
      "elementDetails": "null for simple text zones. For complex: { 'itemCount': N, 'layout': 'horizontal' or 'vertical' } for checklist ('horizontal' = items sit side-by-side in a row like pill tags, 'vertical' = items stacked in a column), { 'calloutCount': N } for arrow_callout, { 'hasStars': true, 'starCount': 5, 'hasQuote': true, 'hasAttribution': true, 'hasCta': true } for testimonial_card"
    }
  ],
  "contentRequirements": {
    "badge": "describe or null",
    "headline": "describe headline style and ideal length or null",
    "subheadline": "describe or null",
    "body": "describe or null",
    "cta": "describe CTA style and length or null",
    "checklist": "describe item style, count, and purpose or null",
    "testimonial": "describe quote length, tone, attribution style or null",
    "callouts": "describe label style and count or null",
    "other": "any other content requirement or null"
  },
  "recommendedAngle": "ONE of: Social Proof | Urgency | Problem-Solution | FOMO | Transformation | Curiosity | How-To | Authority",
  "angleReason": "One sentence explaining why this angle fits the template",
  "promptInstruction": "150-250 word image generation prompt describing how to recreate this template's visual style with a different product. Include background, lighting, composition, colour palette, product placement, camera angle. Start with the scene type."
}

ZONE TYPE GUIDE:
- headline/subheadline/body/cta/badge/price: simple text zones
- testimonial_card: white/light rounded card with stars, customer quote, attribution, optional CTA -- treat whole card as ONE zone
- checklist: list of 3-6 items with checkmarks, usually on a clear area of the image
- arrow_callout: pill/label annotations with thin lines pointing at product parts
- stat_box: box highlighting a key number/statistic
- pill_tag_row: horizontal row of small pill tags

Return ONLY valid JSON. No markdown, no explanation.`;

    console.log('[analyzeTemplate] Analyzing:', filename, templateName || '', '| mediaType:', mediaType);

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: userPrompt }
        ]
      }]
    });

    const analysis = extractJSON(r.content[0].text);
    console.log('[analyzeTemplate] Done:', analysis.templateType, '| hasText:', analysis.hasTextOverlays, '| angle:', analysis.recommendedAngle);

    res.json(analysis);
  } catch (err) {
    console.error('[analyzeTemplate] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
