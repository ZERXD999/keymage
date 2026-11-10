'use strict';
/* ======================= กติกาเกม (ใช้ร่วมกันระหว่างเซิร์ฟเวอร์และตัวจำลองสมดุล) ======================= */

const PLAYER_MAX_HP = 100;

// kind: atk = โจมตี, ult = ไม้ตาย (ยาว เสี่ยงโดนล้าง แต่แรง), def = โล่กันการโจมตีครั้งถัดไป, ctr = ตั้งท่าสวนกลับ
const KIND_RULES = {
    atk: { mult: 1.0 },
    ult: { mult: 1.5 },
    def: { mult: 0.5 },   // + โล่ 1 ชั้น
    ctr: { mult: 0.5, counterMult: 1.5 } // + สวนกลับเมื่อมอนสเตอร์โจมตี
};

const S = (text, kind) => ({ text, kind });
const SPELLS = {
    Fire:        [S('fireball','atk'), S('scorch','atk'), S('meteor','atk'), S('lava eruption','atk'), S('hellfire annihilation','ult'), S('flame shield','def')],
    Water:       [S('splash','atk'), S('aqua slash','atk'), S('hydro cannon','atk'), S('tsunami devastation','ult'), S('oceanic aegis','def'), S('mirror lake','ctr')],
    Wind:        [S('gust','atk'), S('aero blade','atk'), S('tornado burst','atk'), S('hurricane tempest','ult'), S('wind barrier','def'), S('tempest kick','ctr')],
    Earth:       [S('pebble','atk'), S('rock smash','atk'), S('earthquake stomp','atk'), S('continental crush','ult'), S('terra armor','def'), S('spike retribution','ctr')],
    Lightning:   [S('zap','atk'), S('chain lightning','atk'), S('thunder gods wrath','ult'), S('static field','def'), S('thunder strike back','ctr')],
    Ice:         [S('chill','atk'), S('ice shard','atk'), S('frostbite','atk'), S('absolute zero glacier','ult'), S('glacier wall','def'), S('shattering counter','ctr')],
    Light:       [S('shine','atk'), S('holy ray','atk'), S('divine smite','atk'), S('heavenly judgement','ult'), S('aegis of light','def'), S('holy prism','ctr')],
    Dark:        [S('umbra','atk'), S('dark_matter','atk'), S('shadow lance','atk'), S('abyssal nightmare','ult'), S('void barrier','def'), S('phantom revenge','ctr')],
    Psychic:     [S('focus','atk'), S('mind_crush','atk'), S('telekinetic_spear','atk'), S('psychic obliteration','ult'), S('cerebral fortress','def'), S('synapse shatter','ctr')],
    Necromancer: [S('curse','atk'), S('bone spear','atk'), S('death scythe','atk'), S('army of the undead','ult'), S('bone wall','def'), S('graveyard grip','ctr')],
    Blood:       [S('bleed','atk'), S('blood spike','atk'), S('hemorrhage burst','atk'), S('crimson blood festival','ult'), S('coagulate armor','def'), S('vampiric counter','ctr')],
    Poison:      [S('toxin','atk'), S('acid splash','atk'), S('venomous fang','atk'), S('venomous plague storm','ult'), S('miasma barrier','def'), S('viper strike back','ctr')],
    Summoner:    [S('wisp','atk'), S('beast rush','atk'), S('summon bahamut','ult'), S('guardian golem','def'), S('fairy deflect','def'), S('counter summon','ctr')],
    Hogwarts:    [S('nox','atk'), S('lumos','atk'), S('accio','atk'), S('crucio','atk'), S('reparo','atk'), S('stupefy','atk'), S('protego','def'), S('imperio','ctr'), S('obliviate','atk'), S('alohomora','atk'), S('sectumsempra','atk'), S('expelliarmus','ctr'), S('avada kedavra','ult'), S('expecto patronum','def'), S('wingardium leviosa','ult')],
    NeoBlue:       [S('burst','atk'), S('ultimate burst','atk'), S('white lightning','atk'), S('triple attack','atk'), S('triple white lightning','ult'), S('dragon scales','def'), S('dragon wing counter','ctr'), S('fusion counter','ctr')],
    ShadowMonarch: [S('arise','atk'), S('mutilation','atk'), S('dagger rush','atk'), S('dagger throw','atk'), S('bloodlust','atk'), S('shadow army assault','ult'), S('shadow veil','def'), S('shadow exchange','ctr'), S('dagger parry','ctr')],
    Ra:            [S('ember','atk'), S('sun burst','atk'), S('blaze cannon','atk'), S('phoenix flame','atk'), S('god phoenix strike','ult'), S('flame aegis','def'), S('divine sacrifice','ctr'), S('flame form','ctr')],
    Slifer:        [S('roar','atk'), S('mouth of truth','atk'), S('lightning blast','atk'), S('jamming waves','atk'), S('thunderforce attack','ult'), S('thunder armor','def'), S('trigger counter','ctr')],
    MegaRayquaza:  [S('storm','atk'), S('extreme speed','atk'), S('hyper beam','atk'), S('draco meteor','atk'), S('dragon ascent strike','ult'), S('delta stream','def'), S('dragon veil','def'), S('twister counter','ctr'), S('dragon dance','ctr')],
    Obelisk:       [S('punch','atk'), S('giant fist','atk'), S('god hand crusher','atk'), S('soul energy cannon','ult'), S('divine armor','def'), S('solid body','def'), S('soul reflect','ctr'), S('sacrifice counter','ctr')]
};

