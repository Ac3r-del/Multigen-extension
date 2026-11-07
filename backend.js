/**
 * RWBY Scene Multi-Gen Backend Script — PART 1 OF 2
 * 
 * Budget-Conscious Paragraph-Level Scene Analyzer & NovelAI Multi-Gen Pipeline.
 * 
 * Key Features:
 * 1. ZERO Argon LLM Token Cost by default (pure paragraph-by-paragraph local narrative parser).
 * 2. Strict First-Person POV (Frank's eyes): Never renders Frank's face/head (`pov, faceless male` when limbs interact).
 * 3. Multi-Character Support: Detects 1girl, 2girls, or multiple RWBY girls in the same beat.
 * 4. Guaranteed Unique Images: Random uint32 `seed` + `extra_noise_seed`, `referenceImages: []` override,
 *    and distinct camera/composition modifiers per image slot.
 * 5. Permanent Card Art Style Lock (`BASE_STYLE_POSITIVE` + matte negative filter).
 */

let CONFIG = {
  imageCount: 2,        // 1 to 4 images per message
  allowNsfw: true,      // true allows explicit intimate/spicy tags
  aspectRatio: '832x1216',
  steps: 28,
  guidance: 5.0,
  useLlmContext: false, // FALSE = 100% Free/Zero Argon tokens! Toggle via Command Palette if desired.
};

// IMMUTABLE CARD ART STYLE LOCK
const BASE_STYLE_POSITIVE =
  'masterpiece, best quality, very aesthetic, absurdres, rwby, gradient hair, shiny hair, detailed hair, detailed skin, rim light, backlighting';

// Always ban male face so Frank's face never appears in POV
const BASE_STYLE_NEGATIVE_SFW =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, sweat, sweaty skin, shiny skin, oily skin, glossy skin, nsfw, nude, explicit, male face, 1boy face';

const BASE_STYLE_NEGATIVE_NSFW =
  'lowres, bad quality, sketch, flat color, greyscale, text, watermark, comic, shiny skin, oily skin, glossy skin, bad anatomy, deformed, male face';

// CHARACTER DICTIONARY (Supports solo or multi-girl combinations)
const CHARACTERS = {
  yang: {
    name: 'Yang Xiao Long',
    regex: /\byang\b|xiao long/i,
    tags: 'yang xiao long, blonde hair, long hair, orange hair, purple eyes, ahoge, yellow theme',
    defaultOutfit: 'tan jacket, crop top, fingerless gloves, shorts',
  },
  blake: {
    name: 'Blake Belladonna',
    regex: /\bblake\b|belladonna/i,
    tags: 'blake belladonna, black hair, long hair, purple hair, cat ears, animal ears, amber eyes, black ribbon, purple theme',
    defaultOutfit: 'white sleeveless shirt, black vest, ribbon',
  },
  weiss: {
    name: 'Weiss Schnee',
    regex: /\bweiss\b|schnee/i,
    tags: 'weiss schnee, white hair, light blue hair, side ponytail, hair ornament, tiara, earrings, blue eyes, scar over eye, blue theme',
    defaultOutfit: 'white dress, bolero, high collar',
  },
  ruby: {
    name: 'Ruby Rose',
    regex: /\bruby\b|rose/i,
    tags: 'ruby rose, black hair, red hair, short hair, silver eyes, rose theme',
    defaultOutfit: 'red cloak, black dress, combat skirt, cross necklace',
  },
  coco: {
    name: 'Coco Adel',
    regex: /\bcoco\b|adel/i,
    tags: 'coco adel, brown hair, short hair, beret, sunglasses, tinted sunglasses, round eyewear, brown eyes, necklace, scarf, brown theme',
    defaultOutfit: 'brown jacket, corset, black gloves',
  },
  nora: {
    name: 'Nora Valkyrie',
    regex: /\bnora\b|valkyrie/i,
    tags: 'nora valkyrie, orange hair, short hair, turquoise eyes, pink theme',
    defaultOutfit: 'white vest, pink skirt, heart cutout',
  },
  pyrrha: {
    name: 'Pyrrha Nikos',
    regex: /\bpyrrha\b|nikos/i,
    tags: 'pyrrha nikos, red hair, long ponytail, green eyes, gold circlet, red theme',
    defaultOutfit: 'bronze armor, red sash, greaves',
  },
  glynda: {
    name: 'Glynda Goodwitch',
    regex: /\bglynda\b|goodwitch/i,
    tags: 'glynda goodwitch, blonde hair, hair bun, glasses, green eyes, purple cape',
    defaultOutfit: 'white blouse, high-waist black skirt, riding crop',
  },
};

