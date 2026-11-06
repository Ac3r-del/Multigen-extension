/**
 * RWBY Scene Multi-Gen Backend Script
 * 
 * Listens for new assistant replies and swipe creations,
 * parses visual beats from the scene, generates images via NovelAI
 * using the dialed-in RWBY card recipe, and attaches them to the message.
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

const processing = new Set();

async function handleSceneGeneration(chatId, message) {
  if (!message || message.role !== 'assistant') return;
  if (!message.content || message.content.trim().length === 0) return;

  const key = `${chatId}:${message.id}:${message.swipe_id ?? 0}`;
  if (processing.has(key)) return;
  processing.add(key);

  try {
    spindle.toast.info('Analyzing scene for NovelAI illustration...', { title: 'RWBY Multi-Gen', duration: 4000 });

    let charName = '';
    const activeChat = await spindle.chats.getActive();
    const targetChatId = chatId || (activeChat ? activeChat.id : null);
    if (!targetChatId) return;

    if (activeChat && activeChat.character_id) {
      const charData = await spindle.characters.get(activeChat.character_id);
      if (charData) charName = charData.name;
    }

    const charSnippet = detectCharacterSnippet(charName, message.content);

    // Fallback default beats based on detected character
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
        `Message:\n"""${message.content.slice(0, 3000)}"""`,
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
        owner_chat_id: targetChatId,
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
      // Append formatted image containers directly into message content for seamless inline rendering
      const imageMarkup = validAttachments
        .map((att) => `\n<div class="pimage-container" style="background-image: url('${att.url}');" tabindex="0"></div>`)
        .join('\n');

      const updatedContent = (message.content || '').trimEnd() + '\n' + imageMarkup + '\n';
      await spindle.chats.updateMessage(targetChatId, message.id, {
        content: updatedContent,
      });

      spindle.toast.success(`Generated and attached ${validAttachments.length} scene image(s)!`, { title: 'RWBY Multi-Gen', duration: 5000 });
      spindle.log.info(`Generated ${validAttachments.length} images for chat ${targetChatId} msg ${message.id}`);
    }
  } catch (err) {
    spindle.log.error('Multi-gen failed:', err);
    spindle.toast.error(`Multi-gen error: ${err.message}`, { title: 'RWBY Multi-Gen' });
  } finally {
    processing.delete(key);
  }
}

// 1. Listen for new assistant messages
spindle.on('MESSAGE_SENT', async (payload) => {
  if (!payload || !payload.message) return;
  await handleSceneGeneration(payload.chatId, payload.message);
});

// 2. Listen for swipes generated on assistant messages
spindle.on('MESSAGE_SWIPED', async (payload) => {
  if (!payload || !payload.message) return;
  if (payload.action === 'added' || payload.action === 'navigated') {
    await handleSceneGeneration(payload.chatId, payload.message);
  }
});

spindle.toast.info('RWBY Scene Multi-Gen backend worker ready!', { title: 'RWBY Multi-Gen', duration: 3000 });
spindle.log.info('RWBY Scene Multi-Gen backend worker initialized.');
