// One equipment or Resonance slot: the current piece with what it does, and (when open) every choice with its change.
import { h } from './build-details.js?v=13';

const para = (cls, text) => text ? `<p class="${cls}">${h(text)}</p>` : '';
const effects = list => (list || []).map(e => `<p class="dim small"><b>${h(e.name)}</b>${e.text ? ` — ${h(e.text)}` : ''}</p>`).join('');

export function renderSlot({ key, label, current, locked, open, changed = false }) {
  const k = h(key), canLock = Number(current.id) > 0;
  locked = canLock && locked;
  return `<section class="slot${changed ? ' changed' : ''}">
    <div class="slot-head"><span class="dim small">${h(label)}</span>
      <button type="button" class="ghost" data-lock="${k}" aria-label="${locked ? 'Unlock' : 'Lock'} ${h(label)}" aria-pressed="${locked ? 'true' : 'false'}" title="${canLock ? 'Keep this when building' : 'Choose a piece before locking this slot'}"${canLock ? '' : ' disabled'}>${locked ? 'Locked' : 'Lock'}</button>
      <button type="button" class="ghost" data-open-slot="${k}" data-key="slot-${k}" aria-label="Change ${h(label)}" aria-haspopup="dialog" aria-expanded="${open ? 'true' : 'false'}">Change</button></div>
    <div class="slot-current"><strong>${h(current.name)}</strong>${para('dim small', current.statsText)}
      ${current.text || current.effects?.length ? `<details data-keep="piece-${k}"><summary>Details</summary>${para('dim small', current.text)}${effects(current.effects)}</details>` : ''}</div>
  </section>`;
}

export function renderPicker({ key, label, current, choices }) {
  return `<dialog class="window slot-picker" id="slot-picker" aria-labelledby="picker-title">
    <div class="picker-head"><div><p class="dim small">Choose a piece</p><h2 id="picker-title">${h(label)}</h2></div><button type="button" data-close-picker data-key="picker-close">Close</button></div>
    <p class="dim small">Select to equip. Stat changes compare with your current draft.</p>
    <label class="picker-search">Search names, stats or effects<input type="search" id="slot-q" data-key="slot-q" placeholder="Search ${h(label.toLowerCase())}" autocomplete="off" autofocus></label>
    <p class="small" id="picker-count" role="status">${choices.length} choices</p>
    <div class="choices">${choices.map(c => `<button type="button" class="choice" data-key="choice-${h(c.id)}" data-pick-slot="${h(key)}" data-id="${h(c.id)}" aria-pressed="${c.id === current.id}">
      <span class="choice-name"><strong>${h(c.name)}</strong>${c.id === current.id ? '<span class="planned">Equipped</span>' : ''}</span>${para('dim small', c.statsText)}${para('delta small', c.delta)}${para('dim small', c.text)}${effects(c.effects)}</button>`).join('')}</div>
    <p id="picker-empty" class="dim" hidden>No matching pieces. Try another name, stat or effect.</p>
  </dialog>`;
}

export function filterAvailableAbilities(abilities, equippedIds, reasons = {}, filters = {}) {
  const on = new Set(equippedIds), q = String(filters.q || '').trim().toLowerCase();
  return abilities.filter(a => !on.has(a.id)
    && (!q || `${a.name} ${a.text || ''}`.toLowerCase().includes(q))
    && (!filters.kind || filters.kind === 'all' || a.kind === filters.kind)
    && (!filters.affordable || !reasons[a.id]));
}

