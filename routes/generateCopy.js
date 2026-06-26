require('dotenv').config();
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function extractJSON(raw) {
  let text = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI response did not contain valid JSON. Please try again.');
  text = match[0]
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/,\s*([\]}])/g, '$1');
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('[generateCopy] JSON parse failed. Snippet:', text.slice(0, 500));
    throw new Error('The AI returned malformed data. Please try generating again.');
  }
}

function loadExamplePrompts() {
  try {
    const filePath = path.join(__dirname, '../data/example-prompts.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data.filter(function(e) { return e.prompt && e.prompt.trim(); }) : [];
    }
  } catch (_) {}
  return [];
}

const TONE_GUIDANCE = {
  'Urgent':         'Use time pressure, scarcity signals, and action-forcing language. Short punchy sentences.',
  'Playful':        'Use wit, light humour, and conversational warmth. Contractions, casual phrasing.',
  'Trust-building': 'Lead with credibility -- statistics, guarantees, expert backing. Reassuring and measured.',
  'Bold':           'Confident, direct, zero hedging. Make a big claim and own it. No qualifiers.',
  'Soft':           'Gentle, empathetic, emotionally resonant. Warm adjectives, nurturing language.'
};

const STYLE_GUIDANCE = {
  'Lifestyle photo': 'Show product being used by real people. Natural light, authentic moments.',
  'Product-only':    'Hero shot of the product. Clean background. No people.',
  'Minimal':         'Extreme white space, one focal element, refined colour palette.',
  'Bold graphic':    'High contrast, saturated colours, strong geometric shapes.',
  'Text-heavy':      'Composition leaves clear zones for headline, body, CTA.'
};

const GOAL_GUIDANCE = {
  'Awareness':   'Goal is recognition. Copy educates and intrigues. CTA can be soft.',
  'Traffic':     'Goal is the click. Headline must create curiosity strong enough to stop scrolling.',
  'Conversions': 'Goal is purchase/sign-up. Address the key objection, make next step obvious.',
  'Retargeting': 'Audience knows the brand. Speak to the specific reason they did not convert.'
};

function detectRichZones(textZones) {
  const zones = textZones || [];
  const arrowZone   = zones.find(function(z) { return z.type === 'arrow_callout'; });
  const statZone    = zones.find(function(z) { return z.type === 'stat_box'; });
  const checkZone   = zones.find(function(z) { return z.type === 'checklist'; });
  const calloutZone = arrowZone || statZone;
  return {
    hasChecklist:    !!checkZone,
    hasTestimonial:  zones.some(function(z) { return z.type === 'testimonial_card'; }),
    hasArrowCallout: !!calloutZone,
    hasRating:       zones.some(function(z) { return z.type === 'rating'; }),
    calloutCount:    (calloutZone && calloutZone.elementDetails && calloutZone.elementDetails.calloutCount) || 4,
    checklistCount:  (checkZone  && checkZone.elementDetails  && checkZone.elementDetails.itemCount)  || 5,
  };
}

