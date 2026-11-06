/**
 * RWBY Scene Multi-Gen Backend Script
 * 
 * Multi-user and operator-scoped compatible.
 * Generates NovelAI illustrations sequentially with retry/backoff
 * to prevent 429 "Concurrent generation is locked" errors.
 */

const BASE_STYLE_POSITIVE =
  'masterpiece, best quality, very aesthetic, absurdres, 1girl, solo, rwby, gradient hair, shiny hair, detailed hair, detailed skin, rim light, backlighting';

const BASE_STYLE_NEGATIVE =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, sweat, sweaty skin, shiny skin, oily skin, glossy skin';

const CHARACTER_TAGS = {
  weiss: 'weiss schnee, white hair, light blue hair, side ponytail, hair ornament, tiara, earrings, blue eyes, scar over eye, white dress, bolero, blue theme',
  ruby: 'ruby rose, black hair, red hair, short hair, silver eyes, red cloak, black dress, cross necklace, rose theme',
  blake: 'blake belladonna, black hair, purple hair, cat ears, amber eyes, black scarf, white sleeveless shirt, detached sleeves, fingerless gloves, purple theme',
  yang: 'yang xiao long, blonde hair, orange hair, purple eyes, ahoge, tan jacket, orange scarf, fingerless gloves, yellow theme',
  coco: 'coco adel, brown hair, short hair, beret, sunglasses, tinted sunglasses, round eyewear, brown eyes, necklace, scarf, brown jacket, black gloves, cross necklace, brown theme',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectCharacterSnippet(charName, content) {
  const lower = ((charName || '') + ' ' + (content || '')).toLowerCase();
  if (lower.includes('weiss')) return CHARACTER_TAGS.weiss;
  if (lower.includes('ruby')) return CHARACTER_TAGS.ruby;
  if (lower.includes('blake')) return CHARACTER_TAGS.blake;
  if (lower.includes('yang')) return CHARACTER_TAGS.yang;
  if (lower.includes('coco')) return CHARACTER_TAGS.coco;
  return 'rwby';
}

function cleanMessageContent(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '')
    .trim();
}

try {
  spindle.registerInterceptor(async (messages) => {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        const cleaned = cleanMessageContent(m.content);
        return cleaned === m.content ? m : { ...m, content: cleaned };
      }
      return m;
    });
  });
} catch (e) {
  spindle.log.warn('Could not register interceptor:', e);
}

function bakeImagesMidChat(content, imageMarkupList) {
  const clean = cleanMessageContent(content);
  if (!imageMarkupList || imageMarkupList.length === 0) return clean;

  const sep = clean.includes('\r\n') ? '\r\n\r\n' : '\n\n';
  const paragraphs = clean.split(/\r?\n\s*\r?\n/);

  if (paragraphs.length <= 1) {
    return clean + sep + imageMarkupList.join(sep);
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

    let charName = '';
    const activeChat = await spindle.chats.getActive(effectiveUserId);
    if (activeChat && activeChat.character_id) {
      const charData = await spindle.characters.get(activeChat.character_id, effectiveUserId);
      if (charData) charName = charData.name;
    }

    const charSnippet = detectCharacterSnippet(charName, content);

    let defaultBeats = [
      { tags: 'bedroom, sitting up, looking at viewer, gentle smile, dim lamplight' },
      { tags: 'upper body, expressive eyes, dynamic pose, soft lighting' },
    ];

    let beats = [];
    try {
      const parsePrompt = [
        'Analyze the roleplay message and pick 2 distinct visual moments or actions taking place.',
        'Output ONLY a JSON array of two objects with a "tags" field containing comma-separated Danbooru anime tags (location, pose, expression, lighting).',
        'Example: [{"tags": "bedroom, sitting on bed, reading book, blushing, lamplight"}, {"tags": "kitchen, holding plate, happy smile, cozy lighting"}]',
        '',
        `Message:\n"""${cleanMessageContent(content).slice(0, 3000)}"""`,
      ].join('\n');

      const rawOptions = {
        messages: [{ role: 'user', content: parsePrompt }],
        parameters: { temperature: 0.2, max_tokens: 250 },
      };
      if (effectiveUserId) {
        rawOptions.userId = effectiveUserId;
      }

      const parsed = await spindle.generate.raw(rawOptions);
      const cleaned = (parsed.content || '').replace(/```json\n?|\n?```/g, '').trim();
      const extracted = JSON.parse(cleaned);
      if (Array.isArray(extracted) && extracted.length > 0) {
        beats = extracted.slice(0, 2);
      }
    } catch (llmErr) {
      spindle.log.warn(`LLM parsing failed or timed out: ${llmErr.message}, using scene fallbacks.`);
      beats = defaultBeats;
    }

    if (!Array.isArray(beats) || beats.length === 0) {
      beats = defaultBeats;
    }

    spindle.toast.info(`Generating ${beats.length} scene image(s) via NovelAI...`, { title: 'RWBY Multi-Gen', duration: 5000 });

    // Generate sequentially so NovelAI's per-account concurrency limit is respected
    const validAttachments = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const prompt = `${BASE_STYLE_POSITIVE}, ${charSnippet}, ${beat.tags || 'upper body'}`;
      const genInput = {
        prompt,
        negative_prompt: BASE_STYLE_NEGATIVE,
        parameters: {
          sampler: 'k_euler_ancestral',
          steps: 28,
          guidance: 5,
          resolution: '832x1216',
        },
        owner_chat_id: chatId,
        owner_character_id: activeChat ? activeChat.character_id : undefined,
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

      // Small cooldown between requests
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

// 3. Command Palette: Manual trigger with context.userId
spindle.commands.register([
  {
    id: 'generate-scene-images',
    label: 'Generate Scene Images for Message',
    description: 'Generates NovelAI illustrations and bakes them mid-chat into the current scene',
    keywords: ['image', 'scene', 'generate', 'novelai', 'illustrate'],
    scope: 'chat',
  },
]);

spindle.commands.onInvoked(async (commandId, context) => {
  if (commandId === 'generate-scene-images' && context && context.chatId) {
    const targetUserId = context.userId || lastKnownUserId;
    if (targetUserId) lastKnownUserId = targetUserId;

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
  }
});

spindle.toast.info('RWBY Scene Multi-Gen backend worker ready!', { title: 'RWBY Multi-Gen', duration: 3000 });
spindle.log.info('RWBY Scene Multi-Gen backend worker initialized.');