/** Equipped abilities use the same Change interaction as gear; the catalog appears only in the picker. */
export function renderAbilityList({ abilities, equippedIds, load, lockedIds = [], openSlot = null }) {
  const byId = new Map(abilities.map(a => [a.id, a])), ids = equippedIds, pinned = new Set(lockedIds);
  const count = Number.isInteger(load.maxSlots) && load.maxSlots >= 0 ? load.maxSlots : 0;
  const cards = Array.from({ length: count }, (_, slotIndex) => {
    const id = Number(ids[slotIndex]) > 0 ? ids[slotIndex] : null, a = byId.get(id), key = `skill:${slotIndex}`, label = `Ability ${slotIndex + 1}`;
    const name = a?.name || (id ? `Ability #${id}` : 'Empty'), locked = pinned.has(id);
    return `<section class="slot ability-slot${id ? '' : ' is-empty'}">
      <div class="slot-head"><span class="dim small">${label}</span>
        ${id ? `<button type="button" class="ghost" data-lock="skill:${h(id)}" aria-label="${locked ? 'Unlock' : 'Lock'} ${h(name)}" aria-pressed="${locked}" title="Keep this when building">${locked ? 'Locked' : 'Lock'}</button>` : '<button type="button" class="ghost" disabled title="Choose an ability before locking this slot">Lock</button>'}
        <button type="button" class="ghost" data-open-slot="${key}" data-key="slot-${key}" aria-label="Change ${label}${id ? ` (${h(name)})` : ''}" aria-haspopup="dialog" aria-expanded="${openSlot === key}">Change</button></div>
      <div class="slot-current"><strong>${h(name)}</strong>${a ? para('dim small', `${a.cost} AP`) : ''}
        ${a?.text ? `<details data-keep="piece-${key}"><summary>Details</summary>${para('dim small', a.text)}</details>` : ''}</div>
    </section>`;
  }).join('');
  return `<p class="ability-load">${h(load.used)} / ${h(load.budget)} AP · ${h(load.slots)} / ${h(load.maxSlots)} slots</p>
    <div class="ability-slot-grid">${cards}</div>`;
}

/** reasons are computed with this slot removed; a lock only protects it from Build. */
export function renderAbilityPicker({ abilities, equippedIds, load, lockedIds = [], reasons = {}, filters = {}, slotIndex }) {
  const currentId = Number(equippedIds[slotIndex]) > 0 ? equippedIds[slotIndex] : null;
  const current = currentId ? abilities.find(a => a.id === currentId) || { id: currentId, name: `Ability #${currentId}`, cost: null, text: '' } : null;
  const available = filterAvailableAbilities(abilities, equippedIds, reasons, filters);
  const totalAvailable = abilities.filter(a => !equippedIds.includes(a.id)).length;
  const choice = a => {
    const isCurrent = a.id === currentId, why = isCurrent ? '' : reasons[a.id];
    return `<button type="button" class="choice" data-key="ability-choice-${h(a.id)}" data-pick-ability="${h(a.id)}" aria-pressed="${isCurrent}"${why ? ' disabled' : ''}>
      <span class="choice-name"><strong>${h(a.name)}</strong>${isCurrent ? '<span class="planned">Equipped</span>' : ''}</span>
      ${Number.isFinite(a.cost) ? para('dim small', `${a.cost} AP`) : ''}${para('dim small', a.text)}${why ? para('note small', why) : ''}</button>`;
  };
  return `<dialog class="window slot-picker ability-picker" id="slot-picker" aria-labelledby="picker-title">
    <div class="picker-head"><div><p class="dim small">Choose an ability</p><h2 id="picker-title">Ability ${h(slotIndex + 1)}</h2></div><button type="button" data-close-picker data-key="picker-close">Close</button></div>
    <p class="ability-load">${h(load.used)} / ${h(load.budget)} AP · ${h(load.slots)} / ${h(load.maxSlots)} slots</p>
    ${current && lockedIds.includes(currentId) ? '<p class="dim small">Locked for Build. You can still change this slot.</p>' : ''}
    <div class="ability-filters">
      <label>Search abilities<input type="search" id="ability-q" data-key="ability-q" data-ability-filter="q" value="${h(filters.q || '')}" placeholder="Search names or descriptions"></label>
      <label>Ability type<select id="ability-kind" data-key="ability-kind" data-ability-filter="kind">${[['all', 'All types'], ['active', 'Active'], ['passive', 'Passive'], ['master', 'Mastery']].map(([value, label]) => `<option value="${value}"${(filters.kind || 'all') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="ability-affordable" data-key="ability-affordable" data-ability-filter="affordable"${filters.affordable ? ' checked' : ''}> Can equip now</label>
    </div>
    <p class="dim small" role="status">${available.length} of ${totalAvailable} available abilities</p>
    <div class="choices">
      <button type="button" class="choice" data-key="ability-choice-empty" data-pick-ability="-1" aria-pressed="${!current}"><span class="choice-name"><strong>Empty</strong></span><p class="dim small">Remove the ability from this slot.</p></button>
      ${current ? choice(current) : ''}${available.map(choice).join('')}
    </div>
    ${available.length ? '' : `<p class="dim small">${totalAvailable ? 'No abilities match these filters. Try another search or change the filters.' : 'No other learned abilities.'}</p>`}
  </dialog>`;
}
