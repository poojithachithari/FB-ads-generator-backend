require('dotenv').config();
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const TONE_VISUAL = {
  'Urgent':         'Fast-paced, high-energy. Strong contrasts, deep shadows, bold accent colours (red, orange). Tight framing that creates pressure. Dynamic angle.',
  'Playful':        'Bright, saturated, joyful palette. Soft natural light or studio with colourful props. Relaxed composition, room to breathe. Smiling subjects or whimsical styling.',
  'Trust-building': 'Clean, calm, neutral palette (whites, soft greens, warm creams). Even diffused lighting, no harsh shadows. Professional but approachable. Order and clarity.',
  'Bold':           'High contrast. Strong geometric composition. Dramatic lighting -- single hard key light or deep shadows. Saturated hero colour against dark or minimal background.',
  'Soft':           'Pastel or muted colour palette. Soft window light or golden hour. Blurred background (shallow depth of field). Warm, intimate, unhurried feel.'
};

const STYLE_COMPOSITION = {
  'Lifestyle photo':  'Real environment -- kitchen counter, bedside table, gym bag, outdoor setting. Human presence or evidence of human use (hands, shadow, lifestyle props). Story-rich context.',
  'Product-only':     'Product is the absolute hero. Minimal or solid background -- white, gradient, or matching brand colour. No people. Ultra-sharp product detail. Studio or controlled light.',
  'Minimal':          'Extreme negative space. One focal point. Maximum 2-3 colours. No clutter. Every element has a clear reason to exist. Feels luxury or editorial.',
  'Bold graphic':     'Graphic-design aesthetic, not photography. Strong geometric shapes, bold blocks of colour, high-contrast typography zone. Almost poster or packaging design quality.',
  'Text-heavy':       'Composition deliberately leaves prominent negative space for copy zones -- upper third for headline, lower third for CTA area. Product still clear but layout supports text overlay.'
};

const GOAL_VISUAL = {
  'Awareness':    'Emotionally evocative, not transactional. The image tells a story or creates a feeling. Recall over click-through.',
  'Traffic':      'High thumb-stopping power. Something visually surprising or aspirational that creates curiosity.',
  'Conversions':  'Product is unmistakable and desirable. Scene communicates the transformation or result. The benefit is visually obvious within 1 second.',
  'Retargeting':  'Familiar but fresh. Product should feel like a reminder of something desirable. High quality, confident.'
};

// ── Split-layout detection (mirrors renderAdHtml.js logic) ────────────────────
function detectSplitSide(zones) {
  var textTypes = ['headline','subheadline','body','cta','checklist','badge','price','rating'];
  var textZones = (zones || []).filter(function(z) { return textTypes.indexOf(z.type) !== -1; });
  if (textZones.length < 2) return null;
  var rightCount = textZones.filter(function(z) { return (z.position||'').toLowerCase().includes('right'); }).length;
  var leftCount  = textZones.filter(function(z) { return (z.position||'').toLowerCase().includes('left');  }).length;
  var ratio = textZones.length;
  if (rightCount >= Math.ceil(ratio * 0.6)) return 'right';
  if (leftCount  >= Math.ceil(ratio * 0.6)) return 'left';
  return null;
}

