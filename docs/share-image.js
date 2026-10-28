// A party result as a picture to paste into Discord, drawn on a canvas from the site's own font and portraits.
import { commandPlan } from './build-details.js?v=11';

const list = value => Array.isArray(value) ? value : [];
const whole = value => Math.round(Number(value) || 0).toLocaleString('en-US');
const expected = damage => typeof damage === 'object' && damage !== null ? damage.expected ?? damage.mean : damage;
const MAX_ABILITIES = 6;
const GEAR_LABELS = ['Weapon', 'Armor', 'Acc. 1', 'Acc. 2', 'Acc. 3', 'Acc. 4'];

/** What the picture says, kept apart from the drawing so it can be checked without a canvas. */
export function shareCard(party, indexes, { heading = 'Best party', title = 'Any fight', current = null, weak = [] } = {}) {
  const members = list(party.members), evaluated = party.evaluation || {}, support = evaluated.supportUsed;
  const total = Number.isFinite(Number(evaluated.damage)) ? Number(evaluated.damage)
    : members.reduce((sum, m) => sum + (Number(expected(m.evaluation?.damage)) || 0), 0);
  const change = current?.damage > 0 ? Math.round((total - current.damage) / current.damage * 100) : 0;
  const named = (kind, id, empty) => indexes[kind]?.get(Number(id))?.name || (Number(id) > 0 ? `New #${id}` : empty);
  return {
    heading, title, total: whole(total), weak: list(weak),
    change: change ? `${change > 0 ? '+' : ''}${change}% vs current setup` : '',
    members: members.map(m => {
      const ev = m.evaluation || {}, e = m.equipment || {}, visionId = Number(m.visionId ?? e.visionId);
      const abilities = list((m.explanationEvaluation || ev).equippedSkillIds)
        .map(id => (indexes.skills?.get(Number(id)) || indexes.passives?.get(Number(id)) || indexes.masterSkills?.get(Number(id)))?.name).filter(Boolean);
      return {
        id: Number(m.characterId), visionId, name: named('characters', m.characterId, `#${m.characterId}`),
        resonance: named('visions', visionId, 'No Resonance'),
        move: commandPlan(ev, indexes) || indexes.skills?.get(Number(ev.skillId))?.name || 'No attack',
        damage: Number(support?.characterId) === Number(m.characterId) ? 'Support' : whole(expected(ev.damage)),
        gear: [e.weaponId, e.armorId, ...list(e.accessoryIds)].map((id, i) => ({ label: GEAR_LABELS[i], name: named('equipment', id, '—') })),
        abilities: abilities.length > MAX_ABILITIES ? [...abilities.slice(0, MAX_ABILITIES - 1), `+${abilities.length - MAX_ABILITIES + 1} more`] : abilities,
      };
    }),
  };
}

// ---------- drawing ----------

const PAD = 40, GAP = 20, HEADER = 168, FOOTER = 76, SQUARE = 1080, MAX_ZOOM = 2;

/**
 * Where each member's panel goes. Wide: a party fills four columns of a 1200 px card, one character an 840 px card.
 * Square (for phones): 1080 × 1080, members two to a row, each panel with gear and abilities side by side.
 * A single build in the square is the same panel drawn larger (`zoom`), centered.
 */
export function cardLayout({ members, gearRows = 4, abilityRows = 1, square = false }) {
  const width = square ? SQUARE : members > 1 ? 1200 : 840;
  const cols = square ? Math.min(2, members) : members, rows = Math.ceil(members / cols);
  const w = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const content = square ? 182 + Math.max(gearRows * 26, 24 + abilityRows * 22) + 8 : 182 + gearRows * 26 + 42 + abilityRows * 24;
  const height = square ? SQUARE : HEADER + 8 + content + FOOTER;
  const body = height - HEADER - FOOTER;
  if (square && members === 1) {
    const zoom = Math.min(MAX_ZOOM, body / content), h = content * zoom;
    return { width, height, cells: [{ x: PAD, y: HEADER + (body - h) / 2, w, h, zoom }], split: true };
  }
  const h = square ? (body - GAP * (rows - 1)) / rows : content;
  const cells = Array.from({ length: members }, (_, i) => ({ x: PAD + (i % cols) * (w + GAP), y: HEADER + Math.floor(i / cols) * (h + GAP), w, h, zoom: 1 }));
  return { width, height, cells, split: square };
}
const COLORS = { top: '#34509f', bottom: '#141f5c', frame: '#e9ecf8', ink: '#ffffff', dim: '#aab4dc', gold: '#ffd75e',
  good: '#8fe3b0', line: 'rgba(233, 236, 248, .18)', panel: 'rgba(10, 15, 46, .35)', night: '#0c1230' };