// scoreMult = ตัวคูณคะแนนต่อดาเมจ (ยิ่งยากยิ่งได้เยอะ กันฟาร์มสไลม์), bounty = โบนัสเมื่อชนะ, rec = จำนวนคนที่แนะนำ
// hp ในตารางคือค่าตอนมีผู้เล่น 1 คน — ตอนเริ่มรบจะปรับตามจำนวนคนด้วย hpForParty()
const MONSTERS = {
    SLIME:          { name: 'SLIME',             emoji: '🟢', maxHp: 700,   speed: 6000, damage: 4,  scoreMult: 1.0, bounty: 150,   rec: 1, tier: 1 },
    SKELETON:       { name: 'SKELETON WARRIOR',  emoji: '💀', maxHp: 2000,  speed: 5500, damage: 6,  scoreMult: 1.2, bounty: 300,   rec: 1, tier: 2 },
    OGRE:           { name: 'OGRE',              emoji: '👹', maxHp: 3500,  speed: 5200, damage: 7,  scoreMult: 1.5, bounty: 600,   rec: 2, tier: 3 },
    NAGA:           { name: 'NAGA',              emoji: '🐍', maxHp: 3250,  speed: 4800, damage: 8,  scoreMult: 1.8, bounty: 900,   rec: 3, tier: 4 },
    CYCLOPS:        { name: 'CYCLOPS',           emoji: '👁️', maxHp: 4400,  speed: 5000, damage: 11,  scoreMult: 2.2, bounty: 1500,  rec: 5, tier: 5 },
    SKELETON_MAGE:  { name: 'SKELETON MAGE',     emoji: '🧙‍♂️', maxHp: 1900, speed: 4300, damage: 12, scoreMult: 2.0, bounty: 1100,  rec: 4, tier: 6 },
    VAMPIRE:        { name: 'VAMPIRE',           emoji: '🧛', maxHp: 3950,  speed: 4800, damage: 8,  scoreMult: 2.4, bounty: 1800,  rec: 4, tier: 7 },
    FENRIR:         { name: 'FENRIR',            emoji: '🐺', maxHp: 3600,  speed: 4600, damage: 9,  scoreMult: 2.6, bounty: 2200,  rec: 5, tier: 8 },
    KRAKEN:         { name: 'KRAKEN',            emoji: '🦑', maxHp: 2700,  speed: 4600, damage: 10, scoreMult: 2.8, bounty: 2800,  rec: 6, tier: 9 },
    EXALTED_KNIGHT: { name: 'EXALTED KNIGHT',    emoji: '⚔️', maxHp: 2400,  speed: 4400, damage: 10, scoreMult: 3.0, bounty: 3300,  rec: 6, tier: 10 },
    DRAGON:         { name: 'ANCIENT DRAGON',    emoji: '🐉', maxHp: 2600,  speed: 4600, damage: 10, scoreMult: 3.2, bounty: 5000,  rec: 7, tier: 11 },
    MONSTER_KING:   { name: 'KING OF MONSTERS',  emoji: '👑', maxHp: 2850,  speed: 4400, damage: 12, scoreMult: 3.5, bounty: 10000, rec: 8, tier: 12 }
};

