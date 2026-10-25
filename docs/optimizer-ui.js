const h = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = value => Array.isArray(value) ? value : [];
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const num = value => finite(value) ? Math.round(Number(value)).toLocaleString() : '—';
const clean = value => String(value ?? '').split('::').pop();
const joined = character => clean(character.joinStatus) === 'Join' && character.usable === true;
const option = (value, label, selected) => `<option value="${h(value)}" ${selected ? 'selected' : ''}>${h(label)}</option>`;
const face = (file, size = '') => file ? `<img class="face ${size}" src="img/${file}.webp" alt="" width="128" height="128" decoding="async">` : '';
const ordinal = index => index === 0 ? 'Best party' : `Option ${index + 1}`;

function text(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return value.reason || value.description || value.name || value.message || value.label || JSON.stringify(value);
}

function bullets(values, empty) {
  return list(values).length
    ? `<ul class="optimizer-notes">${values.map(value => `<li>${h(text(value))}</li>`).join('')}</ul>`
    : `<p class="dim small">${h(empty)}</p>`;
}

function damageRange(evaluation) {
  const damage = evaluation.damage;
  const average = typeof damage === 'object' && damage !== null ? damage.expected ?? damage.mean : damage;
  const low = evaluation.damageMin ?? damage?.min;
  const high = evaluation.damageMax ?? damage?.max;
  return `<b>${num(average)}</b>${finite(low) && finite(high) ? `<span class="dim small">${num(low)}–${num(high)} range</span>` : '<span class="dim small">range unavailable</span>'}`;
}

