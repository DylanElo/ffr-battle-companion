// The "Best party" panel on the Fight page. The encounter is chosen by the Fight page's enemy list.
const h = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = value => Array.isArray(value) ? value : [];
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const num = value => finite(value) ? Math.round(Number(value)).toLocaleString() : '—';
const clean = value => String(value ?? '').split('::').pop();
const joined = character => clean(character.joinStatus) === 'Join' && character.usable === true;
const option = (value, label, selected) => `<option value="${h(value)}" ${selected ? 'selected' : ''}>${h(label)}</option>`;
const face = (file, size = '') => file ? `<img class="face ${size}" src="img/${file}.webp" alt="" width="128" height="128" decoding="async">` : '';
const tabName = index => index === 0 ? 'Best' : `Option ${index + 1}`;

function text(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return value.reason || value.description || value.name || value.message || value.label || JSON.stringify(value);
}
const bullets = values => list(values).length ? `<ul class="notes">${values.map(value => `<li>${h(text(value))}</li>`).join('')}</ul>` : '';
const expected = damage => typeof damage === 'object' && damage !== null ? damage.expected ?? damage.mean : damage;

function memberCard(member, indexes) {
  const evaluation = member.evaluation || {}, equipment = member.equipment || {};
  const character = indexes.characters.get(Number(member.characterId));
  const vision = indexes.visions.get(Number(member.visionId ?? equipment.visionId));
  const skill = indexes.skills.get(Number(evaluation.skillId ?? evaluation.actionId));
  const find = (kind, id) => indexes[kind].get(Number(id))?.name;
  const gear = [equipment.weaponId, equipment.armorId, ...list(equipment.accessoryIds)].map(id => find('equipment', id)).filter(Boolean);
  const passiveIds = list(evaluation.passiveIds ?? evaluation.equippedPassiveIds);
  const analysis = evaluation.passiveAnalysis || evaluation.passives || {};
  const applied = evaluation.appliedSynergies || evaluation.applied || analysis.applied || [];
  const excluded = [...list(evaluation.unsupported ?? analysis.unsupported), ...list(evaluation.deferred ?? analysis.deferred)];
  const abilities = list(evaluation.equippedSkillIds).map(id => indexes.skills.get(Number(id))?.name || indexes.passives.get(Number(id))?.name || indexes.masterSkills.get(Number(id))?.name).filter(Boolean);
  const tags = [...(evaluation.canHeal ? ['Heals'] : []), ...(evaluation.canProtect ? ['Protects'] : [])];
  const low = evaluation.damageMin ?? evaluation.damage?.min, high = evaluation.damageMax ?? evaluation.damage?.max;
  return `<article class="member">
    <div class="member-who">${character ? face(`unit${character.id}`, 'md') : ''}<div>
      <h4>${h(character?.name || `#${member.characterId}`)}</h4>
      <span class="member-vision">${vision ? face(`summon${vision.id}`, 'sm') : ''}${h(vision?.name || '—')}</span>
    </div></div>
    <div class="member-hit"><span>${h(skill?.name || 'No damaging action')}${evaluation.actionCount > 1 ? ' ×2' : ''}${skill ? ` <small>${num(evaluation.turnMp ?? skill.cost)} MP${[evaluation.multiActionId && indexes.skills.get(evaluation.multiActionId)?.name, evaluation.magicBoost && 'Magic Boost'].filter(Boolean).map(t => ` · ${h(t)}`).join('')}</small>` : ''}</span>
      <b title="${finite(low) && finite(high) ? `${num(low)}–${num(high)}` : ''}">${num(expected(evaluation.damage))}</b></div>
    ${list(evaluation.limitUses).length ? `<p class="small member-lb">Limit Burst: ${list(evaluation.limitUses).map(u => `${h(indexes.skills.get(Number(u.skillId))?.name)} in round ${u.round}`).join(', ')}</p>` : ''}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
    <p class="member-gear">${gear.map(h).join(' · ') || 'No equipment'}</p>
    <details><summary>Abilities and effects</summary>
      ${abilities.length ? `<p class="small">${abilities.map(h).join(', ')}</p>` : ''}
      ${passiveIds.length ? `<ul class="skills">${passiveIds.map(id => { const p = indexes.passives.get(Number(id)); return `<li><b>${h(p?.name || `Passive #${id}`)}</b><p>${h(p?.desc)}</p></li>`; }).join('')}</ul>` : ''}
      ${list(applied).length ? `<h5>Counted</h5>${bullets(applied)}` : ''}
      ${excluded.length ? `<h5>Not counted</h5>${bullets(excluded)}` : ''}
      ${list(evaluation.warnings).length ? `<h5>Limits</h5>${bullets(evaluation.warnings)}` : ''}
    </details>
  </article>`;
}

// Before/after: the recommended setup against the saved one, both scored by the same model.
export function comparison(now, next) {
  if (!now) return '<p class="compare dim small">Your current setup has no usable attack in this fight, so there’s nothing to compare.</p>';
  const parts = [], change = now.damage > 0 ? Math.round((next.damage - now.damage) / now.damage * 100) : null;
  if (change !== null) parts.push(change ? `${change > 0 ? '+' : ''}${change}% damage` : 'same damage');
  if (next.firstStagger && now.firstStagger && next.firstStagger !== now.firstStagger) {
    const n = Math.abs(now.firstStagger - next.firstStagger);
    parts.push(`staggers ${n} round${n > 1 ? 's' : ''} ${next.firstStagger < now.firstStagger ? 'sooner' : 'later'}`);
  } else if (next.firstStagger && !now.firstStagger) parts.push('staggers within the fight (yours doesn’t)');
  else if (!next.firstStagger && now.firstStagger) parts.push('no longer staggers within the fight');
  const better = change === null ? !!(next.firstStagger && (!now.firstStagger || next.firstStagger < now.firstStagger)) : change > 0;
  return `<p class="compare small"><span class="dim">Now: ${num(now.damage)} damage per round${now.firstStagger ? `, staggers in round ${now.firstStagger}` : ''}.</span>
    <b class="${better ? 'good' : change === 0 ? '' : 'bad'}">${h(parts.join(', ') || 'Same as now')}</b></p>`;
}

function partyView(party, index, indexes, canEquip, current) {
  const members = list(party.members ?? party.party), evaluated = party.evaluation || party;
  const summed = members.reduce((total, m) => total + (Number(expected(m.evaluation?.damage)) || 0), 0);
  return `<div class="party-head">
      <div class="party">${members.map(m => face(`unit${m.characterId}`, 'md')).join('')}</div>
      <div class="party-total"><strong>${num(finite(evaluated.damage) ? evaluated.damage : summed)}</strong><span>damage per round over ${num(evaluated.rounds || 5)} rounds${finite(evaluated.breakDamage) ? `, stagger ${num(evaluated.breakDamage)} per round` : ''}${evaluated.firstStagger ? `, staggers in round ${evaluated.firstStagger}` : ''}</span></div>
    </div>
    ${current !== undefined ? comparison(current && { damage: current.damage, firstStagger: current.firstStagger }, { damage: finite(evaluated.damage) ? evaluated.damage : summed, firstStagger: evaluated.firstStagger }) : ''}
    ${evaluated.supportDescription ? `<p class="good small">${h(evaluated.supportDescription)}</p>` : ''}
    <div class="members">${members.map(m => memberCard(m, indexes)).join('')}</div>
    ${bullets(evaluated.warnings)}
    <div class="toolbar">${canEquip ? `<button type="button" class="primary" data-equip-party-index="${index}">Equip in my save</button>
      <button type="button" data-apply-party-index="${index}">Plan only</button>` : `<button type="button" class="primary" data-apply-party-index="${index}">Use this party</button>`}
      <button type="button" class="ghost" data-export-party="${index}">Export</button>
      <span class="dim small">${canEquip ? 'Downloads your save with this party equipped, plus a backup.' : 'Fills in their gear on the Characters page.'}</span></div>`;
}

export function renderOptimizer({ catalog, snapshot, state = {}, result = null, busy = false, error = '', canEquip = false, fixedAgainst = false }) {
  const indexes = Object.fromEntries(['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills'].map(kind => [kind, new Map(list(catalog[kind]).map(item => [Number(item.id), item]))]));
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
        <label>Difficulty <select id="optimizer-difficulty" ${off}>${[['save', 'From save'], ['Easy', 'Easy'], ['Normal', 'Normal'], ['Expert', 'Expert']].map(([id, label]) => option(id, label, (state.difficulty || 'save') === id)).join('')}</select></label>
        <label>MP available <input type="number" id="optimizer-mp" min="0" max="100" step="1" value="${h(state.mpPercent ?? 100)}" ${off}>%</label>
        <label class="check"><input type="checkbox" id="optimizer-broken" ${state.broken ? 'checked' : ''} ${off}> Enemy already broken</label>
        <label class="check"><input type="checkbox" id="optimizer-critical" ${state.critical ? 'checked' : ''} ${off}> Assume critical hits</label>
        <p class="dim small">Always in the party:</p>
        <div class="locks">${people.map(c => `<label class="chip-check"><input type="checkbox" data-optimizer-lock="${c.id}" ${fixed.includes(Number(c.id)) ? 'checked' : ''} ${busy || fixed.length >= 4 && !fixed.includes(Number(c.id)) ? 'disabled' : ''}><span>${face(`unit${c.id}`, 'sm')}${h(indexes.characters.get(Number(c.id)).name)}</span></label>`).join('')}</div>
      </div></details>
      ${busy ? '<button type="button" data-cancel-party>Cancel</button>' : `<button type="button" class="primary" data-solve-party ${people.length < 4 ? 'disabled' : ''}>${result ? 'Search again' : 'Find the best party'}</button>`}
    </div>`;
  let body;
  if (busy) body = `<p class="dim" role="status">${h(state.progress || 'Searching your characters, Resonances, gear and abilities…')}</p>`;
  else if (results.length) body = `${results.length > 1 ? `<div class="tabs" role="tablist">${results.map((_, i) => `<button type="button" role="tab" aria-selected="${i === pick}" data-party-tab="${i}">${tabName(i)}</button>`).join('')}</div>` : ''}
    ${partyView(results[pick], pick, indexes, canEquip, result.current)}`;
  else if (result) body = `<p>No party fits those requirements. Try turning off Healer or Protection, or fewer locked characters.</p>${bullets(result.warnings)}`;
  else body = `<p class="dim">${people.length < 4 ? 'This save needs four recruited characters for a party search.' : 'Searches every party of four you can field, with their Resonances, gear and abilities, and predicts damage per round over a five-round fight, Limit Bursts included. Takes about 15 seconds.'}</p>`;
  return `<div class="party-panel" aria-busy="${busy}">${settings}${error ? `<p class="bad small" role="alert">${h(error)}</p>` : ''}${body}</div>`;
}