// HP บอสโตตามจำนวนคน แต่โตช้ากว่าพลังโจมตีรวม → ยิ่งมาเยอะยิ่งง่ายขึ้นแบบพอดี ๆ
function hpForParty(baseHp, n) {
    return Math.round(baseHp * (1 + 0.3 * (Math.max(1, n) - 1)));
}

// นับเป็น grapheme cluster (ตัวอักษรที่ผู้เล่นมองเห็น) แทน UTF-16 code unit
// ช่วยให้สระ/วรรณยุกต์ภาษาไทยที่ประกอบกันเป็นหนึ่งตัวอักษรไม่ถูกนับซ้ำ
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'grapheme' })
    : null;
function graphemeLength(value) {
    const text = String(value || '').normalize('NFC');
    return segmenter ? Array.from(segmenter.segment(text)).length : Array.from(text).length;
}

// คำคาถาภาษาไทยจับคู่กับคาถาอังกฤษตามลำดับ เพื่อให้ค่าพลังโจมตีเท่ากันทุกภาษา
const THAI_SPELL_TEXT = {
    Fire: ['ลูกไฟ', 'เพลิง', 'ดาวตก', 'ลาวาปะทุ', 'นรกอัคคี', 'เกราะเพลิง'],
    Water: ['สายน้ำ', 'คมวารี', 'ปืนน้ำ', 'คลื่นยักษ์', 'เกราะสมุทร', 'ภาพสะท้อน'],
    Wind: ['สายลม', 'คมวายุ', 'พายุหมุน', 'มหาพายุ', 'กำแพงลม', 'วายุสวนกลับ'],
    Earth: ['ก้อนหิน', 'ทุบศิลา', 'แผ่นดินไหว', 'ถล่มทวีป', 'เกราะปฐพี', 'หนามสะท้อน'],
    Lightning: ['ช็อต', 'ฟ้าผ่า', 'เทพอัสนี', 'สนามไฟฟ้า', 'สายฟ้าสวนกลับ'],
    Ice: ['เยือกเย็น', 'เกล็ดน้ำแข็ง', 'กัดน้ำแข็ง', 'ธารน้ำแข็งนิรันดร์', 'กำแพงเหมันต์', 'ผลึกสวนกลับ'],
    Light: ['ประกาย', 'แสงศักดิ์สิทธิ์', 'พิพากษา', 'ทัณฑ์สวรรค์', 'โล่แห่งแสง', 'ปริซึมศักดิ์สิทธิ์'],
    Dark: ['เงามืด', 'สสารมืด', 'หอกเงา', 'ฝันร้ายห้วงลึก', 'ม่านสุญญะ', 'เงาพิฆาต'],
    Psychic: ['ตั้งจิต', 'บดขยี้จิต', 'หอกพลังจิต', 'พลังจิตทำลายล้าง', 'ป้อมสมอง', 'คลื่นประสาท'],
    Necromancer: ['คำสาป', 'หอกกระดูก', 'เคียวมรณะ', 'กองทัพอันเดด', 'กำแพงกระดูก', 'สุสานพันธนาการ'],
    Blood: ['โลหิต', 'หอกเลือด', 'เลือดทะลัก', 'พิธีโลหิตชาด', 'เกราะเลือด', 'สวนกลับโลหิต'],
    Poison: ['พิษร้าย', 'กรดสาด', 'เขี้ยวมรณะ', 'พายุพิษระบาด', 'ม่านหมอกพิษ', 'เขี้ยวงูสวนกลับ'],
    Summoner: ['ภูตไฟ', 'อสูรพุ่งชน', 'อัญเชิญบาฮามุต', 'โกเลมพิทักษ์', 'ภูตสะท้อน', 'อัญเชิญสวนกลับ'],
    Hogwarts: ['น็อกซ์', 'ลูมอส', 'แอ็กซิโอ', 'ครูซิโอ', 'เรพาโร', 'สตูเปฟาย', 'โพรเทโก', 'อิมเพริโอ', 'ออบลิวิเอต', 'อาโลโฮโมรา', 'เซกตัมเซมปรา', 'เอ็กซ์เปลลิอาร์มุส', 'อะวาดา เคดาฟรา', 'เอกซ์เปกโต พาโทรนุม', 'วิงการ์เดียม เลวิโอซา'],
    NeoBlue: ['ลำแสง', 'เพลิงทำลายล้าง', 'สายฟ้าขาว', 'โจมตีสามรอบ', 'เพลิงกัลป์สามเศียร', 'เกล็ดมังกร', 'ปีกมังกรสะท้อน', 'ฟิวชั่นสวนกลับ'],
    ShadowMonarch: ['จงลุกขึ้น', 'ฉีกกระชาก', 'พุ่งมีดสั้น', 'ขว้างมีดสั้น', 'จิตสังหาร', 'กองทัพเงาถล่ม', 'ม่านเงา', 'แลกเปลี่ยนเงา', 'พาร์รีมีดสั้น'],
    Ra: ['เปลวเพลิง', 'สุริยัน', 'ระเบิดแสงตะวัน', 'เพลิงวิหค', 'เพลิงกัลป์สะท้านภพ', 'เกราะอัคนี', 'บูชายัญเทพ', 'ร่างเพลิง'],
    Slifer: ['คำราม', 'ปากแห่งสัจจะ', 'คลื่นสายฟ้ามรณะ', 'คลื่นกดดัน', 'สายฟ้าถล่มฟ้า', 'เกราะฟ้าคำราม', 'สายฟ้าขัดขวาง'],
    MegaRayquaza: ['พายุหมุน', 'ความเร็วแสง', 'ลำแสงนภา', 'ดาวตกมังกร', 'ทะยานฟ้ามังกร', 'เดลต้าสตรีม', 'ม่านมังกร', 'พายุสะท้อนกลับ', 'ก้าวพริบตา'],
    Obelisk: ['ต่อย', 'กำปั้นยักษ์', 'หมัดอัสนีบาต', 'หมัดพิฆาตวิญญาณคู่', 'เกราะเทพ', 'กำแพงหิน', 'หมัดสะท้อน', 'บูชายัญสวนกลับ']
};
const SPELLS_TH = Object.fromEntries(Object.entries(SPELLS).map(([className, pool]) => [
    className,
    pool.map((spell, index) => ({
        text: (THAI_SPELL_TEXT[className] || [])[index] || spell.text,
        kind: spell.kind,
        powerLength: graphemeLength(spell.text)
    }))
]));