function memberCard(member, indexes) {
  const evaluation = member.evaluation || {}, equipment = member.equipment || {};
  const character = indexes.characters.get(Number(member.characterId));
  const vision = indexes.visions.get(Number(member.visionId ?? equipment.visionId));
  const skill = indexes.skills.get(Number(evaluation.skillId ?? evaluation.actionId));
  const find = (kind, id) => indexes[kind].get(Number(id))?.name ?? (Number(id) > 0 ? `Unknown #${id}` : 'Empty');
  const gear = [
    ['Weapon', equipment.weaponId], ['Armor', equipment.armorId],
    ...list(equipment.accessoryIds).map((id, index) => [`Accessory ${index + 1}`, id]),
  ];
  const passiveIds = list(evaluation.passiveIds ?? evaluation.equippedPassiveIds);
  const passiveAnalysis = evaluation.passiveAnalysis || evaluation.passives || {};
  const applied = evaluation.appliedSynergies || evaluation.applied || passiveAnalysis.applied || [];
  const excluded = [
    ...list(evaluation.unsupported ?? passiveAnalysis.unsupported),
    ...list(evaluation.deferred ?? passiveAnalysis.deferred),
  ];
  const coverage = evaluation.coverage || passiveAnalysis.coverage;
  const skills = list(evaluation.equippedSkillIds);
  const slots = finite(evaluation.skillSlots) ? Number(evaluation.skillSlots) : skills.length || passiveIds.length;
  const budget = evaluation.skillBudget ?? evaluation.equipCostBudget;
  const roleTags = [...new Set([...list(evaluation.supportTags), ...(evaluation.canHeal ? ['Healing available'] : []), ...(evaluation.canProtect ? ['Protection available'] : [])])];
  return `<article class="optimizer-member">
    <div class="optimizer-who">${character ? face(`unit${character.id}`, 'md') : ''}<div><h4>${h(character?.name || `Character #${member.characterId}`)}</h4>
      <span class="optimizer-vision">${vision ? face(`summon${vision.id}`, 'sm') : ''}${h(vision?.name || `Resonance #${member.visionId ?? equipment.visionId}`)}</span></div></div>
    <div class="optimizer-hit"><div><span class="dim small">Suggested action</span><strong>${h(skill?.name || evaluation.actionName || 'No supported damaging action')}</strong></div><div class="optimizer-damage">${damageRange(evaluation)}</div></div>
    <p class="dim small">${h([skill && `MP ${skill.cost}`, finite(evaluation.breakDamage) && `Break ${num(evaluation.breakDamage)}`, ...roleTags].filter(Boolean).join(' · '))}</p>
    ${evaluation.actionDescription ? `<p class="small">${h(evaluation.actionDescription)}</p>` : ''}
    <dl class="optimizer-equipment">${gear.map(([label, id]) => `<dt>${h(label)}</dt><dd>${h(find('equipment', id))}</dd>`).join('')}</dl>
    <details><summary>Chosen abilities and passive synergies</summary>
      <p class="dim small">${finite(evaluation.skillCost) ? `${num(evaluation.skillCost)}${finite(budget) ? ` / ${num(budget)}` : ''} skill cost` : 'Skill cost unavailable'}${slots ? ` · ${slots}${finite(evaluation.maxSkillSlots) ? ` / ${num(evaluation.maxSkillSlots)}` : ''} selected slots` : ''}</p>
      ${skills.length ? `<ul class="optimizer-notes">${skills.map(id => `<li>${h(indexes.skills.get(Number(id))?.name || indexes.passives.get(Number(id))?.name || indexes.masterSkills.get(Number(id))?.name || `Ability #${id}`)}</li>`).join('')}</ul>` : ''}
      ${passiveIds.length ? `<ul class="skills">${passiveIds.map(id => {
        const passive = indexes.passives.get(Number(id));
        return `<li><b>${h(passive?.name || `Passive #${id}`)}</b><p>${h(passive?.desc)}</p></li>`;
      }).join('')}</ul>` : '<p class="dim small">No optional learned passives selected.</p>'}
      <h5>Effects counted in this prediction</h5>${bullets(applied, 'No applied-effect explanation was returned.')}
      <h5>Effects not counted</h5>${bullets(excluded, 'No additional excluded effects were reported for this candidate.')}
      ${coverage ? `<p class="dim small">Coverage: ${h(typeof coverage === 'string' ? coverage : JSON.stringify(coverage))}</p>` : ''}
    </details>
    ${list(evaluation.warnings).length ? `<details><summary>Prediction limits (${evaluation.warnings.length})</summary>${bullets(evaluation.warnings, '')}</details>` : ''}
  </article>`;
}

function partyCard(party, index, indexes) {
  const members = list(party.members ?? party.party), evaluated = party.evaluation || party;
  const summed = members.reduce((total, member) => total + (Number(member.evaluation?.damage?.expected ?? member.evaluation?.damage) || 0), 0);
  const damage = finite(evaluated.damage) ? evaluated.damage : summed;
  return `<article class="window optimizer-party">
    <div class="row-head"><div><h3>${ordinal(index)}</h3><div class="party">${members.map(member => face(`unit${member.characterId}`, 'md')).join('')}</div></div>
      <div class="optimizer-total"><span class="dim small">Predicted damage in one round</span><strong>${num(damage)}</strong>${finite(evaluated.breakDamage) ? `<span class="dim small">Break ${num(evaluated.breakDamage)}</span>` : ''}</div></div>
    ${evaluated.supportDescription ? `<p class="optimizer-support">${h(evaluated.supportDescription)}</p>` : ''}
    <div class="optimizer-members">${members.map(member => memberCard(member, indexes)).join('')}</div>
    ${list(evaluated.warnings).length ? `<div class="optimizer-party-warnings">${bullets(evaluated.warnings, '')}</div>` : ''}
    <div class="toolbar"><button type="button" data-apply-party-index="${index}">Use as my gear plans</button><button type="button" class="ghost" data-export-party="${index}">Export</button>
      <span class="dim small">Fills in the Gear page for these four. Your save isn’t changed.</span></div>
    ${finite(evaluated.score) ? `<p class="dim small">Ranking score ${Number(evaluated.score).toLocaleString(undefined, { maximumFractionDigits: 0 })} (damage plus support, for sorting only).</p>` : ''}
  </article>`;
}

export function renderOptimizer({ catalog, snapshot, state = {}, result = null, busy = false, error = '', faces = {} }) {
  if (!catalog) return '<section class="window"><h2>Party optimizer</h2><p class="dim" role="status">Loading game data…</p></section>';
  const indexes = Object.fromEntries(['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills'].map(kind => [kind, new Map(list(catalog[kind]).map(item => [Number(item.id), item]))]));
  const people = list(snapshot?.characters).filter(joined).filter(character => indexes.characters.has(Number(character.id)));
  const hasSave = Boolean(snapshot?.source) && people.length > 0;
  const enemyQuery = String(state.enemyQ || '').trim().toLowerCase();
  const enemies = list(catalog.enemies).filter(enemy => (!state.bossOnly || enemy.isBoss) && `${enemy.name} ${enemy.id}`.toLowerCase().includes(enemyQuery)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const selectedEnemy = enemies.some(enemy => Number(enemy.id) === Number(state.enemyId)) ? Number(state.enemyId) : enemies[0]?.id;
  const fixed = list(state.fixedCharacterIds).map(Number);
  const chosenEnemy = catalog.enemies?.find(enemy => Number(enemy.id) === selectedEnemy);
  const alternatives = list(result?.results);
  const disabled = busy || !hasSave || !enemies.some(enemy => Number(enemy.id) === selectedEnemy) || people.length < 4 || fixed.length > 4;
  const status = busy ? state.progress || 'Searching owned loadouts and legal party combinations…' : result ? `${alternatives.length} candidate ${alternatives.length === 1 ? 'party' : 'parties'} found.` : 'Choose the encounter and priorities, then run the search.';
  return `<div class="optimizer-layout">
    <section class="window optimizer-controls" aria-label="Party optimizer controls">
      <h2>Party</h2><p class="sub">The best four, with Resonances, gear and abilities, from what you own.</p>
      ${!hasSave ? `<div class="optimizer-load"><p>Load a save to search only the characters, Resonances and item copies you own.</p><label class="load"><input type="file" accept=".sav" data-pick><span>Load your save</span></label></div>` : ''}
      ${chosenEnemy ? `<div class="optimizer-enemy">${face(faces[chosenEnemy.id], 'md')}<div><span class="dim small">Against</span><b>${h(chosenEnemy.name)}</b><span class="dim small">Level ${chosenEnemy.level}</span>
        <div class="els">${Object.entries(chosenEnemy.resistances || {}).filter(([, r]) => clean(r) === 'Weakness').map(([e]) => `<span class="el ${h(clean(e))}">${h(clean(e))}</span>`).join('')}</div></div></div>` : ''}
      <details class="optimizer-change" ${chosenEnemy ? '' : 'open'}><summary>Change encounter</summary>
      <label for="optimizer-enemy-q">Search</label><input type="search" id="optimizer-enemy-q" data-key="optimizer-enemy-q" placeholder="Enemy name or ID" value="${h(state.enemyQ || '')}" ${busy ? 'disabled' : ''}>
      <label class="check"><input type="checkbox" id="optimizer-boss-only" ${state.bossOnly ? 'checked' : ''} ${busy ? 'disabled' : ''}> Bosses only</label>
      <label for="optimizer-enemy">Encounter</label><select id="optimizer-enemy" ${busy ? 'disabled' : ''}>${enemies.map(enemy => option(enemy.id, `${enemy.name} (Lv ${enemy.level})`, Number(enemy.id) === selectedEnemy)).join('') || '<option value="">No matching enemies</option>'}</select></details>
      <label for="optimizer-objective">Aim for</label><select id="optimizer-objective" ${busy ? 'disabled' : ''}>${[['balanced', 'Damage, with healing and support'], ['damage', 'Most damage'], ['break', 'Fastest break']].map(([id, label]) => option(id, label, (state.objective || 'balanced') === id)).join('')}</select>
      <label class="check"><input type="checkbox" id="optimizer-healer" ${state.minHealers || state.healer ? 'checked' : ''} ${busy ? 'disabled' : ''}> Require a healing option</label>
      <label class="check"><input type="checkbox" id="optimizer-protector" ${state.minProtectors || state.protector ? 'checked' : ''} ${busy ? 'disabled' : ''}> Require a protection option</label>
      <details><summary>Battle state and party constraints</summary>
        <p class="dim small">One normal action per member. No free setup turns, simultaneous finishers or unearned mastery are assumed.</p>
        <label for="optimizer-difficulty">Difficulty</label><select id="optimizer-difficulty" ${busy ? 'disabled' : ''}>${[['save', 'Use difficulty from save'], ['Easy', 'Easy'], ['Normal', 'Normal'], ['Expert', 'Expert']].map(([id, label]) => option(id, label, (state.difficulty || 'save') === id)).join('')}</select>
        <label class="check"><input type="checkbox" id="optimizer-broken" ${state.broken ? 'checked' : ''} ${busy ? 'disabled' : ''}> Target is already broken</label>
        <label class="check"><input type="checkbox" id="optimizer-critical" ${state.critical ? 'checked' : ''} ${busy ? 'disabled' : ''}> Show guaranteed-critical scenario</label>
        <p class="dim small">Critical hits are not guaranteed in ordinary play. Leave this off for the normal prediction.</p>
        <label for="optimizer-mp">Available MP (%)</label><input type="number" id="optimizer-mp" min="0" max="100" step="1" value="${h(state.mpPercent ?? 100)}" ${busy ? 'disabled' : ''}>
        <fieldset class="optimizer-locks"><legend>Keep these characters in the party (up to four)</legend>${people.map(character => `<label class="check"><input type="checkbox" data-optimizer-lock="${character.id}" ${fixed.includes(Number(character.id)) ? 'checked' : ''} ${busy || fixed.length >= 4 && !fixed.includes(Number(character.id)) ? 'disabled' : ''}> ${h(indexes.characters.get(Number(character.id)).name)}</label>`).join('') || '<p class="dim small">Load a save to choose party members.</p>'}</fieldset>
      </details>
      <div class="toolbar"><button type="button" class="primary" data-solve-party ${disabled ? 'disabled' : ''}>${busy ? 'Searching…' : 'Find party and loadouts'}</button>${busy ? '<button type="button" data-cancel-party>Cancel search</button>' : ''}</div>
      ${hasSave && people.length < 4 ? '<p class="note">This save has fewer than four recruited, usable characters.</p>' : ''}
      ${fixed.length > 4 ? '<p class="note">Choose at most four required characters.</p>' : ''}
      <p class="dim small" role="status" aria-live="polite">${h(status)}</p>
      ${error ? `<p class="optimizer-error" role="alert">${h(error)}</p>` : ''}
    </section>
    <section class="optimizer-results" aria-label="Recommended parties" aria-busy="${busy}">
      ${busy && !alternatives.length ? '<div class="window optimizer-empty"><p role="status">Comparing your legal combinations…</p><p class="dim small">The search runs in the background. You can cancel without losing your save or current plans.</p></div>' : ''}
      ${alternatives.map((party, index) => partyCard(party, index, indexes)).join('')}
      ${result && !alternatives.length && !busy ? `<div class="window optimizer-empty"><h3>No valid party found</h3><p>Try relaxing the required roles or character locks. No unowned items or unavailable characters were substituted.</p>${bullets(result.warnings, '')}</div>` : ''}
      ${!result && !busy ? '<div class="window optimizer-empty"><p>Your recommendations will appear here.</p><p class="dim small">Plans remain separate from the game. You decide which candidate to try.</p></div>' : ''}
      <details class="window optimizer-method"><summary>How these numbers work</summary><p>Damage uses the recovered game rules, the selected battle state, your progression and modeled passive effects. These numbers are predictions, not live measurements.</p><p class="dim small">${chosenEnemy ? `Enemy: ${h(chosenEnemy.name)} (#${chosenEnemy.id}). ` : ''}Enemy entries are base rows; a particular encounter can override level, stats or actions. Check the counted and excluded effects on each loadout.</p>
      ${result?.scenario ? `<p class="dim small">${h(result.scenario.difficulty)} difficulty · attacker HP 100% · MP ${num(result.scenario.mpPercent)}% · ${result.scenario.broken ? 'already broken' : 'not already broken'} · ${result.scenario.critical ? 'guaranteed-critical scenario' : 'native critical chance'}. Damage potential is before remaining-target-HP limits.</p>` : ''}
      ${result ? `<p class="dim small">${result.approximate || result.truncated ? 'Bounded search: strongest candidates found, not a proof of the global best.' : 'Search completed within its configured candidate set.'}${finite(result.evaluations) ? ` ${num(result.evaluations)} loadouts` : ''}${finite(result.considered) ? ` · ${num(result.considered)} party states` : ''}. <a href="https://github.com/DylanElo/ffr-battle-companion/blob/main/docs/model-notes.md" target="_blank" rel="noopener">Model and limits</a></p>` : ''}</details>
    </section>
  </div>`;
}
