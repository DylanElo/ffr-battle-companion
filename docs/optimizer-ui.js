// The party builder on the Party page: a short result, and what each piece does one tap away.
import {gearExplanation, abilityList, alwaysOnList, moveDetails} from './build-details.js?v=11';
const h = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = value => Array.isArray(value) ? value : [];
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const num = value => finite(value) ? Math.round(Number(value)).toLocaleString() : '—';
const clean = value => String(value ?? '').split('::').pop();
const joined = character => clean(character.joinStatus) === 'Join' && character.usable === true;
const option = (value, label, selected) => `<option value="${h(value)}" ${selected ? 'selected' : ''}>${h(label)}</option>`;
const face = (file, size = '') => file ? `<img class="face ${size}" src="img/${file}.webp" alt="" width="128" height="128" decoding="async">` : '';
const tabName = index => index === 0 ? 'Top result' : `Option ${index + 1}`;

const expected = damage => typeof damage === 'object' && damage !== null ? damage.expected ?? damage.mean : damage;

// `support` is the party's chosen support action: its caster gives up an attack, its targets hit harder.
function memberCard(member, indexes, support) {
  const evaluation = member.evaluation || {}, equipment = member.equipment || {};
  const character = indexes.characters.get(Number(member.characterId));
  const vision = indexes.visions.get(Number(member.visionId ?? equipment.visionId));
  const casting = Number(support?.characterId) === Number(member.characterId);
  const boosted = !casting && list(support?.targetIds).map(Number).includes(Number(member.characterId));
  const tags = [...(evaluation.canHeal ? ['Heals'] : []), ...(evaluation.canProtect ? ['Protects'] : []),
    ...(boosted ? [`${indexes.skills.get(Number(support.skillId))?.name || 'Support'} from ${indexes.characters.get(Number(support.characterId))?.name || 'an ally'}`] : [])];
  const outOfMp = list(evaluation.mpExhaustedRounds);
  const low = evaluation.damageMin ?? evaluation.damage?.min, high = evaluation.damageMax ?? evaluation.damage?.max;
  const limits = list(evaluation.limitUses);
  const ev = member.explanationEvaluation || evaluation, alwaysOn = alwaysOnList(member, indexes);
  return `<article class="member">
    <div class="member-who">${character ? face(`unit${character.id}`, 'md') : ''}<div>
      <h4>${h(character?.name || `#${member.characterId}`)}</h4>
      <span class="member-vision${vision ? '' : ' none'}">${vision ? face(`summon${vision.id}`, 'sm') : ''}${h(vision?.name || 'No Resonance')}</span>
    </div></div>
    <div class="member-hit">${moveDetails(evaluation, indexes)}
      ${casting ? '<b class="support">Support</b>' : `<b title="${finite(low) && finite(high) ? `${num(low)}–${num(high)}` : ''}">${num(expected(evaluation.damage))}</b>`}</div>
    ${limits.length ? `<p class="small member-lb">Limit Burst in round ${limits.map(u => num(u.round)).join(', ')}</p>` : ''}
    ${tags.length || outOfMp.length ? `<div class="tags">${tags.map(t => `<span>${h(t)}</span>`).join('')}${outOfMp.length ? `<span class="warn">Out of MP from round ${num(Math.min(...outOfMp))}</span>` : ''}</div>` : ''}
    ${gearExplanation(member, indexes)}
    <h5>Abilities <span class="dim">${num(ev.skillCost)} / ${num(ev.skillBudget)} AP</span></h5>
    ${abilityList(member, indexes)}
    ${alwaysOn ? `<h5>Always on</h5>${alwaysOn}` : ''}
  </article>`;
}

// Before/after: the recommended setup against the saved one, both scored by the same model. Shown only when the
// saved setup could be scored; otherwise there is nothing honest to compare against.
export function comparison(now, next) {
  const parts = [], change = now.damage > 0 ? Math.round((next.damage - now.damage) / now.damage * 100) : null;
  if (change !== null) parts.push(change ? `${change > 0 ? '+' : ''}${change}% damage` : 'Same damage');
  if (next.firstStagger && now.firstStagger && next.firstStagger !== now.firstStagger) {
    const n = Math.abs(now.firstStagger - next.firstStagger);
    parts.push(`staggers ${n} round${n > 1 ? 's' : ''} ${next.firstStagger < now.firstStagger ? 'sooner' : 'later'}`);
  } else if (next.firstStagger && !now.firstStagger) parts.push('now staggers');
  else if (!next.firstStagger && now.firstStagger) parts.push('no longer staggers');
  const better = change === null ? !!(next.firstStagger && (!now.firstStagger || next.firstStagger < now.firstStagger)) : change > 0;
  return `<p class="compare"><b class="${better ? 'good' : change === 0 ? '' : 'bad'}">${h(parts.join(', ') || 'Same as now')}</b>
    <span class="dim small">vs your current setup (${num(now.damage)} per round)</span></p>`;
}

const PICTURE_SHAPES = [['wide', 'Wide'], ['square', 'Square']];
export const shapeToggle = picture => `<span class="shape" role="group" aria-label="Picture shape">${PICTURE_SHAPES.map(([shape, label]) =>
  `<button type="button" class="chip" data-picture="${shape}" aria-pressed="${picture === shape}">${label}</button>`).join('')}</span>`;

function partyView(party, index, indexes, { canEquip, current, picture }) {
  const members = list(party.members ?? party.party), evaluated = party.evaluation || party;
  const summed = members.reduce((total, m) => total + (Number(expected(m.evaluation?.damage)) || 0), 0);
  const total = finite(evaluated.damage) ? evaluated.damage : summed;
  const facts = [evaluated.firstStagger ? `Staggers in round ${evaluated.firstStagger}` : '',
    Number(evaluated.breakDamage) > 0 ? `${num(evaluated.breakDamage)} stagger per round` : ''].filter(Boolean);
  return `<div class="party-head">
      <div class="party">${members.map(m => face(`unit${m.characterId}`, 'md')).join('')}</div>
      <div class="party-total"><strong>${num(total)}</strong><span>damage per round</span></div>
    </div>
    ${current ? comparison({ damage: current.damage, firstStagger: current.firstStagger }, { damage: total, firstStagger: evaluated.firstStagger }) : ''}
    ${facts.length ? `<p class="dim small">${h(facts.join(' · '))}</p>` : ''}
    <div class="toolbar">${canEquip ? `<button type="button" class="primary" data-equip-party-index="${index}">Equip in my save</button>
      <button type="button" data-apply-party-index="${index}">Edit gear</button>` : `<button type="button" class="primary" data-apply-party-index="${index}">Use this party</button>`}
      <button type="button" class="ghost" data-share-party-index="${index}" title="A picture of this party to paste into Discord">Copy image</button>${shapeToggle(picture)}</div>
    <div class="members">${members.map(m => memberCard(m, indexes, evaluated.supportUsed)).join('')}</div>`;
}

export function renderOptimizer({ catalog, snapshot, state = {}, result = null, busy = false, error = '', canEquip = false, fixedAgainst = false, picture = 'wide' }) {
  const indexes = Object.fromEntries(['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills', 'effects'].map(kind => [kind, new Map(list(catalog[kind]).map(item => [Number(item.id), item]))]));
  const people = list(snapshot?.characters).filter(joined).filter(c => indexes.characters.has(Number(c.id)));
  const fixed = list(state.fixedCharacterIds).map(Number);
  const results = list(result?.results), pick = Math.min(state.partyIndex || 0, Math.max(0, results.length - 1));
  const off = busy ? 'disabled' : '';
  const toggle = (id, on, label) => `<label class="chip-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${off}><span>${label}</span></label>`;
  const settings = `<div class="party-controls">
      ${fixedAgainst ? '' : `<label class="against"><span class="dim small">Against</span><select id="optimizer-against" ${off}>${[['enemy', 'This enemy'], ['general', 'Any fight']].map(([id, label]) => option(id, label, (state.against || 'enemy') === id)).join('')}</select></label>`}
      <span class="dim small">Build for</span><div class="chips" role="group" aria-label="Build for">${[['damage', 'Damage'], ['stagger', 'Stagger'], ['limit', 'Limit Burst'], ['durability', 'Durability']].map(([id, label]) => `<label class="chip-check"><input type="checkbox" data-party-goal="${id}" ${list(state.goals).includes(id) ? 'checked' : ''} ${off}><span>${label}</span></label>`).join('')}</div>
      <span class="dim small">Must have</span>${toggle('optimizer-healer', state.minHealers, 'Healer')}${toggle('optimizer-protector', state.minProtectors, 'Protection')}
      <details class="more" data-keep="party-more"><summary>More</summary><div>
        <p class="dim small">Always in the party</p>
        <div class="locks">${people.map(c => `<label class="chip-check"><input type="checkbox" data-optimizer-lock="${c.id}" ${fixed.includes(Number(c.id)) ? 'checked' : ''} ${busy || fixed.length >= 4 && !fixed.includes(Number(c.id)) ? 'disabled' : ''}><span>${face(`unit${c.id}`, 'sm')}${h(indexes.characters.get(Number(c.id)).name)}</span></label>`).join('')}</div>
        <details data-keep="party-expert"><summary>Expert scenario</summary><div class="expert">
          <label>Difficulty <select id="optimizer-difficulty" ${off}>${[['save', 'From save'], ['Easy', 'Easy'], ['Normal', 'Normal'], ['Expert', 'Expert']].map(([id, label]) => option(id, label, (state.difficulty || 'save') === id)).join('')}</select></label>
          <label>MP available <input type="number" id="optimizer-mp" min="0" max="100" step="1" value="${h(state.mpPercent ?? 100)}" ${off}>%</label>
          <label>Incoming hit damage <input type="number" id="optimizer-incoming-damage" min="0" max="99999999" step="1" value="${h(state.incomingDamage ?? 0)}" ${off}></label>
          <label>Incoming hit type <select id="optimizer-incoming-type" ${off}>${[['Physic', 'Physical'], ['Magic', 'Magic']].map(([value, label]) => option(value, label, (state.incomingType || 'Physic') === value)).join('')}</select></label>
          <p class="dim small">One fixed hit per character after acting, each round. Damage is after defense, before Mirror reduction. Set 0 for no incoming hits.</p>
          <label class="check"><input type="checkbox" id="optimizer-broken" ${state.broken ? 'checked' : ''} ${off}> Enemy already broken</label>
          <label class="check"><input type="checkbox" id="optimizer-critical" ${state.critical ? 'checked' : ''} ${off}> Assume critical hits</label>
        </div></details>
      </div></details>
      ${busy ? '<button type="button" data-cancel-party>Cancel</button>' : `<button type="button" class="primary" data-solve-party ${people.length < 4 ? 'disabled' : ''}>${result ? 'Search again' : 'Find the best party'}</button>`}
    </div>`;
  let body;
  if (busy) body = `<p class="dim" role="status">${h(state.progress || 'Searching your characters, Resonances, gear and abilities…')}</p>`;
  else if (results.length) body = `${results.length > 1 ? `<div class="tabs" role="tablist">${results.map((_, i) => `<button type="button" role="tab" aria-selected="${i === pick}" data-party-tab="${i}">${tabName(i)}</button>`).join('')}</div>` : ''}
    ${partyView(results[pick], pick, indexes, { canEquip, current: result.current, picture })}`;
  else if (result) body = '<p>No party fits those requirements. Try turning off Healer or Protection, or lock fewer characters.</p>';
  else body = `<p class="dim">${people.length < 4 ? 'You need four recruited characters to build a party.' : 'Finds the strongest party of four you can field, with their gear and Resonances.'}</p>`;
  return `<div class="party-panel" aria-busy="${busy}">${settings}${error ? `<p class="bad small" role="alert">${h(error)}</p>` : ''}${body}</div>`;
}
