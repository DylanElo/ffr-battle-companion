import {h} from './build-details.js?v=13';

const list = value => Array.isArray(value) ? value : [];
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const texts = value => [...new Set(list(value).filter(text => typeof text === 'string' && text.trim()))];
const bullets = rows => `<ul>${rows.map(text => `<li>${h(text)}</li>`).join('')}</ul>`;
const effectText = row => {
  const name = row.passiveName || row.name || (row.passiveId ? `Passive #${row.passiveId}` : row.type || 'Effect');
  return `${name}${row.reason ? ': ' + row.reason : ''}`;
};

export function renderResultExplanations({evaluation = {}, scenario = {}, enemyName = '', goals = [], pinned = false, evidence = {}} = {}) {
  evaluation ||= {}; scenario ||= {}; evidence ||= {};
  const assumptions = [], enemy = enemyName || scenario.enemyName;
  if (enemy) assumptions.push(`Target: ${enemy}.`);
  const labels = {damage: 'damage', stagger: 'stagger', limit: 'Limit Burst', durability: 'durability'};
  if (list(goals).length) assumptions.push(`Priorities: ${list(goals).map(goal => labels[goal] || goal).join(', ')}. Goal score combines these priorities; higher is better under the same fight conditions.`);
  if (pinned) assumptions.push('Your pinned pieces restrict the search.');
  if (numeric(scenario.rounds)) assumptions.push(`${scenario.rounds} rounds, starting at full HP. Enemy HP depletion and early kills are not simulated.`);
  if (scenario.difficulty) assumptions.push(`Difficulty: ${scenario.difficulty}.`);
  if (numeric(scenario.mpPercent)) assumptions.push(`Starting MP: ${scenario.mpPercent}%. Actions spend MP; no MP recovery or replacement action is assumed after MP runs out.`);
  if (typeof scenario.critical === 'boolean') assumptions.push(scenario.critical ? 'Guaranteed critical hits are enabled.' : 'Critical hits use modeled chances; guaranteed critical hits are off.');
  if (typeof scenario.broken === 'boolean') assumptions.push(scenario.broken ? 'The enemy is assumed already staggered.' : 'The enemy starts unstaggered; modeled stagger can occur during the sequence.');
  if (numeric(scenario.enemyCount)) assumptions.push(`Enemy count: ${scenario.enemyCount}.`);
  if (numeric(scenario.incomingDamage)) assumptions.push(scenario.incomingDamage > 0
    ? `Incoming hits: one fixed ${scenario.incomingType === 'Magic' ? 'magical' : 'physical'} hit of ${scenario.incomingDamage.toLocaleString()} damage per character after acting each round, after defense and before modeled reductions. This does not predict enemy targeting or actions.`
    : 'No enemy hits are configured. Enemy actions, counters requiring hits and received-damage Limit Burst gains are not assumed.');
  if (typeof scenario.horizon === 'string' && scenario.horizon.trim()) assumptions.push(scenario.horizon);

  const analysis = evaluation.passiveAnalysis || {}, coverage = evaluation.coverage || analysis.coverage || {};
  const applied = texts(list(analysis.applied).filter(Boolean).map(effectText));
  const deferred = texts(list(analysis.deferred).filter(Boolean).map(effectText));
  const unsupported = texts(list(analysis.unsupported).filter(Boolean).map(effectText));
  const coverageLine = ['applied', 'deferred', 'unsupported'].filter(key => numeric(coverage[key]))
    .map(key => `${coverage[key]} ${key}`).join(' · ');
  const warnings = texts(evaluation.warnings);
  const sources = ['formula', 'stats', 'passives', 'search', 'calibration'].map(key => evidence[key]).filter(text => typeof text === 'string' && text.trim());
  return `<section class="result-explanations" aria-label="Estimate assumptions and limitations">
    <p class="note"><strong>Estimate, not a live-fight prediction.</strong> Battle sequencing has not been calibrated against a live fight. This bounded search shows the strongest builds found under these conditions, not a proven global optimum.</p>
    <details><summary>Assumptions and model limits</summary>
      ${assumptions.length ? bullets(assumptions) : '<p>Scenario settings were not supplied with this result; its assumptions cannot be shown.</p>'}
      <h5>Effects in the initial damage calculation</h5>
      ${coverageLine ? `<p>${h(coverageLine)}. These counts describe this calculation, not a confidence rating.</p>` : '<p>Passive coverage was not supplied with this result.</p>'}
      ${applied.length ? `<p>Applied effects:</p>${bullets(applied)}` : ''}
      ${deferred.length ? `<p>Not applied in the initial damage calculation:</p>${bullets(deferred)}<p>Some event-based effects can be handled later in the modeled sequence. These entries alone do not mean the whole battle model excludes them.</p>` : ''}
      ${unsupported.length ? `<p>Unsupported in this passive calculation:</p>${bullets(unsupported)}` : ''}
      ${warnings.length ? `<h5>Notes for this result</h5>${bullets(warnings)}` : ''}
      ${sources.length ? `<h5>Evidence behind the model</h5>${bullets(sources)}` : ''}
      <p><a href="model-notes.md">Battle model and limits</a> · <a href="combat-verification.md">Arithmetic verification</a> · <a href="timing-verification.md">Timing evidence</a></p>
    </details>
  </section>`;
}
