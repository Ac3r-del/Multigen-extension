/**
 * RWBY Scene Multi-Gen Backend Script
 * 
 * Generates NovelAI illustrations sequentially with retry/backoff
 * to prevent 429 "Concurrent generation is locked" errors.
 * 
 * Features:
 * - 100% Dynamic & Chat-Aware: Directly mirrors the active character and setting
 *   from native card sprite triggers (<pimg src="Character.Emotion"> or {{image::Character::Emotion}}).
 * - Multi-character support: Weiss, Blake, Yang, Ruby, Coco, etc.
 * - Dynamic scene awareness: adapts to reading, eating, combat, talking, or intimate NSFW.
 * - Zero hardcoded bedroom/sparring locks.
 */

// Configure generation settings here:
let CONFIG = {
  imageCount: 2,        // Number of images to generate (1 to 4)
  allowNsfw: true,      // Allow intimate/spicy tags when the scene is actually romantic/sexual
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

const KNOWN_RWBY_CHARACTERS = {
  weiss: 'weiss schnee, white hair, light blue hair, side ponytail, hair ornament, tiara, earrings, blue eyes, scar over eye',
  ruby: 'ruby rose, black hair, red hair, short hair, silver eyes, red cloak, cross necklace',
  blake: 'blake belladonna, black hair, purple hair, cat ears, animal ears, amber eyes',
  yang: 'yang xiao long, blonde hair, orange hair, purple eyes, ahoge',
  coco: 'coco adel, brown hair, short hair, beret, sunglasses, tinted sunglasses, round eyewear, brown eyes',
  nora: 'nora valkyrie, orange hair, short hair, turquoise eyes',
  pyrrha: 'pyrrha nikos, red hair, ponytail, green eyes, circlet',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectActiveSceneCharacter(content) {
  if (typeof content !== 'string') return 'rwby';

  // 1. Check card sprite triggers like <pimg src="Yang Xiao Long.smile"> or {{image::Yang Xiao Long::smile}}
  const spriteMatches = [...content.matchAll(/(?:<pimg\s+src=["']|{{image::)([^.]+?)(?:\.|\s*::)/gi)];
  if (spriteMatches.length > 0) {
    const lastName = spriteMatches[spriteMatches.length - 1][1].toLowerCase();
    if (lastName.includes('yang')) return 'yang';
    if (lastName.includes('blake')) return 'blake';
    if (lastName.includes('weiss')) return 'weiss';
    if (lastName.includes('ruby')) return 'ruby';
    if (lastName.includes('coco')) return 'coco';
  }

  // 2. Count mention frequencies in the actual narrative text
  const lower = content.toLowerCase();
  const counts = {
    yang: (lower.match(/\byang\b/g) || []).length,
    blake: (lower.match(/\bblake\b/g) || []).length,
    weiss: (lower.match(/\bweiss\b/g) || []).length,
    ruby: (lower.match(/\bruby\b/g) || []).length,
    coco: (lower.match(/\bcoco\b/g) || []).length,
  };

  let maxChar = 'rwby';
  let maxCount = 0;
  for (const [ch, cnt] of Object.entries(counts)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      maxChar = ch;
    }
  }

  return maxChar;
}

function cleanNarrativeContent(content) {
  if (typeof content !== 'string') return '';
  return content
    .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '')
    .replace(/<scene_plan>[\s\S]*?<\/scene_plan>/gi, '')
    .replace(/<tracker>[\s\S]*?<\/tracker>/gi, '')
    .replace(/<companions[\s\S]*?<\/companions>/gi, '')
    .replace(/<status>[\s\S]*?<\/status>/gi, '')
    .replace(/<relationships>[\s\S]*?<\/relationships>/gi, '')
    .replace(/<threads>[\s\S]*?<\/threads>/gi, '')
    .replace(/<plotlines>[\s\S]*?<\/plotlines>/gi, '')
    .replace(/<meanwhile>[\s\S]*?<\/meanwhile>/gi, '')
    .replace(/<truths>[\s\S]*?<\/truths>/gi, '')
    .replace(/<psych>[\s\S]*?<\/psych>/gi, '')
    .replace(/<undercurrents>[\s\S]*?<\/undercurrents>/gi, '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/<scenecard[\s\S]*?<\/scenecard>/gi, '')
    .replace(/<adventurecard[\s\S]*?<\/adventurecard>/gi, '')
    .replace(/<internal_states[\s\S]*?<\/internal_states>/gi, '')
    .replace(/<visuals>[\s\S]*?<\/visuals>/gi, '')
    .replace(/<[^>]+>/g, '') // strip remaining XML/HTML tags
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

  if (paragraphs.length <= 1) {
    return content + sep + imageMarkupList.join(sep);
  }

  const resultParagraphs = [...paragraphs];
  const step = Math.max(1, Math.floor(paragraphs.length / (imageMarkupList.length + 1)));

  let insertCount = 0;
  for (let i = 0; i < imageMarkupList.length; i++) {
    const slotIdx = Math.min(resultParagraphs.length - 1, (i + 1) * step + insertCount);
    resultParagraphs.splice(slotIdx, 0, imageMarkupList[i]);
    insertCount++;
  }

  return resultParagraphs.join(sep);
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

    spindle.toast.info('Analyzing scene for NovelAI illustration...', { title: 'RWBY Multi-Gen', duration: 4000 });

    const activeCharKey = detectActiveSceneCharacter(content);
    const cleanProse = cleanNarrativeContent(content);
    const count = Math.max(1, Math.min(4, Number(CONFIG.imageCount) || 2));
    const isNsfwAllowed = Boolean(CONFIG.allowNsfw);

    let beats = [];
    try {
      const parsePrompt = [
        `You are an anime art director. Read this story turn and generate ${count} scene illustration prompts.`,
        `The primary character active in this scene is: ${activeCharKey.toUpperCase()}.`,
        ``,
        `Task:`,
        `Describe ${count} distinct visual moments of ${activeCharKey.toUpperCase()} based on what is happening in the text (e.g. eating, laughing, teasing, holding a book, sparring, sitting, or bedroom intimacy).`,
        isNsfwAllowed
          ? `NSFW NOTE: If and ONLY if the scene involves nudity or sexual intercourse, include appropriate intimate tags. If it is non-sexual (e.g. talking, teasing, eating, fighting), depict the actual non-sexual activity accurately.`
          : `Keep tags strictly SFW (safe for work).`,
        ``,
        `Output ONLY a JSON array of ${count} objects with:`,
        `- "character": "${activeCharKey}"`,
        `- "tags": comma-separated Danbooru tags (outfit, pose, facial expression, props, setting, lighting)`,
        ``,
        `Story Prose:`,
        `"""${cleanProse.slice(0, 3000)}"""`,
      ].join('\n');

      const rawOptions = {
        messages: [{ role: 'user', content: parsePrompt }],
        parameters: { temperature: 0.1, max_tokens: 350 },
      };
      if (effectiveUserId) {
        rawOptions.userId = effectiveUserId;
      }

      const parsed = await spindle.generate.raw(rawOptions);
      const cleaned = (parsed.content || '').replace(/```json\n?|\n?```/g, '').trim();
      const extracted = JSON.parse(cleaned);
      if (Array.isArray(extracted) && extracted.length > 0) {
        beats = extracted.slice(0, count);
      }
    } catch (llmErr) {
      spindle.log.warn(`LLM parsing failed: ${llmErr.message}, building dynamic heuristic beats.`);
    }// Dynamic heuristic fallback if LLM extraction returned empty
    if (!Array.isArray(beats) || beats.length === 0) {
      const lower = cleanProse.toLowerCase();
      const isCombat = /spar|fenc|rapier|sword|gauntlet|parry|slash|blade|arena|ring|combat/i.test(lower);
      const isReading = /book|read|paperback|novel|alcov|cushion/i.test(lower);
      const isEating = /adobo|eat|food|pork|fork|chew|dinner|plate/i.test(lower);
      const isTeasing = /laugh|grin|smirk|teas|waffle|chuckle|giggle/i.test(lower);
      const isSex = /knot|thigh|naked|nude|sex|riding|clit|cock|pussy|bed/i.test(lower) && isNsfwAllowed;

      if (isSex) {
        beats = [
          { character: activeCharKey, tags: 'bedroom, lying on bed, intimate, blushing, dim lamplight' },
          { character: activeCharKey, tags: 'straddling, passionate expression, flushed face, soft lighting' },
        ].slice(0, count);
      } else if (isCombat) {
        beats = [
          { character: activeCharKey, tags: 'combat arena, fighting stance, dynamic pose, fierce gaze, battle ready, rim lighting' },
          { character: activeCharKey, tags: 'parrying, dynamic action pose, focused expression, motion lines' },
        ].slice(0, count);
      } else if (isEating || isTeasing) {
        beats = [
          { character: activeCharKey, tags: 'indoor, laughing, smiling, expressive eyes, holding fork, warm indoor lighting' },
          { character: activeCharKey, tags: 'upper body, teasing grin, wink, relaxed posture, casual lighting' },
        ].slice(0, count);
      } else if (isReading) {
        beats = [
          { character: activeCharKey, tags: 'sitting, holding book, reading, velvet cushions, window alcove, warm lamp lighting, gentle smile' },
          { character: activeCharKey, tags: 'looking up from book, expressive eyes, relaxed pose, indoor' },
        ].slice(0, count);
      } else {
        beats = [
          { character: activeCharKey, tags: 'sitting, looking at viewer, expressive eyes, gentle lighting' },
          { character: activeCharKey, tags: 'upper body, smiling, indoor, soft ambient lighting' },
        ].slice(0, count);
      }
    }

    spindle.toast.info(`Generating ${beats.length} scene image(s) for ${activeCharKey.toUpperCase()}...`, { title: 'RWBY Multi-Gen', duration: 5000 });

    const negativePrompt = isNsfwAllowed ? BASE_STYLE_NEGATIVE_NSFW : BASE_STYLE_NEGATIVE_SFW;

    // Generate sequentially so NovelAI's per-account concurrency limit is respected
    const validAttachments = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const beatChar = (beat.character || activeCharKey).toLowerCase();
      const beatTags = beat.tags || 'upper body, looking at viewer';

      // Match character tags dynamically from the resolved character
      let charTag = KNOWN_RWBY_CHARACTERS[activeCharKey] || KNOWN_RWBY_CHARACTERS.rwby || 'rwby';
      if (beatChar.includes('yang')) charTag = KNOWN_RWBY_CHARACTERS.yang;
      else if (beatChar.includes('blake')) charTag = KNOWN_RWBY_CHARACTERS.blake;
      else if (beatChar.includes('weiss')) charTag = KNOWN_RWBY_CHARACTERS.weiss;
      else if (beatChar.includes('ruby')) charTag = KNOWN_RWBY_CHARACTERS.ruby;
      else if (beatChar.includes('coco')) charTag = KNOWN_RWBY_CHARACTERS.coco;

      const isCouple = /couple|hetero|2girls|straddling|penetration|kissing|sex|hug|embrace/i.test(beatTags);
      const subjectTag = isCouple ? '' : '1girl, solo, ';

      const prompt = `${BASE_STYLE_POSITIVE}, ${subjectTag}${charTag}, ${beatTags}`;
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

      // Cooldown between requests
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

      spindle.toast.success(`Generated and baked ${validAttachments.length} scene image(s) mid-chat!`, { title: 'RWBY Multi-Gen', duration: 5000 });
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
