/**
 * RWBY Scene Multi-Gen Backend Script
 * 
 * Direct narrative Danbooru extractor & NovelAI generator.
 * True context awareness: scores specific scene contexts, locations,
 * outfits, emotions, weapons, and explicit NSFW positions.
 */

let CONFIG = {
  imageCount: 2,        // 1 to 4 images
  allowNsfw: true,      // true allows explicit intimate/spicy tags
  aspectRatio: '832x1216',
  steps: 28,
  guidance: 5.0,
};

const BASE_STYLE_POSITIVE =
  'masterpiece, best quality, very aesthetic, absurdres, rwby, gradient hair, shiny hair, detailed hair, detailed skin, rim light, backlighting';

const BASE_STYLE_NEGATIVE_SFW =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, sweat, sweaty skin, shiny skin, oily skin, glossy skin, nsfw, nude, explicit';

const BASE_STYLE_NEGATIVE_NSFW =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, shiny skin, oily skin, glossy skin, bad anatomy, deformed';

// CHARACTER DICTIONARY
const CHARACTERS = {
  yang: {
    regex: /\byang\b|xiao long/i,
    tags: 'yang xiao long, blonde hair, long hair, orange hair, purple eyes, ahoge, tan jacket, crop top, fingerless gloves, yellow theme',
  },
  blake: {
    regex: /\bblake\b|belladonna/i,
    tags: 'blake belladonna, black hair, long hair, purple hair, cat ears, animal ears, amber eyes, black ribbon, white sleeveless shirt, purple theme',
  },
  weiss: {
    regex: /\bweiss\b|schnee/i,
    tags: 'weiss schnee, white hair, light blue hair, side ponytail, hair ornament, tiara, earrings, blue eyes, scar over eye, white dress, bolero, blue theme',
  },
  ruby: {
    regex: /\bruby\b|rose/i,
    tags: 'ruby rose, black hair, red hair, short hair, silver eyes, red cloak, black dress, cross necklace, rose theme',
  },
  coco: {
    regex: /\bcoco\b|adel/i,
    tags: 'coco adel, brown hair, short hair, beret, sunglasses, tinted sunglasses, round eyewear, brown eyes, necklace, scarf, brown jacket, brown theme',
  },
  nora: {
    regex: /\bnora\b|valkyrie/i,
    tags: 'nora valkyrie, orange hair, short hair, turquoise eyes, pink theme',
  },
  pyrrha: {
    regex: /\bpyrrha\b|nikos/i,
    tags: 'pyrrha nikos, red hair, long ponytail, green eyes, gold circlet, armor, red theme',
  },
};