// ── Layout hints based on detected overlay zones ──────────────────────────────
function buildOverlayLayoutHints(templateAnalysis) {
  if (!templateAnalysis || !templateAnalysis.textZones) return '';
  const zones = templateAnalysis.textZones || [];
  const hints = [];

  // ── Detect split-panel layout first ──────────────────────
  const splitSide = detectSplitSide(zones);
  if (splitSide) {
    const productSide = splitSide === 'right' ? 'LEFT' : 'RIGHT';
    const cleanSide   = splitSide === 'right' ? 'RIGHT' : 'LEFT';
    hints.push(
      'SPLIT-PANEL LAYOUT: This is a split-composition ad. ' +
      'Place the product hero entirely on the ' + productSide + ' half of the frame (0%–50% horizontal). ' +
      'The ' + cleanSide + ' half must be a very clean, light, softly-lit area with minimal texture — ' +
      'a smooth gradient, soft natural light spill, or a pale neutral background. ' +
      'NO text, no objects, no busy detail on the ' + cleanSide + ' side. ' +
      'The product should not cross the vertical center line.'
    );
    // Return early — skip standard per-zone hints which conflict with split layout
    return '\n\nCOMPOSITION REQUIREMENTS (these UI elements will be overlaid -- reserve space):\n' + hints.join('\n');
  }

  zones.forEach(function(zone) {
    const pos = (zone.position || '').toLowerCase();
    if (zone.type === 'testimonial_card') {
      hints.push('COMPOSITION RULE: Leave the bottom 28% of the frame naturally uncluttered -- a white rounded testimonial card will be placed there in post. Do NOT render any card, text, or boxes in that zone.');
    }
    if (zone.type === 'checklist') {
      if (pos.includes('right')) {
        hints.push('COMPOSITION RULE: Keep the right 38% of the frame slightly less busy/lighter so a checklist overlay is legible. Do NOT render any list in the image.');
      } else if (pos.includes('left')) {
        hints.push('COMPOSITION RULE: Keep the left 38% of the frame slightly less busy/lighter so a checklist overlay is legible. Do NOT render any list in the image.');
      } else {
        hints.push('COMPOSITION RULE: Leave a calm central zone for a checklist overlay. Do NOT render any list in the image.');
      }
    }
    if (zone.type === 'arrow_callout' || zone.type === 'stat_box') {
      hints.push('COMPOSITION RULE: Place the product CENTRALLY in the frame. Leave clear open space on BOTH the left and right sides of the product -- white or very soft-toned areas. Stat/callout boxes will be overlaid on both sides pointing at the product. Do NOT render any boxes, labels, or arrows in the image.');
    }
    if (zone.type === 'headline') {
      if (pos.includes('top') || pos.includes('upper')) {
        hints.push('COMPOSITION RULE: Upper area must have a naturally high-contrast zone (dark surface, shadow, or muted sky) for white headline text legibility.');
      }
    }
  });

  // Universal product placement rule — always enforced so overlaid text never lands on the product.
  hints.push(
    'CRITICAL PRODUCT PLACEMENT RULE: The product must occupy ONLY the CENTER vertical band of the frame (roughly 35%–78% from top). ' +
    'The top 32% must be clear of the product (reserved for headline and subheadline text). ' +
    'The bottom 24% must be completely clear of the product (reserved for star rating and CTA button). ' +
    'No part of the product label, logo, or packaging should extend into the top 32% or bottom 24% zones.'
  );

  return hints.length ? '\n\nCOMPOSITION REQUIREMENTS (these UI elements will be overlaid -- reserve space):\n' + hints.join('\n') : '';
}

function buildExampleAnalysis(examples) {
  if (!examples.length) return '';
  const list = examples.map(function(ex, i) {
    const label = ex.label ? ' (' + ex.label + ')' : '';
    return '--- EXAMPLE ' + (i + 1) + label + ' ---\n' + ex.prompt;
  }).join('\n\n');

  return [
    '',
    'STEP 1 - STUDY YOUR TRAINING EXAMPLES',
    'Extract their vocabulary, specificity, sentence structure, and visual register. Match it exactly.',
    '',
    'REFERENCE PROMPTS:',
    list,
    '--- END OF EXAMPLES ---',
    ''
  ].join('\n');
}

