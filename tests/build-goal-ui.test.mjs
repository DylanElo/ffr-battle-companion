import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMetric,renderBuildRequest,renderRequirementChecks} from '../docs/build-goal-ui.js';

test('result metrics follow the selected goal rather than always leading with damage',()=>{
  const evaluation={fightDamage:999,fightBreakDamage:77,gaugePerRound:32.5,durability:123,remainingHp:456};
  assert.equal(buildMetric(evaluation,['damage']),'999 damage / round');
  assert.equal(buildMetric(evaluation,['stagger']),'77 stagger / round');
  assert.equal(buildMetric(evaluation,['limit']),'32.5 LB gauge / round');
  assert.equal(buildMetric(evaluation,['durability']),'123 durability · 456 HP remaining');
  assert.equal(buildMetric(evaluation,['limit','durability']).includes('damage'),false);
  assert.equal(buildMetric({fightDamage:0},['damage']),'0 damage / round');
});

test('request controls preserve requirements and make unavailable selected actions explicit',()=>{
  const html=renderBuildRequest({goal:{actionId:42,incomingDamage:0,requirements:{minHp:6000,survive:true,element:'Water'}},actions:[{id:9,name:'<spell>'}],busy:true});
  assert.match(html,/Action #42 — unavailable in this save/);
  assert.match(html,/value="6000" disabled/);
  assert.match(html,/value="Water" selected/);
  assert.match(html,/Set Hit damage above 0/);
  assert.doesNotMatch(html,/<spell>/);
  assert.match(html,/&#60;spell&#62;/);
});

test('required checks stay separate from optimization preferences and escape supplied text',()=>{
  const html=renderRequirementChecks({requirementChecks:[{label:'Minimum HP',met:true,actual:6000,minimum:6000},{label:'Damage element',met:true,actual:['<Water>'],expected:'Water'}]},{goals:['durability']});
  assert.match(html,/Optimized for: Durability/);
  assert.match(html,/Met: Minimum HP/);
  assert.match(html,/minimum 6,000/);
  assert.doesNotMatch(html,/<Water>/);
});