// CATEGORIZED SCENE CONTEXT RULES
const SCENE_RULES = [
  // 1. Explicit Sexual / NSFW (Highest specific priority when intimate words are physically happening)
  {
    regex: /reverse cowgirl|riding reverse|facing away.*riding|rode him reverse/i,
    nsfwOnly: true,
    tags: 'bedroom, reverse cowgirl position, straddling, from behind, looking back, arched back, buttocks, nude, passionate expression, dim lamplight',
  },
  {
    regex: /against the wall|pinned to the wall|wall.*bouncing|wall.*downstroke/i,
    nsfwOnly: true,
    tags: 'against wall, legs wrapped around waist, carried, standing sex, passionate kiss, clenching, flushed skin, dim room lighting',
  },
  {
    regex: /doggystyle|from behind.*hips|hands and knees.*thrust/i,
    nsfwOnly: true,
    tags: 'bedroom, doggystyle, from behind, on all fours, arched back, grabbed hips, nude, flushed face, panting, bed',
  },
  {
    regex: /cowgirl|straddling.*hips|riding him|riding you/i,
    nsfwOnly: true,
    tags: 'bedroom, cowgirl position, straddling, on top, bouncing, breasts, nude, heavy blush, open mouth, passionate, dim lighting',
  },
  {
    regex: /spooning.*knot|slow.*grind|curled together.*knot/i,
    nsfwOnly: true,
    tags: 'bedroom, spooning, side-by-side, intimate embrace, slow grind, holding hands, tangled sheets, sweat, warm morning light, tender expression',
  },
  {
    regex: /blowjob|fellatio|sinking down his length|throat.*swallow/i,
    nsfwOnly: true,
    tags: 'bedroom, fellatio, oral, looking up at viewer, parted lips, blush, messy hair, kneeling, saliva, intimate, lamplight',
  },
  {
    regex: /afterglow.*nude|naked.*sheets|tangled in bed.*sweat/i,
    nsfwOnly: true,
    tags: 'bedroom, lying on bed, afterglow, messy sheets, exhausted, relaxed, sweet smile, gentle blush, peaceful, soft morning sunlight',
  },

  // 2. Domestic, Comedy, Food, Romance Novels (Dormitory Life)
  {
    regex: /adobo|glazed pork|pork belly|holding.*fork|eating.*meat|steaming.*bowl|food.*delicious/i,
    tags: 'indoor, dorm room, eating, holding fork, delicious food, savory bowl, happy expression, laughing, relaxed, warm ambient lighting',
  },
  {
    regex: /romance novel|paperback|hearts across the shattered moon|reading.*bed|reading.*cushion|dust jacket.*novel/i,
    tags: 'sitting at desk, holding book, reading, secret, blushing, flustered, window alcove, warm lamp lighting, cozy atmosphere',
  },
  {
    regex: /scramble.*book|hide.*book|trench coat.*novel|cushion.*novel|stashing.*book/i,
    tags: 'dorm room desk, hiding book, flustered expression, blushing, looking over shoulder, guilty, nervous smile, warm lighting',
  },
  {
    regex: /barge in|kicked.*door|lockpick|hairpin|door.*wide open|honey I am home/i,
    tags: 'dorm room doorway, stepping inside, hands on hips, wide smile, energetic pose, teasing expression, bright eyes, indoor lighting',
  },
  {
    regex: /teasing|smug|laughing.*snort|winking|gagahara|lost cause/i,
    tags: 'playful smirk, teasing grin, leaning forward, winking, lively expression, animated pose, warm lighting',
  },
  {
    regex: /scroll.*chat|holographic.*screen|diagram.*manual|reading.*text/i,
    tags: 'holding scroll, holographic screen, glowing blue screen, reading message, surprised expression, indoor',
  },

  // 3. Combat, Sparring, Semblance, Weapons
  {
    regex: /spar.*ring|fencing.*manual|myrtenaster|rapier.*thrust|parry.*blade/i,
    tags: 'combat training hall, holding rapier, fencing stance, dynamic sword pose, fierce gaze, battle ready, motion lines, sharp rim light',
  },
  {
    regex: /gauntlet.*ember celica|shotgun gauntlet|brawler.*punch/i,
    tags: 'combat arena, shotgun gauntlets, ready stance, fiery aura, confident smirk, explosive motion, dramatic lighting',
  },
  {
    regex: /glyph.*circle|ice dust|gravity dust|dust crystal|semblance.*burst/i,
    tags: 'summoning glyph, glowing magical circle beneath feet, ice particles, elemental sparks, dynamic action pose, intense lighting',
  },
  {
    regex: /arena.*plates|training ring.*chalk|training wing/i,
    tags: 'indoor arena, high ceiling, metallic training plates, chalk lines, athletic posture, focused gaze, fluorescent lighting',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanMessage(content) {
  if (typeof content !== 'string') return '';
  return content
    .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '')
    .replace(/<scene_plan[\s\S]*?<\/scene_plan>/gi, '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/<scenecard[\s\S]*?<\/scenecard>/gi, '')
    .replace(/<adventurecard[\s\S]*?<\/adventurecard>/gi, '')
    .replace(/<internal_states[\s\S]*?<\/internal_states>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

try {
  spindle.registerInterceptor(async (messages) => {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        const cleaned = m.content
          .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
          .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '')
          .trim();
        return cleaned === m.content ? m : { ...m, content: cleaned };
      }
      return m;
    });
  });
} catch (e) {
  spindle.log.warn('Could not register interceptor:', e);
}

