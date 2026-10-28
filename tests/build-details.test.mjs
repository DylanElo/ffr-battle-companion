import test from 'node:test';
import assert from 'node:assert/strict';
import {gearExplanation, abilityList, alwaysOnList, moveDetails} from '../docs/build-details.js';
import {comparison} from '../docs/optimizer-ui.js';

const indexes = Object.fromEntries(['equipment','skills','passives','masterSkills','effects'].map(k => [k,new Map()]));
indexes.equipment.set(1,{id:1,name:'Blade <test>',stats:{PhysicalAttack:10},passiveIds:[7]});
indexes.skills.set(2,{id:2,name:'Attack',calcType:'Physic',mag:100,equipCost:5,desc:'Deal physical damage to an enemy.'});
indexes.skills.set(5,{id:5,name:'Cure',equipCost:10,desc:'Restore HP for an ally.'});
indexes.masterSkills.set(3,{id:3,name:'Mastery bundle',desc:'Grants abilities',equipCost:20,grants:{activeIds:[5],passiveIds:[]}});
indexes.passives.set(7,{id:7,name:'Counter',desc:'Counter physical attacks.'});
indexes.passives.set(8,{id:8,name:'Magic Attack +30%',desc:'Increases magic attack by 30%.'});

test('all equipment slots remain visible, including reserved and unsupported accessories',()=>{
  const html=gearExplanation({equipment:{weaponId:1,armorId:-1,accessoryIds:[-1,-1]},gearReasons:[
    {slot:'accessory',index:0,reason:'reserved-or-used'},
    {slot:'accessory',index:1,reason:'unsupported'}]},indexes);
  assert.equal((html.match(/class="gear-choice"/g)||[]).length,4);
  assert.match(html,/Accessory 1/);assert.match(html,/Accessory 2/);
  assert.match(html,/used by other characters/);assert.match(html,/can’t estimate yet/);
  assert.match(html,/Blade &#60;test&#62;/);assert.doesNotMatch(html,/<test>/);
});

test('gear says what an item adds, its trade-offs, and which of its effects are not counted',()=>{
  const html=gearExplanation({equipment:{weaponId:1,accessoryIds:[]},gearReasons:[
    {slot:'weapon',damageDelta:100,staggerDelta:-5,unmodeledEffects:[{passiveId:7,passiveName:'Counter',reason:'Requires an enemy attack'}]}]},indexes);
  assert.match(html,/\+100 damage per round, −5 stagger per round/);
  assert.match(html,/<b>Counter<\/b> <span class="dim">\(not counted\)<\/span> — Counter physical attacks/);
  assert.doesNotMatch(html,/Requires an enemy attack/);
});

test('abilities show their AP, what they do, what they add, and what a Mastery bundle includes',()=>{
  const html=abilityList({abilityReasons:[{id:3,cost:20,damageDelta:100}],evaluation:{equippedSkillIds:[3]}},indexes);
  assert.match(html,/<b>Mastery bundle<\/b><span class="dim">20 AP<\/span>/);
  assert.match(html,/\+100 damage per round/);assert.match(html,/Grants abilities/);assert.match(html,/Includes Cure/);
});

test('a support ability says what role it keeps instead of a damage figure',()=>{
  const html=abilityList({abilityReasons:[{id:5,cost:10,damageDelta:0}],evaluation:{equippedSkillIds:[5],supportSkillIds:[5],supportTags:['healer']}},indexes);
  assert.match(html,/Lets this character heal/);assert.doesNotMatch(html,/damage per round/);
});

test('always-on effects list the Resonance and character passives, not ones already under a gear slot',()=>{
  const html=alwaysOnList({equipment:{weaponId:1,accessoryIds:[]},evaluation:{alwaysPassiveIds:[7,8]}},indexes);
  assert.match(html,/Magic Attack \+30%/);assert.doesNotMatch(html,/Counter/);
});

test('the move opens to what its skill does',()=>{
  const html=moveDetails({skillId:2,recipeLabel:'Attack',turnMp:12},indexes);
  assert.match(html,/<summary>Attack <small>12 MP<\/small><\/summary><p>Deal physical damage to an enemy\.<\/p>/);
});

test('the before/after states the change against the current setup',()=>{
  assert.match(comparison({damage:100},{damage:138}),/\+38% damage<\/b>[\s\S]*vs your current setup \(100 per round\)/);
});

test('native description placeholders show their effect values instead of template keys',()=>{
  const local={...indexes,passives:new Map([[4,{id:4,name:'Fill LB',equipCost:20,desc:'Fills {Effect1Param1}% gauge.',effectBundles:[{effectId:10}]}]]),
    effects:new Map([[10,{id:10,params:[10]}]])};
  const html=abilityList({evaluation:{equippedSkillIds:[4]}},local);
  assert.match(html,/Fills 10% gauge/);assert.doesNotMatch(html,/Effect1Param1/);
});

test('a move made of several skills names each one with what it does, in order',()=>{
  const local={...indexes,skills:new Map([...indexes.skills,[6,{id:6,name:'Focus',desc:'Raise speed.'}]])};
  const html=moveDetails({skillId:2,turn:{openingTurn:{recipeLabel:'Focus',leaves:[{skillId:6}]},leaves:[{skillId:2}]}},local);
  assert.match(html,/<p><b>Focus<\/b> — Raise speed\.<\/p><p><b>Attack<\/b> — Deal physical damage to an enemy\.<\/p>/);
});
