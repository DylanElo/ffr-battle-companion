import {h} from './build-details.js?v=13';

const number=value=>Number.isFinite(Number(value))?Number(value):0;
const amount=value=>Math.round(number(value)).toLocaleString();
const labels={damage:'Damage',stagger:'Stagger',limit:'Limit Burst',durability:'Durability'};

export function buildMetric(evaluation={},goals=['damage']) {
  return goals.map(goal=>{
    if(goal==='damage')return `${amount(evaluation.fightDamage ?? evaluation.damage)} damage / round`;
    if(goal==='stagger')return `${amount(evaluation.fightBreakDamage ?? evaluation.breakDamage)} stagger / round`;
    if(goal==='limit')return `${number(evaluation.gaugePerRound).toLocaleString(undefined,{maximumFractionDigits:1})} LB gauge / round`;
    if(goal==='durability')return `${amount(evaluation.durability)} durability · ${amount(evaluation.remainingHp)} HP remaining`;
    return '';
  }).filter(Boolean).join(' · ');
}

export function renderBuildRequest({goal,actions=[],busy=false}) {
  const req=goal.requirements || {},disabled=busy?' disabled':'';
  const selected=number(goal.actionId),known=actions.some(action=>action.id===selected);
  return `<details data-keep="build-requirements"><summary>Action and requirements</summary>
    <p class="dim small">Build around an action, then require every result to meet these checks. Automatic chooses the action for you.</p>
    <div class="build-request-fields">
      <label>Action<select id="deep-action"${disabled}><option value="0">Automatic — best action found</option>
        ${selected && !known?`<option value="${selected}" selected>Action #${selected} — unavailable in this save</option>`:''}
        ${actions.map(action=>`<option value="${action.id}"${action.id===selected?' selected':''}>${h(action.name)}</option>`).join('')}</select></label>
      <label>Minimum HP<input type="number" id="deep-min-hp" min="0" max="99999999" step="1" value="${number(req.minHp)}"${disabled}></label>
      <label>Damage element<select id="deep-element"${disabled}>
        ${[['','Any element'],['None','Non-elemental'],...['Fire','Ice','Thunder','Water','Wind','Earth','Light','Dark'].map(e=>[e,e])].map(([value,label])=>`<option value="${value}"${(req.element || '')===value?' selected':''}>${label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="deep-survive"${req.survive?' checked':''}${disabled}> Survive the configured incoming hits</label>
    </div>
    ${req.survive && !(goal.incomingDamage>0)?'<p class="note small">Set Hit damage above 0 under Expert scenario to test survival.</p>':''}
  </details>`;
}

export function renderRequirementChecks(evaluation={},goal={}) {
  const checks=evaluation.requirementChecks || [];
  const rows=checks.map(check=>{
    const actual=Array.isArray(check.actual)?check.actual.join(', '):amount(check.actual);
    const detail=check.expected?`${actual} required: ${check.expected}`:`${actual} / minimum ${amount(check.minimum)}`;
    return `<li><strong>${check.met?'Met':'Not met'}: ${h(check.label)}</strong> — ${h(detail)}</li>`;
  });
  const priorities=(goal.goals || []).map(id=>labels[id] || id).join(', ');
  return `${priorities?`<p class="dim small">Optimized for: ${h(priorities)}.</p>`:''}${rows.length?`<section class="requirement-checks"><h5>Required checks</h5><ul>${rows.join('')}</ul></section>`:''}`;
}