function spellBaseLength(spell) {
    return Number.isFinite(spell.powerLength) ? spell.powerLength : graphemeLength(spell.text);
}
function spellDamage(spell) {
    return Math.round(spellBaseLength(spell) * 10 * KIND_RULES[spell.kind].mult);
}
function counterDamage(spell) {
    return Math.round(spellBaseLength(spell) * 10 * KIND_RULES.ctr.counterMult);
}


/* ======================= ระบบคอมโบ =======================
   - ร่ายคาถาติดกันโดยไม่โดนตี = คอมโบเพิ่มทีละ 1 (โล่ที่กันการโจมตีได้ ไม่ทำให้คอมโบขาด)
   - ตัวคูณคะแนน = 1 + step × (คอมโบ-1) แต่ไม่เกินเพดานของ "คำที่ยากที่สุดในสายคอมโบนั้น"
   - ทุกครั้งที่ร่ายสำเร็จ เวลาโจมตีของบอสจะถูกหน่วงออกไป (ไม่เกิน 1 รอบเต็ม)
     ปาร์ตี้หลายคนแชร์เวลาบอสร่วมกัน จึงหารปริมาณการหน่วงด้วยจำนวนผู้เล่นที่ยังสู้อยู่ ไม่งั้น 8 คนจะล็อกบอสไว้ตลอด
   - ชนะโดยไม่เสียพลังชีวิตเลย (No Damage) ได้โบนัสเพิ่มจากโบนัสชัยชนะ */