router.post('/', async (req, res) => {
  try {
    const { brief, sessionId, templateAnalysis, hasProductImage } = req.body;
    if (!brief) return res.status(400).json({ error: 'brief is required' });

    const { brandName, productOffer, targetAudience, adGoal, toneOfVoice, visualStyle, additionalNotes } = brief;

    const tonesArr  = Array.isArray(toneOfVoice) ? toneOfVoice : (toneOfVoice ? [toneOfVoice] : []);
    const stylesArr = Array.isArray(visualStyle)  ? visualStyle  : (visualStyle  ? [visualStyle]  : []);
    const tones     = tonesArr.join(', ');
    const styles    = stylesArr.join(', ');
    const toneGuide  = tonesArr.map(function(t) { return TONE_GUIDANCE[t] ? '  - ' + t + ': ' + TONE_GUIDANCE[t] : '  - ' + t; }).join('\n');
    const styleGuide = stylesArr.map(function(s) { return STYLE_GUIDANCE[s] ? '  - ' + s + ': ' + STYLE_GUIDANCE[s] : '  - ' + s; }).join('\n');
    const goalGuide  = GOAL_GUIDANCE[adGoal] || ('Goal is ' + adGoal + '.');

    const textZones = (templateAnalysis && templateAnalysis.textZones) || [];
    const rich = detectRichZones(textZones);

    let templateBlock = '';
    if (templateAnalysis) {
      const templateType      = templateAnalysis.templateType || 'Unknown';
      const contentReqs       = templateAnalysis.contentRequirements || {};
      const recommendedAngle  = templateAnalysis.recommendedAngle || 'Any';
      const angleReason       = templateAnalysis.angleReason || '';
      const tvStyle           = templateAnalysis.visualStyle || '';

      const textZoneDesc = textZones.length > 0
        ? textZones.map(function(z) { return '    - ' + z.type.toUpperCase() + ' (' + z.position + '): ' + (z.typographyStyle || '') + ' -- ' + (z.purpose || ''); }).join('\n')
        : '    None detected';

      const contentReqDesc = Object.entries(contentReqs)
        .filter(function(entry) { return entry[1] && entry[1] !== 'null'; })
        .map(function(entry) { return '    - ' + entry[0] + ': ' + entry[1]; })
        .join('\n') || '    Match the visual ad style';

      templateBlock = '\nTEMPLATE ANALYSIS:\nType: ' + templateType + ' | Style: ' + tvStyle + '\nText zones:\n' + textZoneDesc + '\nContent requirements:\n' + contentReqDesc + '\nRecommended angle: ' + recommendedAngle + (angleReason ? ' -- ' + angleReason : '') + '\n';
    }

    let richBlock = '';
    if (rich.hasChecklist) {
      richBlock += '\nCHECKLIST ITEMS -- Generate exactly ' + rich.checklistCount + ' short benefit phrases (max 4 words each) for a checkmark list on the image. Speak to ' + targetAudience + ' pain points. Parallel structure. Examples: "No fillers", "Clinically tested", "Planet-friendly"\n';
    }
    if (rich.hasTestimonial) {
      richBlock += '\nTESTIMONIAL -- Generate:\n  - quote: max 65 chars, first person, specific, emotional.\n  - attribution: e.g. "Verified ' + brandName + ' customer"\n  - stars: 5\n';
    }
    if (rich.hasArrowCallout) {
      richBlock += '\nCALLOUT LABELS -- Generate exactly ' + rich.calloutCount + ' ultra-short product feature labels (max 3 words each, noun phrases).\n';
    }
    if (rich.hasRating) {
      richBlock += '\nRATING TEXT -- Generate a single short social-proof rating string (max 30 chars). Format: star symbols + review count or score. Examples: "★★★★★ 10,000+ Reviews", "★★★★☆ 4.8 · Loved by thousands", "★★★★★ 500+ Happy Customers". Make it believable and specific to ' + brandName + '.\n';
    }

    const examples = loadExamplePrompts();
    const exampleSection = examples.length > 0
      ? '\n\nSTYLE REFERENCE:\n' + examples.map(function(ex, i) { return '--- Example ' + (i+1) + ' ---\n' + ex.prompt; }).join('\n\n') + '\n---'
      : '';

    const systemPrompt = 'You are a senior Facebook/Instagram ad creative director. You generate copy OPTIONS (3 per zone) so advertisers can mix and match. Each option must be distinct in hook/angle and tone-accurate.\n\nSTRICT COPY RULES:\n- Headlines and subheadlines must contain ZERO star or rating symbols (★ ⭐ ☆ ✦). Stars only belong in the rating_text field.\n- Headlines must be plain text — no emoji except standard punctuation.\n- Rating text goes ONLY in the "rating_text" field.' + exampleSection + '\n\nOutput: ONLY raw valid JSON -- no markdown fences, no trailing commas. Start with { end with }.';

    let extraFields = '';
    if (rich.hasChecklist)    extraFields += '\n  "checklist_items": ["Phrase 1", "Phrase 2", "Phrase 3", "Phrase 4", "Phrase 5"],';
    if (rich.hasTestimonial)  extraFields += '\n  "testimonial": {"quote": "Customer quote.", "attribution": "Verified ' + brandName + ' customer", "stars": 5},';
    if (rich.hasArrowCallout) extraFields += '\n  "callout_labels": ["Label 1", "Label 2", "Label 3"],';
    if (rich.hasRating)       extraFields += '\n  "rating_text": "★★★★★ 500+ Reviews",';


    const userPrompt = 'Generate 3 mix-and-match copy options per zone for this campaign.\n\nBRIEF:\nBrand: ' + brandName + '\nProduct/Offer: ' + productOffer + '\nTarget Audience: ' + targetAudience + '\nAd Goal: ' + adGoal + '\n\nGOAL: ' + goalGuide + '\nTONE (' + (tones || 'Professional') + '):\n' + (toneGuide || '  - ' + tones) + '\nVISUAL STYLE (' + styles + '):\n' + (styleGuide || '  - ' + styles) + (additionalNotes ? '\nCONSTRAINTS:\n' + additionalNotes : '') + (hasProductImage ? '\nPRODUCT IMAGE: Advertiser uploaded their product photo. visual_description must feature it.' : '') + '\n' + templateBlock + (richBlock ? '\nRICH ELEMENT GENERATION REQUIRED:' + richBlock : '') + '\nGENERATE EXACTLY:\n\nHEADLINES -- 3 options, max 40 chars each, each with a DIFFERENT hook angle. Plain text only — NO star or emoji characters\n\nSUBHEADLINES -- 3 options, max 100 chars each\n\nCTA BUTTONS -- 3 options, 2-4 words max\n\nCREATIVE ANGLE -- pick ONE: Social Proof / Urgency / Problem-Solution / FOMO / Transformation / Curiosity / How-To / Authority\n\nVISUAL DESCRIPTION -- 2-3 sentences, BACKGROUND SCENE only (no text in image).\n\nReturn ONLY:\n{\n  "creative_angle": "Authority",\n  "angle_rationale": "One sentence why this fits.",\n  "visual_description": "2-3 sentences describing the background scene.",\n  "headlines": ["Option 1", "Option 2", "Option 3"],\n  "subheadlines": ["Option 1", "Option 2", "Option 3"],\n  "ctas": ["CTA 1", "CTA 2", "CTA 3"]' + extraFields + '\n}';

    console.log('[generateCopy] Brand: ' + brandName + ' | Goal: ' + adGoal);

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const parsed = extractJSON(r.content[0].text);

    if (!Array.isArray(parsed.headlines) || !Array.isArray(parsed.ctas)) {
      throw new Error('AI returned unexpected format. Please try generating again.');
    }

    if (sessionId) {
      try {
        const sessionPath = path.join(__dirname, '../data/' + sessionId + '.json');
         if (fs.existsSync(sessionPath)) {
          const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
          session.copyOptions = parsed;
          fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
        }
      } catch (_) {}
    }

    res.json(parsed);
  } catch (err) {
    console.error('[generateCopy] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