// DYNAMIC OUTFIT DETECTOR (Reads what the girls are actually wearing in the scene)
const OUTFIT_RULES = [
  {
    regex: /yellow tank top|cropped yellow tank|orange fleece|workout shorts|lounge shorts|sleeveless yellow/i,
    tags: 'yellow tank top, crop top, bare shoulders, orange shorts, casual dorm clothes',
  },
  {
    regex: /nightgown|silk robe|pajamas|sleepwear|bedtime/i,
    tags: 'nightgown, sleepwear, bare shoulders, soft fabric, hair down',
  },
  {
    regex: /towel|wrapped in.*towel|freshly showered/i,
    tags: 'wrapped in towel, wet hair, bare shoulders, steam',
  },
  {
    regex: /beacon uniform|school uniform|blazer|pleated skirt/i,
    tags: 'school uniform, blazer, vest, pleated skirt, necktie',
  },
  {
    regex: /naked|nude|completely bare|stripped bare|unclothed/i,
    nsfwOnly: true,
    tags: 'nude, completely naked, bare breasts, nipples',
  },
  {
    regex: /underwear|bra and panties|lingerie|lacy bra/i,
    nsfwOnly: true,
    tags: 'underwear, bra, panties, exposed skin',
  },
];

// DYNAMIC CAMERA VARIETY (Guarantees every image slot in a message has a distinct composition)
const CAMERA_ANGLES = [
  'pov, first-person view, medium shot, looking at viewer, eye contact, depth of field',
  'pov, close-up, upper body, dutch angle, expressive face, looking at viewer, dynamic framing',
  'pov, cowboy shot, from slightly below, cinematic angle, detailed background, looking at viewer',
  'pov, over-the-shoulder perspective, intimate framing, soft focus background, looking at viewer',
];

