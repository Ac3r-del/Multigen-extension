/**
 * RWBY Scene Multi-Gen Backend Script
 * Inspired by Inlay Illustrator's lifecycle and mid-chat paragraph slotting:
 * 
 * 1. Interceptor: cleans baked image HTML blocks before sending prompts to the LLM.
 * 2. Triggers: Listens for GENERATION_ENDED (chat turns / swipes) and command palette triggers.
 * 3. Mid-Chat Baking: Inserts images right between natural paragraph breaks using
 *    the RWBY card's native frame (.pimage-container).
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

function detectCharacterSnippet(charName, content) {
  const lower = ((charName || '') + ' ' + (content || '')).toLowerCase();
  if (lower.includes('weiss')) return CHARACTER_TAGS.weiss;
  if (lower.includes('ruby')) return CHARACTER_TAGS.ruby;
  if (lower.includes('blake')) return CHARACTER_TAGS.blake;
  if (lower.includes('yang')) return CHARACTER_TAGS.yang;
  if (lower.includes('coco')) return CHARACTER_TAGS.coco;
  return 'rwby';
}

// Strip baked image containers from messages before LLM sees them (idempotent, like Inlay Illustrator)
function cleanMessageContent(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '')
    .trim();
}

// Register interceptor so LLM never sees raw visual HTML blocks in chat history
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

// Split content into paragraphs and bake images into mid-chat blank line gaps
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

const processing = new Set();

async function handleSceneIllustration(chatId, messageId, swipeId = 0) {
  if (!chatId || !messageId) return;

  const key = `${chatId}:${messageId}:${swipeId}`;
  if (processing.has(key)) return;
  processing.add(key);

  try {
    const messages = await spindle.chat.getMessages(chatId);
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
    const activeChat = await spindle.chats.getActive();
    if (activeChat && activeChat.character_id) {
      const charData = await spindle.characters.get(activeChat.character_id);
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

      const parsed = await spindle.generate.raw({
        messages: [{ role: 'user', content: parsePrompt }],
        parameters: { temperature: 0.2, max_tokens: 250 },
      });

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

    const tasks = beats.map(async (beat) => {
      const prompt = `${BASE_STYLE_POSITIVE}, ${charSnippet}, ${beat.tags || 'upper body'}`;
      return await spindle.imageGen.generate({
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
      });
    });

    const results = await Promise.all(tasks);
    const validAttachments = results
      .filter((r) => r && (r.imageId || r.imageUrl))
      .map((r) => ({
        id: r.imageId,
        url: r.imageUrl,
        type: 'image',
      }));

    if (validAttachments.length > 0) {
      const markupList = validAttachments.map(
        (att) => `<!-- rwby_multigen -->\n<div class="pimage-container" style="background-image: url('${att.url}');" tabindex="0"></div>`
      );

      const bakedContent = bakeImagesMidChat(content, markupList);

      if (swipeId === (message.swipe_id ?? 0)) {
        await spindle.chat.updateMessage(chatId, message.id, {
          content: bakedContent,
        });
      } else if (Array.isArray(message.swipes)) {
        const nextSwipes = [...message.swipes];
        nextSwipes[swipeId] = bakedContent;
        await spindle.chat.updateMessage(chatId, message.id, {
          swipes: nextSwipes,
        });
      }

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

// 1. GENERATION_ENDED: Primary trigger when assistant finishes streaming
spindle.on('GENERATION_ENDED', async (payload) => {
  if (!payload || payload.error) return;
  const chatId = payload.chatId;
  const messageId = payload.messageId;
  if (!chatId || !messageId) return;

  setTimeout(async () => {
    try {
      const messages = await spindle.chat.getMessages(chatId);
      const msg = (messages || []).find((m) => m.id === messageId);
      if (msg && msg.role === 'assistant') {
        await handleSceneIllustration(chatId, messageId, msg.swipe_id ?? 0);
      }
    } catch (e) {
      spindle.log.error('GENERATION_ENDED handler failed:', e);
    }
  }, 300);
});

// 2. Fallbacks for non-streaming or external writes
spindle.on('MESSAGE_SENT', async (payload) => {
  if (!payload || !payload.message) return;
  if (payload.message.role === 'assistant') {
    await handleSceneIllustration(payload.chatId, payload.message.id, payload.message.swipe_id ?? 0);
  }
});

spindle.on('MESSAGE_SWIPED', async (payload) => {
  if (!payload || !payload.message) return;
  if (payload.action === 'added' && payload.message.role === 'assistant') {
    await handleSceneIllustration(payload.chatId, payload.message.id, payload.swipeId ?? payload.message.swipe_id ?? 0);
  }
});

// 3. Command Palette manual trigger
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
    try {
      const messages = await spindle.chat.getMessages(context.chatId, { tail: 5 });
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) {
        await handleSceneIllustration(context.chatId, lastAssistant.id, lastAssistant.swipe_id ?? 0);
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