// The site's element colours (style.css), so a weakness reads the same in the picture as on the page.
const ELEMENT_COLORS = { Fire: '#ff7a59', Ice: '#8fe0ff', Wind: '#8fe3a0', Earth: '#d9a865', Thunder: '#ffe066', Water: '#6fa8ff', Light: '#fff4c9', Dark: '#c49bff' };
const SITE = 'dylanelo.github.io/ffr-battle-companion';

function loadImage(file) {
  const image = new Image();
  image.src = `img/${file}.webp`;
  // A missing portrait leaves its space empty rather than failing the whole picture.
  return image.decode().then(() => image, () => null);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function text(g, value, x, y, { size = 16, weight = 400, color = COLORS.ink, align = 'left', max = Infinity, shrinkTo = size } = {}) {
  g.font = `${weight} ${size}px Chivo, system-ui, sans-serif`; g.fillStyle = color; g.textAlign = align;
  // Names shrink a little to fit before they lose letters.
  while (size > shrinkTo && g.measureText(String(value)).width > max) g.font = `${weight} ${--size}px Chivo, system-ui, sans-serif`;
  let shown = String(value);
  // Long names end in an ellipsis instead of running into the next column.
  if (g.measureText(shown).width > max) {
    while (shown.length > 1 && g.measureText(`${shown}…`).width > max) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  g.fillText(shown, x, y);
}

function divider(g, x, y, w) { g.fillStyle = COLORS.line; g.fillRect(x, y, w, 1); }

// "Weak to" followed by one outlined chip per element, like the page's element badges.
function drawWeaknesses(g, elements, x, y) {
  text(g, 'Weak to', x, y, { size: 15, color: COLORS.dim });
  let left = x + g.measureText('Weak to').width + 12;
  for (const element of elements) {
    const color = ELEMENT_COLORS[element] || COLORS.ink;
    g.font = '700 15px Chivo, system-ui, sans-serif';
    const width = g.measureText(element).width + 34;
    g.fillStyle = 'rgba(5, 9, 34, .3)'; roundRect(g, left, y - 18, width, 26, 13); g.fill();
    g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(left + 13, y - 5, 4, 0, Math.PI * 2); g.fill();
    text(g, element, left + 23, y, { size: 15, weight: 700, color });
    left += width + 8;
  }
}

// Draws a member's panel in its cell, scaled by the cell's zoom.
function drawCell(g, m, { x, y, w, h, zoom }, split, images) {
  g.save(); g.translate(x, y); g.scale(zoom, zoom);
  drawMember(g, m, { x: 0, y: 0, w: w / zoom, h: h / zoom }, split, images);
  g.restore();
}

function drawMember(g, m, { x, y, w: COL, h }, split, images) {
  g.fillStyle = COLORS.panel; roundRect(g, x, y, COL, h, 10); g.fill();
  g.strokeStyle = COLORS.line; g.lineWidth = 1; g.stroke();
  const portrait = images.get(`unit${m.id}`), icon = images.get(`summon${m.visionId}`);
  if (portrait) g.drawImage(portrait, x + 14, y + 14, 88, 88);
  text(g, m.name, x + 112, y + 48, { size: 22, weight: 700, max: COL - 124, shrinkTo: 16 });
  if (icon) g.drawImage(icon, x + 110, y + 60, 28, 28);
  text(g, m.resonance, x + (icon ? 142 : 112), y + 81, { size: 16, color: m.resonance === 'No Resonance' ? COLORS.dim : COLORS.gold, max: COL - 154 });
  const support = m.damage === 'Support';
  text(g, m.damage, x + COL - 14, y + 136, { size: support ? 18 : 24, weight: 900, color: support ? COLORS.good : COLORS.ink, align: 'right' });
  const damageWidth = g.measureText(m.damage).width;
  text(g, m.move, x + 14, y + 136, { size: 16, max: COL - 42 - damageWidth });
  divider(g, x + 14, y + 154, COL - 28);
  // Split panels (square card) put abilities beside the gear instead of under it.
  const gearWidth = split ? (COL - 28) / 2 : COL - 28;
  m.gear.forEach((slot, i) => {
    text(g, slot.label, x + 14, y + 182 + i * 26, { size: 13, color: COLORS.dim });
    text(g, slot.name, x + 76, y + 182 + i * 26, { size: 15, weight: 700, color: slot.name === '—' ? COLORS.dim : COLORS.ink, max: gearWidth - 66 });
  });
  const names = m.abilities.length ? m.abilities : ['None needed'], color = m.abilities.length ? COLORS.ink : COLORS.dim;
  if (split) {
    const left = x + 14 + gearWidth + 14;
    g.fillStyle = COLORS.line; g.fillRect(left - 8, y + 166, 1, h - 180);
    text(g, 'Abilities', left, y + 176, { size: 13, weight: 700, color: COLORS.gold });
    names.forEach((name, i) => text(g, name, left, y + 200 + i * 22, { size: 15, color, max: x + COL - 14 - left }));
    return;
  }
  const top = y + 182 + m.gear.length * 26;
  divider(g, x + 14, top - 8, COL - 28);
  text(g, 'Abilities', x + 14, top + 16, { size: 13, weight: 700, color: COLORS.gold });
  names.forEach((name, i) => text(g, name, x + 14, top + 42 + i * 24, { size: 15, color, max: COL - 28 }));
}

/** Draws the card as a PNG. `faces` maps enemy ids to their portrait file, as in data/faces.json. */
export async function partyImage(card, { faces = {}, bossId = null, square = false } = {}) {
  await Promise.all([400, 700, 900].map(weight => document.fonts.load(`${weight} 20px Chivo`)));
  const files = [...card.members.flatMap(m => [`unit${m.id}`, m.visionId > 0 ? `summon${m.visionId}` : null]), bossId ? faces[bossId] : null].filter(Boolean);
  const images = new Map((await Promise.all(files.map(async file => [file, await loadImage(file)]))).filter(([, image]) => image));
  const gearRows = Math.max(...card.members.map(m => m.gear.length), 4), abilityRows = Math.max(1, ...card.members.map(m => m.abilities.length));
  const { width: W, height, cells, split } = cardLayout({ members: card.members.length, gearRows, abilityRows, square });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.night; g.fillRect(0, 0, W, height);
  const fill = g.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, COLORS.top); fill.addColorStop(1, COLORS.bottom);
  g.fillStyle = fill; roundRect(g, 6, 6, W - 12, height - 12, 14); g.fill();
  g.strokeStyle = COLORS.frame; g.lineWidth = 3; g.stroke();

  const boss = images.get(bossId ? faces[bossId] : '');
  if (boss) g.drawImage(boss, PAD, 34, 104, 104);
  const left = boss ? PAD + 124 : PAD;
  const weak = card.weak.length > 0;
  text(g, card.heading, left, weak ? 62 : 72, { size: 18, color: COLORS.dim });
  text(g, card.title, left, weak ? 102 : 112, { size: 34, weight: 900, max: W - left - (W < 1200 ? 270 : 380), shrinkTo: 24 });
  if (weak) drawWeaknesses(g, card.weak, left, 144);
  text(g, card.total, W - PAD, 92, { size: 54, weight: 900, color: COLORS.gold, align: 'right' });
  text(g, 'damage per round', W - PAD, 120, { size: 17, color: COLORS.dim, align: 'right' });
  if (card.change) text(g, card.change, W - PAD, 146, { size: 17, weight: 700, color: COLORS.good, align: 'right' });

  card.members.forEach((m, i) => drawCell(g, m, cells[i], split, images));
  text(g, 'Resonance Battle Companion', PAD, height - 34, { size: 16, weight: 700 });
  text(g, SITE, W - PAD, height - 34, { size: 16, color: COLORS.dim, align: 'right' });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be created.')), 'image/png'));
}