// hasTemplate=true means visual style section is suppressed -- template overrides it entirely
function buildBriefAnalysis(brief, concept, hasProductImage, hasTemplate) {
  const tonesArr = Array.isArray(brief.toneOfVoice)
    ? brief.toneOfVoice
    : (brief.toneOfVoice ? brief.toneOfVoice.split(',').map(function(t) { return t.trim(); }) : []);

  const toneVisuals = tonesArr
    .map(function(t) { return TONE_VISUAL[t] ? '  - ' + t + ' -> ' + TONE_VISUAL[t] : '  - ' + t; })
    .join('\n');

  const goalVisual = GOAL_VISUAL[brief.adGoal] || 'Goal: ' + brief.adGoal;

  const angleLogic = {
    'Social Proof':     '  -> Show evidence of use, community, results.',
    'Urgency':          '  -> Tight, intense framing. Energy and motion.',
    'Problem-Solution': '  -> Show the "after" state -- relief, comfort, resolution.',
    'FOMO':             '  -> Aspirational scene. Others are enjoying this.',
    'Transformation':   '  -> Confidence, energy, glow, achievement.',
    'Curiosity':        '  -> Something unexpected or partially revealed that demands attention.',
    'How-To':           '  -> Product in active use. Educational but aspirational.',
    'Authority':        '  -> Polished, professional, precise. Signals expertise.'
  };

  const lines = [
    '',
    'STEP 2 - BRIEF CONTEXT',
    '',
    'Brand: ' + (brief.brandName || ''),
    'Product/Offer: ' + (brief.productOffer || ''),
    'Target Audience: ' + (brief.targetAudience || ''),
    'Ad Goal: ' + (brief.adGoal || ''),
    'Creative Angle: ' + (concept.creative_angle || ''),
    'Headline: "' + (concept.headline || '') + '"',
    '',
    'TONE -- translate into lighting/mood only (composition is set by template above):',
    toneVisuals || ('  - ' + (brief.toneOfVoice || 'Professional')),
  ];

  // Only include visual style guidance when there's NO template -- otherwise template defines it
  if (!hasTemplate) {
    const stylesArr = Array.isArray(brief.visualStyle)
      ? brief.visualStyle
      : (brief.visualStyle ? brief.visualStyle.split(',').map(function(s) { return s.trim(); }) : []);
    const styleComps = stylesArr
      .map(function(s) { return STYLE_COMPOSITION[s] ? '  - ' + s + ' -> ' + STYLE_COMPOSITION[s] : '  - ' + s; })
      .join('\n');
    lines.push('', 'VISUAL STYLE -- translate into composition:', styleComps || ('  - ' + (brief.visualStyle || 'Not specified')));
  }

  lines.push(
    '',
    'GOAL -- visual storytelling intent:',
    goalVisual,
    '',
    'CREATIVE ANGLE VISUAL LOGIC:',
    '  "' + concept.creative_angle + '":',
    angleLogic[concept.creative_angle] || ''
  );

  if (brief.additionalNotes) {
    lines.push('', 'MANDATORY CONSTRAINTS:', '  ' + brief.additionalNotes);
  }
  if (hasProductImage) {
    lines.push('', 'PRODUCT IMAGE UPLOADED:', '  Place it as the clear visual hero -- specify position, lighting relative to environment, and interaction with surrounding elements.');
  }
  lines.push('', 'Visual description from concept (use as inspiration):', '  "' + (concept.visual_description || '') + '"', '');

  return lines.join('\n');
}

function buildSystemPrompt(style) {
  const formatNote = style === 'editorial'
    ? 'Open with: "Facebook/Instagram ad, editorial photography style."'
    : 'Open with: "Facebook/Instagram ad, professional photography."';

  return [
    'You are a world-class AI image prompt engineer for social media ad creatives.',
    '',
    'Rules:',
    '  1. When a TEMPLATE STYLE is given: it is the ABSOLUTE visual blueprint. Match it precisely -- background, lighting, composition, product position. The brief tone only adjusts mood/colour within that blueprint.',
    '  2. When NO template: build the scene from the brief.',
    '  3. Obey every COMPOSITION REQUIREMENT listed.',
    '  4. Be hyper-specific: exact light sources, colours, spatial arrangement, lens character, depth of field, textures.',
    '  5. Zero text, zero cards, zero lists, zero arrows, zero UI elements in the image -- all overlaid separately.',
    '  6. Never use vague adjectives: "beautiful", "amazing", "stunning".',
    '  7. ' + formatNote,
    '  8. End with: "Photorealistic. Ultra high resolution."',
    '  9. Output ONLY the prompt -- no explanation, no preamble.'
  ].join('\n');
}

function buildUserMessage(concept, brief, hasProductImage, style, examples, templateStyle, templateAnalysis) {
  const hasTemplate   = !!templateStyle;
  const exampleBlock  = buildExampleAnalysis(examples);
  const briefBlock    = buildBriefAnalysis(brief, concept, hasProductImage, hasTemplate);
  const layoutHints   = buildOverlayLayoutHints(templateAnalysis);

  const templateBlock = templateStyle
    ? [
        '',
        '══ TEMPLATE STYLE -- ABSOLUTE VISUAL BLUEPRINT ══',
        'IMPORTANT: This template\'s visual style completely overrides the brief\'s visual style preference.',
        'Recreate ONLY the background scene. Do NOT include any text, cards, lists, arrows, or UI elements in the image.',
        '',
        templateStyle,
        layoutHints,
        ''
      ].join('\n')
    : '';

  const toneStr  = Array.isArray(brief.toneOfVoice) ? brief.toneOfVoice.join(' + ') : (brief.toneOfVoice || '');

  const step3 = [
    '',
    'STEP 3 -- WRITE THE PROMPT',
    '',
    'Write one richly detailed image generation prompt that:',
    hasTemplate ? '  - PRECISELY replicates the template visual blueprint above (highest priority)' : '',
    hasTemplate ? '  - Applies the tone (' + toneStr + ') only as mood/lighting adjustment within the template layout' : '  - Visually reflects the tone: ' + toneStr,
    '  - Obeys ALL composition requirements',
    '  - Contains ZERO text, ZERO cards, ZERO lists, ZERO arrows painted into the image',
    '  - Makes the product hero: ' + brief.productOffer,
    '',
    'Slot direction: ' + (style === 'editorial'
      ? 'EDITORIAL -- bold, graphic, high-contrast, magazine aesthetic'
      : 'CINEMATIC -- atmospheric, immersive, lighting-rich'),
    '',
    'Write the prompt now:'
  ].filter(Boolean).join('\n');

  return exampleBlock + briefBlock + templateBlock + step3;
}