// CATEGORIZED SCENE & ACTION RULES (Evaluated per paragraph segment!)
const SCENE_RULES = [
  // 1. Explicit Sexual / NSFW (Always POV + Faceless male limbs only)
  {
    regex: /reverse cowgirl|riding reverse|facing away.*riding|rode him reverse|back turned.*straddling/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, reverse cowgirl position, straddling viewer, from behind, looking back at viewer, arched back, buttocks, nude, passionate expression, dim lamplight',
  },
  {
    regex: /cowgirl|straddling.*hips|riding him|riding you|on top of him.*bouncing|rocking hips.*on top/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, cowgirl position, straddling viewer, on top of viewer, bouncing, breasts, nude, heavy blush, open mouth, passionate, dim lighting',
  },
  {
    regex: /against the wall|pinned to the wall|wall.*bouncing|wall.*downstroke|lifted against.*wall|pressed to the wall.*hips/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, against wall, legs wrapped around viewer waist, carried, standing sex, passionate, clenching, flushed skin, dim room lighting',
  },
  {
    regex: /doggystyle|from behind.*hips|hands and knees.*thrust|bent over.*bed|rear entrance|taking him from behind/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, doggystyle, from behind, on all fours, arched back, viewer hands grabbing hips, nude, flushed face, looking back, panting, bed',
  },
  {
    regex: /missionary|pinned beneath|beneath him.*bed|looking up.*bed|legs spread|spread wide.*bed|holding her ankles|ankles over shoulders/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, missionary position, lying on back, looking up at viewer, legs spread, intimate eye contact, tangled bed sheets, flushed skin, soft lamp lighting',
  },
  {
    regex: /spooning.*knot|slow.*grind|curled together.*knot|on their sides.*thrust|spooning sex|side-by-side.*grinding/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, spooning, lying on side, intimate embrace, slow grind, holding viewer hand, tangled sheets, warm morning light, tender expression',
  },
  {
    regex: /blowjob|fellatio|sinking down his length|throat.*swallow|deepthroat|bobbing head|between his thighs.*mouth/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, fellatio, oral, kneeling between viewer legs, looking up at viewer, parted lips, heavy blush, messy hair, saliva trail, dim lamplight',
  },
  {
    regex: /cunnilingus|licking her|between her legs.*tongue|tasting her|oral.*lap|drinking her in|head between her thighs/i,
    nsfwOnly: true,
    povHands: false,
    tags: 'pov, bedroom, lying on back, legs spread, hands gripping sheets, arched back, toes curling, ecstatic expression, heavy blush, trembling thighs, dim ambient light',
  },
  {
    regex: /paizuri|titfuck|breasts.*cleavage.*cock|rubbing.*breasts|between her tits/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, paizuri, breast hold, cleavage, looking up at viewer, flustered blush, heavy panting, kneeling on bed, warm lamplight',
  },
  {
    regex: /strip|undressing|peeling off.*shirt|bra.*drop|panties.*slide|removing clothes|bare shoulders.*unbutton/i,
    nsfwOnly: true,
    povHands: false,
    tags: 'pov, bedroom, undressing, removing shirt, unbuttoning, exposed shoulders, underwear, bra, parted lips, shy blush, alluring gaze at viewer, dim lamplight',
  },
  {
    regex: /shower.*steam|steamy bathroom|wet skin.*shower|bath.*together|soap.*lather|water dripping.*curves/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bathroom, steamy shower, wet hair, wet skin, water droplets, glass door, bare body, sensual pose, looking at viewer, soft diffuse light',
  },
  {
    regex: /knotting|canine knot|swelling inside|locked together|knot catches|stretch.*knot|knot.*pulse/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, intense climax, clenching, arched spine, heavy blush, tears of pleasure, panting mouth, looking at viewer, disheveled sheets, soft backlight',
  },
  {
    regex: /afterglow.*nude|naked.*sheets|tangled in bed.*sweat|curled on chest.*bed|soft panting.*afterglow/i,
    nsfwOnly: true,
    povHands: true,
    tags: 'pov, bedroom, lying on bed, afterglow, messy sheets, exhausted, relaxed, sweet smile at viewer, gentle blush, peaceful, soft morning sunlight',
  },

  // 2. Physical Tussling, Straddling, Headlocks, Personal Space Invasion (First-Person POV)
  {
    regex: /straddling your thighs|knees straddling|landed on.*lap|sitting on.*lap|palms on your broad chest/i,
    povHands: true,
    tags: 'pov, dorm room, girl straddling viewer lap, sitting on lap, hands resting on viewer chest, leaning down close, wicked triumphant smirk, looking down at viewer, warm lamp lighting',
  },
  {
    regex: /headlock|arm around your neck|wrestl|lunges forward|reaching.*cushion|vault around|brick wall|feint/i,
    povHands: true,
    tags: 'pov, dorm room, playful wrestling, leaning in very close, reaching past viewer arm, energetic playful grin, dynamic motion, warm indoor lighting',
  },
  {
    regex: /massage.*shoulders|hands on.*trapezius|rubbing.*neck|kneading.*knots|shoulder rub/i,
    povHands: false,
    tags: 'pov, dorm room, leaning over viewer, hands reaching forward, playful smile, leaning close, gentle touch, cozy warm lighting',
  },
  {
    regex: /scratched.*ear|fondling.*ears|touching.*ear|ear.*twitch|sensitive.*fur|caressing.*tail/i,
    povHands: false,
    tags: 'pov, dorm room, reaching hand toward viewer head, close proximity, mischievous grin, teasing expression, warm ambient glow',
  },
  {
    regex: /tackled.*bookshelf|pinned against.*shelf|crowding into.*space|hands around.*wrists|inches away.*face|four inches from your/i,
    povHands: true,
    tags: 'pov, extreme close-up, face inches from viewer, holding wrists, intense eye contact, playful smirk, flushed cheeks, warm lamp lighting',
  },
  {
    regex: /passionate kiss|lips pressed|kissed deeply|tasting lips|locking lips|stolen kiss/i,
    povHands: true,
    tags: 'pov, kissing viewer, closed eyes, parted lips, blushing, hands cupping cheek, romantic atmosphere, soft warm glow',
  },

  // 3. Domestic, Comedy, Food, Romance Novels, Doorway Entrance
  {
    regex: /yanks the book|gold-foil lettering|hearts across the shattered moon|clutches the romance novel|bodice-ripper|reads filthy|historical drama/i,
    povHands: false,
    tags: 'pov, dorm room, holding hardcover romance book, showing book cover, bursting into laughter, laughing hard, tears of joy, teasing grin, warm lamp light',
  },
  {
    regex: /adobo|glazed pork|pork belly|holding.*fork|eating.*meat|steaming.*bowl|snatches.*pork|culinary bliss|bribe accepted/i,
    povHands: false,
    tags: 'pov, dorm room, holding fork, eating delicious food, glass food container, happy expression, wide eyes of delight, warm ambient lighting',
  },
  {
    regex: /barge in|kicked.*door|lockpick|silver wire|door.*flies inward|threshold|hands propped lazily on her hips|hope you are not naked/i,
    povHands: false,
    tags: 'pov, dorm room doorway, standing in open doorway, hands on hips, confident swagger, wide mischievous grin, bright eyes, indoor lighting',
  },
  {
    regex: /scroll.*screen|encrypted squad wire|thrusts the glowing screen|texted|diagrams|typing away on her scroll/i,
    povHands: false,
    tags: 'pov, dorm room, holding smartphone scroll toward viewer, glowing screen, smirking, pointing at screen, indoor warm light',
  },
  {
    regex: /redder than|fresh strawberry|best fighter|compliment bomb|golden retriever of a man|claps a heavy hand over her own forehead|blind to women/i,
    povHands: false,
    tags: 'pov, dorm room,leaning on desk, facepalm, laughing in disbelief, amused expression, shaking head, warm desk lamp',
  },
  {
    regex: /curfew inspection|glynda|high-heeled boots|slips through the doorway|winks once through the gap/i,
    povHands: false,
    tags: 'pov, dorm doorway, peeking into hallway, finger to lips, winking back at viewer, sneaky grin, dim corridor shadows',
  },

  // 4. Combat, Sparring, Semblance, Weapons & Beacon Academy
  {
    regex: /spar.*ring|fencing.*manual|myrtenaster|rapier.*thrust|parry.*blade|fencing stance|fourth atlesian/i,
    povHands: false,
    tags: 'pov, combat training hall, holding rapier, fencing stance, dynamic sword pose, fierce gaze at viewer, motion lines, sharp rim light',
  },
  {
    regex: /gauntlet.*ember celica|shotgun gauntlet|brawler.*punch|combustion dust|explosive punch/i,
    povHands: false,
    tags: 'pov, combat arena, shotgun gauntlets, ready stance, fiery aura, confident smirk at viewer, explosive motion, dramatic lighting',
  },
  {
    regex: /scythe.*crescent rose|sniper scythe|high-caliber sniper|recoil jump|rose petals.*dash/i,
    povHands: false,
    tags: 'pov, combat ground, wielding giant scythe, red rose petals fluttering, energetic combat leap, silver eyes, dynamic motion blur',
  },
  {
    regex: /gambol shroud|kusarigama|cleaver ribbon|shadow clone|shadow decoy/i,
    povHands: false,
    tags: 'pov, shadowy arena, dual wielding blade and ribbon, shadow clone fading behind, agile mid-air spin, focused feline eyes, moody rim lighting',
  },
  {
    regex: /glyph.*circle|ice dust|gravity dust|dust crystal|semblance.*burst|summoning glyph/i,
    povHands: false,
    tags: 'pov, summoning glyph, glowing magical circle, ice particles, elemental sparks, dynamic action pose, intense lighting',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate cryptographically random uint32 seed so NovelAI NEVER repeats an image
function randomSeed() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  } catch (e) {
    return Math.floor(Math.random() * 4294967295);
  }
}

