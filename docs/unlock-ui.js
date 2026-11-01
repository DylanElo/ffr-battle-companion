import {h} from './build-details.js?v=13';
import {describeAbility} from './piece-details.js?v=2';
import {renderResultExplanations} from './result-explanations.js?v=2';

const n = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 1}) : '—';
const score = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumSignificantDigits: 4}) : '—';
const labels = {HitPoint: 'HP', MagicPoint: 'MP', MaxHitPoint: 'HP', MaxMagicPoint: 'MP', Attack: 'STR', Defence: 'STA', Intelligence: 'INT', Mind: 'SPR', Agility: 'SPD', Divine: 'Divine', EquipCost: 'AP budget'};

function rewardText(reward, indexes, parameterNames) {
  if (reward.type === 'BaseParameter') {
    const key = parameterNames[reward.id];
    return `${reward.value > 0 ? '+' : ''}${n(reward.value)} ${labels[key] || key || `parameter #${reward.id}`} (permanent)`;
  }
  const ability = describeAbility(reward.id, indexes);
  return ability ? `${ability.name}${ability.text ? ': ' + ability.text : ''}` : `${reward.type} #${reward.id}`;
}

export function renderUnlockRecommendations({state, indexes = {}, parameterNames = {}, buildBusy = false} = {}) {
  const results = state?.results || [], baseline = state?.baseline;
  return `<section class="window unlock-panel" aria-label="Next useful Sync unlocks">
    <h3>Next useful Sync unlocks</h3>
    <p class="dim small">Compare the next ability milestone on each owned Resonance for this character and goal. Gear and equipped Resonance stay fixed; ability choices may change around your pins.</p>
    <div class="toolbar">${state?.busy ? `<span role="status">${h(state.progress || 'Checking your owned Resonances…')}</span><button type="button" id="unlock-cancel">Cancel unlock search</button>`
      : `<button type="button" id="find-unlocks" ${buildBusy ? 'disabled' : ''}>Find useful unlocks</button>`}</div>
    ${state?.error ? `<p class="bad" role="alert">${h(state.error)}</p>` : ''}
    ${state?.results ? `<p class="note"><strong>Hypothetical preview.</strong> These rewards are not unlocked or equipped in your current plan. Estimates have not been calibrated against a live fight.</p>
      <p class="dim small">Checked ${h(state.checked)} of ${h(state.total)} next milestones.${state.unscored ? ` ${h(state.unscored)} could not be scored.` : ''}${state.timedOut ? ' The search stopped at its budget; other milestones may be better.' : ''} Awakening upgrades and unowned Resonances are not compared.</p>
      ${results.length ? results.map((row, i) => `<details class="unlock-card"><summary>${i + 1}. ${h(row.visionName)} · ${h(n(row.remaining))} more Sync points · +${h(score(row.scoreDelta))} goal score</summary>
        <p>Reach ${h(n(row.required))} Sync points (${h(n(row.current))} recorded). Sync is tracked separately for each character.</p>
        <h4>Rewards along the way</h4><ul>${row.rewards.map(reward => `<li>${h(rewardText(reward, indexes, parameterNames))}</li>`).join('')}</ul>
        <p class="dim small">The total gain includes every crossed reward, including permanent stats. It is not attributed to one ability alone.${Number.isFinite(row.milestoneScoreDelta) ? ` This milestone itself adds +${h(score(row.milestoneScoreDelta))} goal score beyond earlier rewards.` : ''} Both estimates choose abilities from their available unlocks within the same AP/slot limits and pinned abilities.</p>
        <div class="comparison-scroll"><table><thead><tr><th scope="col">Estimate</th><th scope="col">Available now</th><th scope="col">After milestone</th></tr></thead><tbody>
        <tr><th scope="row">Goal score</th><td>${h(score(row.beforeScore))}</td><td>${h(score(row.afterScore))}</td></tr>
        <tr><th scope="row">Damage per round</th><td>${h(n(baseline?.fightDamage ?? baseline?.damage))}</td><td>${h(n(row.evaluation?.fightDamage ?? row.evaluation?.damage))}</td></tr>
        <tr><th scope="row">Stagger per round</th><td>${h(n(baseline?.fightBreakDamage ?? baseline?.breakDamage))}</td><td>${h(n(row.evaluation?.fightBreakDamage ?? row.evaluation?.breakDamage))}</td></tr></tbody></table></div>
        <p><strong>Future equipped abilities:</strong> ${h((row.evaluation?.equippedSkillIds || []).map(id => describeAbility(id, indexes)?.name || `#${id}`).join(', ') || 'None')}</p>
        ${renderResultExplanations({evaluation: row.evaluation, scenario: state.scenario, goals: state.goals, evidence: state.modelEvidence})}
        <button type="button" class="ghost" data-unlock-vision="${h(row.visionId)}">View ${h(row.visionName)} progression</button>
      </details>`).join('') : `<p>${h(state.reason || (state.total ? 'No positive modeled gain was found among the checked milestones for this gear and goal. Try another goal or build; this does not mean the remaining abilities are useless.' : 'No further ability milestones were found on your owned Resonances.'))}</p>`}` : ''}
  </section>`;
}
