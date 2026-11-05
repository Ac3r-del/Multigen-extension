/**
 * RWBY Scene Multi-Gen Backend Script
 * 
 * Listens for new assistant replies, parses 2 distinct narrative beats from the scene,
 * generates both images in parallel via NovelAI using the exact card style recipe,
 * and attaches the generated images directly to the assistant's message.
 */

// Universal style positive base
const BASE_STYLE_POSITIVE =
  'masterpiece, best quality, very aesthetic, absurdres, 1girl, solo, rwby, gradient hair, shiny hair, detailed hair, detailed skin, rim light, backlighting';

// Universal style negative base
const BASE_STYLE_NEGATIVE =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, sweat, sweaty skin, shiny skin, oily skin, glossy skin';

// Per-character tags for the RWBY cast
const CHARACTER_TAGS = {
  weiss: 'weiss schnee, white hair, light blue hair, side ponytail, hair ornament, tiara, earrings, blue eyes, scar over eye, white dress, bolero, blue theme',
  ruby: 'ruby rose, black hair, red hair, short hair, silver eyes, red cloak, black dress, cross necklace, rose theme',
  blake: 'blake belladonna, black hair, purple hair, purple bow, hair bow, amber eyes, black scarf, white sleeveless shirt, detached sleeves, fingerless gloves, purple theme',
  yang: 'yang xiao long, blonde hair, orange hair, purple eyes, ahoge, tan jacket, orange scarf, fingerless gloves, yellow theme',
  coco: 'coco adel, brown hair, short hair, beret, sunglasses, tinted sunglasses, round eyewear, brown eyes, necklace, scarf, brown jacket, black gloves, cross necklace, brown theme',
};

// Helper to match active character from chat/name/message context
function detectCharacterSnippet(charName, content) {
  const lower = ((charName || '') + ' ' + (content || '')).toLowerCase();
  if (lower.includes('weiss')) return CHARACTER_TAGS.weiss;
  if (lower.includes('ruby')) return CHARACTER_TAGS.ruby;
  if (lower.includes('blake')) return CHARACTER_TAGS.blake;
  if (lower.includes('yang')) return CHARACTER_TAGS.yang;
  if (lower.includes('coco')) return CHARACTER_TAGS.coco;
  return 'rwby';
}

// In-flight guard to avoid duplicate runs
const processingMessages = new Set();

spindle.on('MESSAGE_SENT', async (payload) => {
  try {
    const { chatId, message } = payload;
    if (!message || message.role !== 'assistant') return;
    if (processingMessages.has(message.id)) return;
    processingMessages.add(message.id);

    const activeChat = await spindle.chats.getActive();
    if (!activeChat || activeChat.id !== chatId) return;

    let charName = '';
    if (activeChat.character_id) {
      const charData = await spindle.characters.get(activeChat.character_id);
      if (charData) charName = charData.name;
    }

    const charSnippet = detectCharacterSnippet(charName, message.content);

    // Prompt sidecar LLM to identify 2 distinct scene moments
    const parsePrompt = [
      'You are a visual scene parser for an anime illustrator.',
      'Analyze the following roleplay message and identify exactly 2 distinct visual moments or actions taking place.',
      'Output ONLY a valid JSON array of two objects, each with a "tags" field containing comma-separated Danbooru anime tags (location, pose, expression, lighting).',
      'Example: [{"tags": "outdoors, courtyard, standing, arms crossed, pouting, annoyed, afternoon light"}, {"tags": "classroom, desk, sitting, reading book, gentle smile, sunlight"}]',
      '',
      `Message: """${message.content}"""`,
    ].join('\n');

    const parserResult = await spindle.generate.raw({
      messages: [{ role: 'user', content: parsePrompt }],
      parameters: { temperature: 0.3, max_tokens: 350 },
    });

    let beats = [];
    try {
      const cleaned = parserResult.content.replace(/```json\n?|\n?```/g, '').trim();
      beats = JSON.parse(cleaned);
    } catch (e) {
      spindle.log.warn('Could not parse JSON beats from LLM, falling back to basic prompt.');
      beats = [{ tags: 'upper body, looking at viewer, dynamic pose' }];
    }

    if (!Array.isArray(beats) || beats.length === 0) return;

    // Generate images for up to 2 beats in parallel via NovelAI
    const tasks = beats.slice(0, 2).map(async (beat) => {
      const prompt = `${BASE_STYLE_POSITIVE}, ${charSnippet}, ${beat.tags || 'upper body'}`;
      return await spindle.imageGen.generate({
        prompt,
        negative_prompt: BASE_STYLE_NEGATIVE,
        parameters: {
          sampler: 'k_euler_ancestral',
          steps: 28,
          cfg: 5,
          resolution: '832x1216',
        },
        owner_chat_id: chatId,
        owner_character_id: activeChat.character_id,
        includeDataUrl: false,
      });
    });

    const results = await Promise.all(tasks);

    // Attach generated image references to the message
    const newAttachments = results
      .filter((res) => res && (res.imageId || res.imageUrl))
      .map((res) => ({
        id: res.imageId,
        url: res.imageUrl,
        type: 'image',
      }));

    if (newAttachments.length > 0) {
      const existingExtra = message.extra || {};
      const existingAttachments = Array.isArray(existingExtra.attachments)
        ? existingExtra.attachments
        : [];

      await spindle.chat.updateMessage(chatId, message.id, {
        extra: {
          ...existingExtra,
          attachments: [...existingAttachments, ...newAttachments],
        },
      });
      spindle.log.info(`Attached ${newAttachments.length} scene image(s) to message ${message.id}`);
    }
  } catch (err) {
    spindle.log.error('Error generating scene images:', err);
  } finally {
    if (payload && payload.message) {
      processingMessages.delete(payload.message.id);
    }
  }
});