const COMBO = {
    step: 0.05,
    noDamageBonus: 0.5,
    tiers: {
        1: { name: 'ง่าย',   maxLen: 8,  cap: 1.2, delay: 0.25 },
        2: { name: 'ปานกลาง', maxLen: 14, cap: 1.4, delay: 0.5 },
        3: { name: 'ยาก',    maxLen: 99, cap: 1.6, delay: 1.0 }
    }
};
// 1 = ง่าย, 2 = ปานกลาง, 3 = ยาก (วัดจากความยาวฐานของคาถา ภาษาไทยกับอังกฤษจึงได้ระดับเท่ากัน)
function wordTier(spell) {
    const n = spellBaseLength(spell);
    return n <= COMBO.tiers[1].maxLen ? 1 : n <= COMBO.tiers[2].maxLen ? 2 : 3;
}
function comboMult(count, tier) {
    if (count <= 0 || !tier) return 1;
    return Math.min(COMBO.tiers[tier].cap, 1 + COMBO.step * (count - 1));
}
// เวลาที่หน่วงบอส (มิลลิวินาที) เมื่อร่ายคำระดับ tier ในปาร์ตี้ที่ยังสู้อยู่ n คน
function bossDelayMs(tier, speedMs, n) {
    return Math.round(COMBO.tiers[tier].delay * speedMs / Math.max(1, n));
}

const SHORT_MAX = 6; // ในมือต้องมีคาถาสั้นอย่างน้อย 1 ใบเสมอ ไม่งั้นคนพิมพ์ช้าจะค้างเพราะพิมพ์ไม่ทันก่อนโดนล้าง

function rollHand(className, hand, language = 'en') {
    const english = SPELLS[className] || SPELLS.Fire;
    const thai = SPELLS_TH[className] || SPELLS_TH.Fire;
    const pool = language === 'th' ? thai : (language === 'mix' ? [...english, ...thai] : english);
    const want = Math.min(3, pool.length);
    const out = (hand || []).filter(Boolean).slice(0, want);
    const taken = new Set(out.map(s => s.text));
    let guard = 0;
    while (out.length < want && guard++ < 200) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (!taken.has(s.text)) { taken.add(s.text); out.push(s); }
    }
    if (!out.some(s => graphemeLength(s.text) <= SHORT_MAX)) {
        const shorts = pool.filter(s => graphemeLength(s.text) <= SHORT_MAX && !taken.has(s.text));
        if (shorts.length) {
            // เปลี่ยนใบที่ยาวที่สุดเป็นคาถาสั้น
            let idx = 0;
            out.forEach((s, i) => { if (graphemeLength(s.text) > graphemeLength(out[idx].text)) idx = i; });
            out[idx] = shorts[Math.floor(Math.random() * shorts.length)];
        }
    }
    return out;
}

module.exports = { PLAYER_MAX_HP, KIND_RULES, SPELLS, SPELLS_TH, MONSTERS, hpForParty, spellDamage, counterDamage, graphemeLength, rollHand, SHORT_MAX, COMBO, wordTier, comboMult, bossDelayMs };