// Extract ONLY the <prose> section so off-screen status/meanwhile blocks never confuse the scene detector!
function extractProseOnly(content) {
  if (typeof content !== 'string') return '';
  let text = content
    .replace(/\s*<!-- rwby_multigen -->\s*<div class="pimage-container"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*<div class="pimage-container" style="background-image: url\('[^']+'\);" tabindex="0"><\/div>/gi, '');

  const proseMatch = text.match(/<prose>([\s\S]*?)<\/prose>/i);
  if (proseMatch && proseMatch[1]) {
    text = proseMatch[1];
  } else {
    text = text
      .replace(/<scene_plan[\s\S]*?<\/scene_plan>/gi, '')
      .replace(/<status[\s\S]*?<\/status>/gi, '')
      .replace(/<meanwhile[\s\S]*?<\/meanwhile>/gi, '')
      .replace(/<relationships[\s\S]*?<\/relationships>/gi, '')
      .replace(/<threads[\s\S]*?<\/threads>/gi, '')
      .replace(/<plotlines[\s\S]*?<\/plotlines>/gi, '')
      .replace(/<truths[\s\S]*?<\/truths>/gi, '')
      .replace(/<psych[\s\S]*?<\/psych>/gi, '')
      .replace(/<undercurrents[\s\S]*?<\/undercurrents>/gi, '')
      .replace(/<companions[\s\S]*?<\/companions>/gi, '')
      .replace(/<details[\s\S]*?<\/details>/gi, '');
  }

  return text
    .replace(/<visuals[\s\S]*?<\/visuals>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .trim();
}
/**
 * RWBY Scene Multi-Gen Backend Script — PART 2 OF 2
 * 
 * Paragraph-Segment Multi-Character & First-Person POV Engine.
 * Zero Argon token cost by default. Guarantees unique seeds, clears cached
 * connection reference images, supports multiple characters on screen,
 * and enforces strict first-person POV from Frank's perspective.
 */

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

// Detect which RWBY girls are physically present in a text segment (supports 1girl, 2girls, 3girls)
function detectCharactersInSegment(segmentText, fullProseText, rawContent) {
  const presentKeys = [];

  // 1. Check sprite tags in the raw content first to know who is definitely on-screen in this turn
  const onScreenSprites = new Set();
  const spriteMatches = [...rawContent.matchAll(/(?:<pimg\s+src=["']|{{image::)([^.:\s"']+[^."']*?)(?:\.|\s*::)/gi)];
  for (const m of spriteMatches) {
    const rawName = m[1].toLowerCase();
    for (const [key, def] of Object.entries(CHARACTERS)) {
      if (def.regex.test(rawName)) onScreenSprites.add(key);
    }
  }

  // 2. Score characters mentioned in this specific story segment
  for (const [key, def] of Object.entries(CHARACTERS)) {
    const matches = (segmentText.match(new RegExp(def.regex.source, 'gi')) || []).length;
    // A character is physically present if they have an active sprite OR are mentioned >= 2 times in the segment
    if ((onScreenSprites.has(key) && matches >= 1) || matches >= 2) {
      presentKeys.push({ key, count: matches + (onScreenSprites.has(key) ? 5 : 0) });
    }
  }

  presentKeys.sort((a, b) => b.count - a.count);
  let selectedKeys = presentKeys.slice(0, 2).map((item) => item.key); // Up to 2 girls in one shot

  // Fallback if segment didn't name-drop: use the primary on-screen character from the whole prose
  if (selectedKeys.length === 0) {
    if (onScreenSprites.size > 0) {
      selectedKeys = [...onScreenSprites].slice(0, 2);
    } else {
      let bestKey = 'yang';
      let maxCount = -1;
      for (const [key, def] of Object.entries(CHARACTERS)) {
        const c = (fullProseText.match(new RegExp(def.regex.source, 'gi')) || []).length;
        if (c > maxCount) {
          maxCount = c;
          bestKey = key;
        }
      }
      selectedKeys = [bestKey];
    }
  }

  return selectedKeys;
}

// Detect dynamic outfit from the prose
function resolveOutfitTags(charKeys, fullProseText, isNsfwAllowed) {
  for (const rule of OUTFIT_RULES) {
    if (rule.nsfwOnly && !isNsfwAllowed) continue;
    if (rule.regex.test(fullProseText)) {
      return rule.tags;
    }
  }
  return charKeys.map((k) => CHARACTERS[k]?.defaultOutfit || '').filter(Boolean).join(', ');
}

// Budget-free Paragraph-Segment Story Analyzer (Zero Argon Tokens!)
function analyzeStorySegmentsLocal(rawContent, targetCount, isNsfwAllowed) {
  const cleanProse = extractProseOnly(rawContent);
  const paragraphs = cleanProse.split(/\r?\n\s*\r?\n/).filter((p) => p.trim().length > 20);

  // Divide the story into `targetCount` chronological segments (Beginning -> Middle -> Climax)
  const segments = [];
  const chunkSize = Math.max(1, Math.ceil(paragraphs.length / targetCount));
  for (let i = 0; i < targetCount; i++) {
    const start = i * chunkSize;
    const slice = paragraphs.slice(start, start + chunkSize).join('\n\n');
    segments.push(slice || cleanProse);
  }

  const usedRuleIndexes = new Set();
  const beatPlans = [];

  for (let i = 0; i < targetCount; i++) {
    const seg = segments[i];
    const charKeys = detectCharactersInSegment(seg, cleanProse, rawContent);
    const outfitTags = resolveOutfitTags(charKeys, cleanProse, isNsfwAllowed);

    // Find a matching scene rule in this segment that hasn't been used yet in an earlier image!
    let chosenRule = null;
    for (let rIdx = 0; rIdx < SCENE_RULES.length; rIdx++) {
      const rule = SCENE_RULES[rIdx];
      if (rule.nsfwOnly && !isNsfwAllowed) continue;
      if (rule.regex.test(seg) && !usedRuleIndexes.has(rIdx)) {
        chosenRule = rule;
        usedRuleIndexes.add(rIdx);
        break;
      }
    }

    // If no unused rule matched this segment, check the full prose for any unused rule
    if (!chosenRule) {
      for (let rIdx = 0; rIdx < SCENE_RULES.length; rIdx++) {
        const rule = SCENE_RULES[rIdx];
        if (rule.nsfwOnly && !isNsfwAllowed) continue;
        if (rule.regex.test(cleanProse) && !usedRuleIndexes.has(rIdx)) {
          chosenRule = rule;
          usedRuleIndexes.add(rIdx);
          break;
        }
      }
    }

    const angleTag = CAMERA_ANGLES[i % CAMERA_ANGLES.length];
    const actionTags = chosenRule
      ? chosenRule.tags
      : 'pov, indoor, dorm room, expressive emotion, looking at viewer, warm ambient lighting';

    // First-Person POV enforcement: Frank's face NEVER appears; only faceless hands/arms if physically interacting
    const povLimbTag = chosenRule && chosenRule.povHands
      ? 'pov hands, faceless male, male arms only, first-person view, '
      : 'pov, first-person view, ';

    const countPrefix = charKeys.length === 1 ? '1girl, solo' : `${charKeys.length}girls, multiple girls`;
    const charAppearance = charKeys.map((k) => CHARACTERS[k]?.tags || '').join(', ');

    beatPlans.push({
      charLabel: charKeys.map((k) => k.toUpperCase()).join(' & '),
      fullBeatPrompt: `${countPrefix}, ${charAppearance}, ${outfitTags}, ${povLimbTag}${angleTag}, ${actionTags}`,
    });
  }

  return {
    beats: beatPlans,
    source: 'local-context',
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

    const { beats, source } = analyzeStorySegmentsLocal(content, count, isNsfwAllowed);
    const charSummary = beats.map((b) => b.charLabel).join(' -> ');

    spindle.toast.info(`Illustrating ${beats.length} unique POV scene(s): ${charSummary} (${source})...`, {
      title: 'RWBY Multi-Gen',
      duration: 4000,
    });

    const negativePrompt = isNsfwAllowed ? BASE_STYLE_NEGATIVE_NSFW : BASE_STYLE_NEGATIVE_SFW;

    const validAttachments = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const seed = randomSeed();
      const extraSeed = randomSeed();

      // INVIOLABLE STYLE LOCK + FIRST-PERSON POV + UNIQUE SCENE BEAT
      const prompt = `${BASE_STYLE_POSITIVE}, ${beat.fullBeatPrompt}`;

      // Override connection defaults so cached referenceImages don't clone previous poses, and force unique seeds!
      const rawOverride = JSON.stringify({
        parameters: {
          seed,
          extra_noise_seed: extraSeed,
          negative_prompt: negativePrompt,
          reference_image_multiple: [],
          reference_information_extracted_multiple: [],
          reference_strength_multiple: [],
        },
      });

      const genInput = {
        prompt,
        negative_prompt: negativePrompt,
        parameters: {
          sampler: 'k_euler_ancestral',
          steps: CONFIG.steps || 28,
          guidance: CONFIG.guidance || 5,
          resolution: CONFIG.aspectRatio || '832x1216',
          seed,
          negativePrompt,
          includeCharacterAvatar: false,
          referenceImages: [],
          resolvedReferenceImages: [],
          rawRequestOverride: rawOverride,
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

      spindle.toast.success(`Generated ${validAttachments.length} unique POV image(s) (${charSummary})!`, {
        title: 'RWBY Multi-Gen',
        duration: 4000,
      });
    }
  } catch (err) {
    spindle.log.error('Multi-gen failed:', err);
    spindle.toast.error(`Multi-gen error: ${err.message}`, { title: 'RWBY Multi-Gen' });
  } finally {
    processing.delete(key);
  }
}

// 1. GENERATION_ENDED
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

// 2. MESSAGE_SENT & MESSAGE_SWIPED
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

// 3. Command Palette Controls
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
      spindle.toast.success(`RWBY Multi-Gen NSFW is now ${CONFIG.allowNsfw ? 'ENABLED' : 'DISABLED'}`, { title: 'RWBY Multi-Gen', duration: 4000 });
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

spindle.toast.info(`RWBY Multi-Gen v1.2 ready! (Zero-Token POV Engine, ${CONFIG.imageCount} imgs/reply)`, { title: 'RWBY Multi-Gen', duration: 3500 });
spindle.log.info('RWBY Scene Multi-Gen v1.2 initialized.');
