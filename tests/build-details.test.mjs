import test from 'node:test';
import assert from 'node:assert/strict';
import {gearExplanation, buildExplanation, estimateNotice} from '../docs/build-details.js';
import {comparison} from '../docs/optimizer-ui.js';

const indexes = Object.fromEntries(['equipment','skills','passives','masterSkills','effects'].map(k => [k,new Map()]));
indexes.equipment.set(1,{id:1,name:'Blade <test>',stats:{PhysicalAttack:10},passiveIds:[]});
indexes.skills.set(2,{id:2,name:'Attack',calcType:'Physic',mag:100,equipCost:5});
indexes.masterSkills.set(3,{id:3,name:'Mastery bundle',desc:'Grants abilities',equipCost:20});

test('all equipment slots remain visible, including reserved and unsupported accessories',()=>{
  const html=gearExplanation({equipment:{weaponId:1,armorId:-1,accessoryIds:[-1,-1]},gearReasons:[
    {slot:'accessory',index:0,reason:'reserved-or-used'},
    {slot:'accessory',index:1,reason:'unsupported'}]},indexes);
  assert.equal((html.match(/class="gear-choice"/g)||[]).length,4);
  assert.match(html,/Accessory 1/);assert.match(html,/Accessory 2/);
  assert.match(html,/reserved by other characters/);assert.match(html,/could not be evaluated reliably/);
  assert.match(html,/Blade &#60;test&#62;/);assert.doesNotMatch(html,/<test>/);
});

test('gear removal shows tradeoffs and unmodeled effects without claiming an optimum',()=>{
  const html=gearExplanation({equipment:{weaponId:1,accessoryIds:[]},gearReasons:[
    {slot:'weapon',damageDelta:100,staggerDelta:-5,unmodeledEffects:[{passiveName:'Counter',reason:'Requires an enemy attack'}]}]},indexes);
  assert.match(html,/100 less estimated damage/);assert.match(html,/5 more stagger/);
  assert.match(html,/Not included in this estimate: Counter/);
});

test('ability explanations include Mastery, real AP totals and insufficient-MP rounds',()=>{
  const html=buildExplanation({characterId:1001,equipment:{},abilityReasons:[{id:3,cost:20,damageDelta:100}],evaluation:{
    equippedSkillIds:[2,3],skillId:2,skillCost:25,skillBudget:50,maxSkillSlots:8,mpExhaustedRounds:[3,4,5],
    common:{attack:100,defense:90,level:30},availableMp:35,turnMp:15}},indexes);
  assert.match(html,/25 \/ 50 AP/);assert.match(html,/Mastery bundle/);assert.match(html,/20 AP/);
  assert.match(html,/Insufficient MP in round\(s\) 3, 4, 5/);
  assert.match(html,/other equipment and equipped abilities fixed/);
  assert.match(html,/not additive bonuses/);
});

test('unavailable baseline and estimate notice avoid falsely asserting measured upgrades',()=>{
  assert.match(comparison(null,{damage:100}),/could not be fully evaluated/);
  assert.doesNotMatch(comparison(null,{damage:100}),/no usable attack/);
  assert.match(estimateNotice(),/arithmetic checked against the installed executable/);
  assert.match(estimateNotice(),/battle timing still uses the assumptions/);
});

test('native description placeholders show their effect values instead of template keys',()=>{
  const local={...indexes,passives:new Map([[4,{id:4,name:'Fill LB',equipCost:20,desc:'Fills {Effect1Param1}% gauge.',effectBundles:[{effectId:10}]}]]),
    effects:new Map([[10,{id:10,params:[10]}]])};
  const html=buildExplanation({characterId:1,evaluation:{equippedSkillIds:[4],skillCost:20,skillBudget:100,maxSkillSlots:8}},local);
  assert.match(html,/Fills 10% gauge/);assert.doesNotMatch(html,/Effect1Param1/);
});