function bakeImagesMidChat(content, imageMarkupList) {
  if (!imageMarkupList || imageMarkupList.length === 0) return content;
  const sep = content.includes('\r\n') ? '\r\n\r\n' : '\n\n';
  const paragraphs = content.split(/\r?\n\s*\r?\n/);
  if (paragraphs.length <= 1) return content + sep + imageMarkupList.join(sep);

  const result = [...paragraphs];
  const step = Math.max(1, Math.floor(paragraphs.length / (imageMarkupList.length + 1)));
  let insertCount = 0;
  for (let i = 0; i < imageMarkupList.length; i++) {
    const slotIdx = Math.min(result.length - 1, (i + 1) * step + insertCount);
    result.splice(slotIdx, 0, imageMarkupList[i]);
    insertCount++;
  }
  return result.join(sep);
}

// Generate image with retry on NovelAI concurrent lock
async function generateWithRetry(genInput, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await spindle.imageGen.generate(genInput);
    } catch (err) {
      const msg = err ? err.message || String(err) : '';
      const isLocked = msg.includes('Concurrent generation is locked') || msg.includes('429');
      if (isLocked && attempt < maxRetries) {
        const delay = attempt * 2000;
        spindle.toast.info(`NovelAI busy, waiting ${delay / 1000}s (try ${attempt}/${maxRetries})...`, { title: 'RWBY Multi-Gen', duration: 2500 });
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

// Extract the active character and accurate scene beats from the narrative prose
function analyzeStoryBeats(content, targetCount, isNsfwAllowed) {
  // 1. Resolve character: check the MOST RECENT sprite tags in the message
  let activeCharKey = 'yang';
  const spriteMatches = [...content.matchAll(/(?:<pimg\s+src=["']|{{image::)([^.]+?)(?:\.|\s*::)/gi)];
  if (spriteMatches.length > 0) {
    const lastSprite = spriteMatches[spriteMatches.length - 1][1].toLowerCase();
    for (const [key, charDef] of Object.entries(CHARACTERS)) {
      if (charDef.regex.test(lastSprite)) {
        activeCharKey = key;
        break;
      }
    }
  } else {
    // Frequency fallback
    let maxCount = -1;
    for (const [key, charDef] of Object.entries(CHARACTERS)) {
      const matchCount = (content.match(new RegExp(charDef.regex.source, 'gi')) || []).length;
      if (matchCount > maxCount) {
        maxCount = matchCount;
        activeCharKey = key;
      }
    }
  }

  const charTags = CHARACTERS[activeCharKey]?.tags || '1girl, solo';

  // 2. Resolve matching scene beats
  const matchedBeats = [];
  for (const rule of SCENE_RULES) {
    if (rule.nsfwOnly && !isNsfwAllowed) continue;
    if (rule.regex.test(content)) {
      matchedBeats.push(rule.tags);
    }
  }

  // 3. Fallbacks matching the active character and setting
  if (matchedBeats.length === 0) {
    matchedBeats.push('standing, smiling, looking at viewer, expressive eyes, indoor, warm soft lighting');
    matchedBeats.push('upper body, dynamic pose, cheerful expression, detailed background, soft lighting');
  }

  while (matchedBeats.length < targetCount) {
    matchedBeats.push(matchedBeats[0] + ', alternate angle, cinematic lighting');
  }

  return {
    characterKey: activeCharKey,
    characterTags: charTags,
    beats: matchedBeats.slice(0, targetCount),
  };
}
const processing = new Set();
let lastKnownUserId = undefined;

async function handleSceneIllustration(chatId, messageId, swipeId = 0, userId = undefined) {
  if (!chatId || !messageId) return;

  const effectiveUserId = userId || lastKnownUserId;
  if (userId) lastKnownUserId = userId;

  const key = `${chatId}:${messageId}:${swipeId}`;
  if (processing.has(key)) return;
  processing.add(key);

  try {
    const messages = await spindle.chat.getMessages(chatId, effectiveUserId ? { userId: effectiveUserId } : undefined);
    const message = (messages || []).find((m) => m.id === messageId);
    if (!message || message.role !== 'assistant') return;

    let content = message.content || '';
    if (Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
      content = message.swipes[swipeId];
    }
    if (!content || content.trim().length === 0) return;

    if (content.includes('rwby_multigen') || content.includes('pimage-container')) {
      return;
    }

    const count = Math.max(1, Math.min(4, Number(CONFIG.imageCount) || 2));
    const isNsfwAllowed = Boolean(CONFIG.allowNsfw);

    spindle.toast.info('Analyzing scene for NovelAI illustration...', { title: 'RWBY Multi-Gen', duration: 3500 });

    const cleanProse = cleanMessage(content);
    const { characterKey, characterTags, beats } = analyzeStoryBeats(cleanProse, count, isNsfwAllowed);

    spindle.toast.info(`Generating ${beats.length} image(s) for ${characterKey.toUpperCase()}...`, { title: 'RWBY Multi-Gen', duration: 4000 });

    const negativePrompt = isNsfwAllowed ? BASE_STYLE_NEGATIVE_NSFW : BASE_STYLE_NEGATIVE_SFW;

    const validAttachments = [];
    for (let i = 0; i < beats.length; i++) {
      const beatTags = beats[i];
      const isCouple = /couple|hetero|2girls|straddling|penetration|kissing|sex|hug|embrace/i.test(beatTags);
      const subjectTag = isCouple ? '' : '1girl, solo, ';

      const prompt = `${BASE_STYLE_POSITIVE}, ${subjectTag}${characterTags}, ${beatTags}`;
      const genInput = {
        prompt,
        negative_prompt: negativePrompt,
        parameters: {
          sampler: 'k_euler_ancestral',
          steps: CONFIG.steps || 28,
          guidance: CONFIG.guidance || 5,
          resolution: CONFIG.aspectRatio || '832x1216',
        },
        owner_chat_id: chatId,
        owner_character_id: '874fc0e0-718b-4e09-b379-713547937591',
        includeDataUrl: false,
      };
      if (effectiveUserId) {
        genInput.userId = effectiveUserId;
      }

      try {
        const res = await generateWithRetry(genInput);
        if (res && (res.imageId || res.imageUrl)) {
          validAttachments.push({
            id: res.imageId,
            url: res.imageUrl,
            type: 'image',
          });
        }
      } catch (genErr) {
        spindle.log.error(`Generation failed for beat ${i + 1}:`, genErr);
      }

      if (i < beats.length - 1) {
        await sleep(1500);
      }
    }

    if (validAttachments.length > 0) {
      const markupList = validAttachments.map(
        (att) => `<!-- rwby_multigen -->\n<div class="pimage-container" style="background-image: url('${att.url}');" tabindex="0"></div>`
      );

      const bakedContent = bakeImagesMidChat(content, markupList);

      const patch = {};
      if (swipeId === (message.swipe_id ?? 0)) {
        patch.content = bakedContent;
      } else if (Array.isArray(message.swipes)) {
        const nextSwipes = [...message.swipes];
        nextSwipes[swipeId] = bakedContent;
        patch.swipes = nextSwipes;
      }
      if (effectiveUserId) {
        patch.userId = effectiveUserId;
      }

      await spindle.chat.updateMessage(chatId, message.id, patch);

      spindle.toast.success(`Generated and baked ${validAttachments.length} scene image(s) mid-chat!`, { title: 'RWBY Multi-Gen', duration: 4000 });
      spindle.log.info(`Generated ${validAttachments.length} images for chat ${chatId} msg ${message.id}`);
    }
  } catch (err) {
    spindle.log.error('Multi-gen failed:', err);
    spindle.toast.error(`Multi-gen error: ${err.message}`, { title: 'RWBY Multi-Gen' });
  } finally {
    processing.delete(key);
  }
}

// 1. GENERATION_ENDED (receives payload and userId)
spindle.on('GENERATION_ENDED', async (payload, userId) => {
  if (!payload || payload.error) return;
  const targetUserId = userId || payload.userId || lastKnownUserId;
  if (targetUserId) lastKnownUserId = targetUserId;

  const chatId = payload.chatId;
  const messageId = payload.messageId;
  if (!chatId || !messageId) return;

  setTimeout(async () => {
    try {
      const messages = await spindle.chat.getMessages(chatId, targetUserId ? { userId: targetUserId } : undefined);
      const msg = (messages || []).find((m) => m.id === messageId);
      if (msg && msg.role === 'assistant') {
        await handleSceneIllustration(chatId, messageId, msg.swipe_id ?? 0, targetUserId);
      }
    } catch (e) {
      spindle.log.error('GENERATION_ENDED handler failed:', e);
    }
  }, 500);
});

// 2. MESSAGE_SENT & MESSAGE_SWIPED (receives payload and userId)
spindle.on('MESSAGE_SENT', async (payload, userId) => {
  if (!payload || !payload.message) return;
  const targetUserId = userId || payload.userId || lastKnownUserId;
  if (targetUserId) lastKnownUserId = targetUserId;

  if (payload.message.role === 'assistant') {
    await handleSceneIllustration(payload.chatId, payload.message.id, payload.message.swipe_id ?? 0, targetUserId);
  }
});

spindle.on('MESSAGE_SWIPED', async (payload, userId) => {
  if (!payload || !payload.message) return;
  const targetUserId = userId || payload.userId || lastKnownUserId;
  if (targetUserId) lastKnownUserId = targetUserId;

  if (payload.action === 'added' && payload.message.role === 'assistant') {
    await handleSceneIllustration(payload.chatId, payload.message.id, payload.swipeId ?? payload.message.swipe_id ?? 0, targetUserId);
  }
});

// 3. Command Palette: Manual trigger & Settings controls
try {
  spindle.commands.register([
    {
      id: 'generate-scene-images',
      label: 'Generate Scene Images for Message',
      description: 'Generates NovelAI illustrations and bakes them mid-chat into the current scene',
      keywords: ['image', 'scene', 'generate', 'novelai', 'illustrate'],
      scope: 'chat',
    },
    {
      id: 'toggle-nsfw-multigen',
      label: 'RWBY Multi-Gen: Toggle NSFW (On/Off)',
      description: 'Toggle whether intimate/spicy scene beats and NSFW tags are allowed',
      keywords: ['nsfw', 'ecchi', 'toggle', 'adult', 'spicy', 'multigen'],
      scope: 'global',
    },
    {
      id: 'set-image-count',
      label: 'RWBY Multi-Gen: Cycle Image Count (1-4)',
      description: 'Cycle between 1, 2, 3, or 4 images generated per message',
      keywords: ['count', 'images', 'amount', 'multigen'],
      scope: 'global',
    },
  ]);

  spindle.commands.onInvoked(async (commandId, context) => {
    const targetUserId = (context && context.userId) || lastKnownUserId;
    if (targetUserId) lastKnownUserId = targetUserId;

    if (commandId === 'generate-scene-images' && context && context.chatId) {
      try {
        const messages = await spindle.chat.getMessages(context.chatId, targetUserId ? { tail: 5, userId: targetUserId } : { tail: 5 });
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant) {
          await handleSceneIllustration(context.chatId, lastAssistant.id, lastAssistant.swipe_id ?? 0, targetUserId);
        } else {
          spindle.toast.warning('No assistant message found to illustrate.');
        }
      } catch (err) {
        spindle.toast.error(`Manual trigger error: ${err.message}`);
      }
    } else if (commandId === 'toggle-nsfw-multigen') {
      CONFIG.allowNsfw = !CONFIG.allowNsfw;
      spindle.toast.success(`RWBY Multi-Gen NSFW is now ${CONFIG.allowNsfw ? 'ENABLED (spicy/ecchi beats allowed)' : 'DISABLED (safe for work only)'}`, { title: 'RWBY Multi-Gen', duration: 4000 });
    } else if (commandId === 'set-image-count') {
      let nextCount = (CONFIG.imageCount || 2) + 1;
      if (nextCount > 4) nextCount = 1;
      CONFIG.imageCount = nextCount;
      spindle.toast.success(`RWBY Multi-Gen will now generate ${nextCount} image(s) per message`, { title: 'RWBY Multi-Gen', duration: 4000 });
    }
  });
} catch (cmdErr) {
  spindle.log.warn('Could not register commands:', cmdErr);
}

spindle.toast.info(`RWBY Multi-Gen ready! (${CONFIG.imageCount} imgs/reply, NSFW: ${CONFIG.allowNsfw ? 'ON' : 'OFF'})`, { title: 'RWBY Multi-Gen', duration: 3500 });
spindle.log.info('RWBY Scene Multi-Gen backend worker initialized.');