async function tryGpt(userMsg, systemPrompt) {
  const models = ['gpt-4o', 'gpt-4o-mini'];
  for (const model of models) {
    try {
      const r = await openai.chat.completions.create({
        model,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMsg }
        ]
      });
      console.log('[generatePrompts] GPT succeeded: ' + model);
      return r.choices[0].message.content.trim();
    } catch (err) {
      const code = err && (err.status || (err.response && err.response.status));
      console.warn('[generatePrompts] GPT ' + model + ' failed (' + code + '): ' + err.message);
      if (code !== 402 && code !== 429 && code !== 404 && code !== 403) throw err;
    }
  }
  throw new Error('No GPT model available');
}


router.post('/', async (req, res) => {
  try {
    const { brief, concept, hasProductImage, templateAnalysis } = req.body;
    if (!brief || !concept) {
      return res.status(400).json({ error: 'brief and concepts array are required' });
    }

    const hasTemplate = !!(templateAnalysis && templateAnalysis.promptInstruction);
    const effectiveTemplateStyle = hasTemplate ? templateAnalysis.promptInstruction : null;
    const layoutHints  = buildOverlayLayoutHints(templateAnalysis);
    const examples     = loadExamplePrompts();
    const exampleBlock = buildExampleAnalysis(examples);
    const briefAnalysis = buildBriefAnalysis(brief, concept, hasProductImage, hasTemplate);
    const combinedContext = briefAnalysis + layoutHints;

    const claudeSystemPrompt = buildSystemPrompt(exampleBlock ? 'editorial' : 'standard');
    const claudeUserMsg = buildUserMessage(concept, brief, hasProductImage, combinedContext, examples, effectiveTemplateStyle, templateAnalysis);

    const gptSystemPrompt = buildSystemPrompt('gpt');
    const gptUserMsg = buildUserMessage(concept, brief, hasProductImage, combinedContext, [], effectiveTemplateStyle, templateAnalysis);

    // Slot 1: Claude editorial prompt
    const claudeCall = anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: claudeSystemPrompt,
      messages: [{ role: 'user', content: claudeUserMsg }]
    }).then(function(r) { return r.content[0].text.trim(); });

    // Slot 2: GPT cinematic — falls back to second Claude call with different style
    const slot2Call = tryGpt(gptUserMsg, gptSystemPrompt).catch(function() {
      console.log('[generatePrompts] GPT unavailable, using Claude cinematic fallback');
      const cinematicSystem = buildSystemPrompt('cinematic');
      const cinematicMsg = buildUserMessage(concept, brief, hasProductImage, combinedContext, [], effectiveTemplateStyle, templateAnalysis);
      return anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: cinematicSystem,
        messages: [{ role: 'user', content: cinematicMsg }]
      }).then(function(r) { return r.content[0].text.trim(); });
    });

    const [claudeResult, slot2Result] = await Promise.allSettled([claudeCall, slot2Call]);

    const claudePrompt = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
    const gptPrompt    = slot2Result.status   === 'fulfilled' ? slot2Result.value  : null;

    res.json({
      claude:      claudePrompt,
      gpt:         gptPrompt,
      claudeError: claudeResult.status === 'rejected' ? claudeResult.reason.message : null,
      gptError:    slot2Result.status   === 'rejected' ? slot2Result.reason.message  : null,
    });
  } catch (err) {
    console.error('[generatePrompts] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
