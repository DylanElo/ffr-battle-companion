const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../docs/battle.js');
const native = require('../docs/data/catalog.json');
const rules = require('../docs/skill-rules.json');

function fixture(budget = 80) {
  const base = native.skills.find(s => s.id === 401010);
  const learned = Array.from({length: 10}, (_, n) => ({...base, id: 900000 + n, name: `Alternative ${n}`, mag: 1, equipCost: 10, cost: 0}));
  const character = {id: 1, name: 'Completion fixture', sex: 'Male', weaponType: 'Sword', armorTypes: [], levelParamId: 1,
    stats: {HitPoint: 1000, MagicPoint: 1000, Attack: 100, Intelligence: 100, Defence: 30, Mind: 30, Agility: 50}, baseSkillEquipCost: budget, passiveIds: []};
  const catalog = {...native, skillRules: rules, characters: [character], skills: [base, ...learned], passives: [], visions: [], masterSkills: [], artifacts: [], equipment: [],
    statGrowth: {1: {rows: [{level: 1, requiredExperience: 0, adds: {}, skillIds: learned.map(s => s.id)}]}}};
  const equipment = {weaponId: -1, armorId: -1, accessoryIds: [], visionId: -1};
  const snapshot = {characters: [{id: 1, joinStatus: 'Join', usable: true, experience: 0, baseParameters: [], activeSkillIds: [base.id], equippedSkillIds: Array(8).fill(-1), equipment}],
    inventory: [], resonances: [], party: [1], player: {difficulty: 'Normal'}};
  const enemy = {id: 1, level: 1, stats: {MaxHitPoint: 1e9, MaxBreakPoint: 1e9, Defence: 50, Mind: 50, Agility: 0}, resistances: {}, passiveIds: []};
  return {catalog, snapshot, enemy, input: {characterId: 1, visionId: -1, equipment}};
}

test('damage Build leaves slots empty instead of purchasing neutral alternative attacks', () => {
  const {catalog, snapshot, enemy, input} = fixture(), before = JSON.stringify(snapshot);
  const options = {goals: ['damage'], rounds: 1, includeSupportOptions: true};
  const baseline = B.createModel(catalog, snapshot, enemy, options).evaluate(input);
  const result = B.createModel(catalog, snapshot, enemy, {...options, fillAbilitySlots: true}).evaluate(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.equippedSkillIds, []);
  assert.equal(result.skillCost, 0);
  assert.equal(result.skillId, baseline.skillId);
  assert.equal(result.fightDamage, baseline.fightDamage);
  assert.equal(JSON.stringify(snapshot), before);
});

test('damage Build spends its AP on a jointly scored passive instead of neutral actions', () => {
  const {catalog, snapshot, enemy, input} = fixture(20);
  catalog.passives=[{...native.passives.find(p=>p.id===1308),id:910001,equipCost:20}];
  catalog.statGrowth[1].rows[0].skillIds.push(910001);
  const result = B.createModel(catalog, snapshot, enemy, {goals: ['damage'], rounds: 1, fillAbilitySlots: true,jointOptimization:true}).evaluate(input);
  assert.equal(result.valid, true);
  assert.equal(result.equippedSkillIds.length, 1);
  assert.deepEqual(result.equippedSkillIds,[910001]);
  assert.equal(result.skillCost, 20);
  assert.ok(result.skillCost <= result.skillBudget);
});

test('completion preserves pinned abilities and does not fill an explicitly fixed loadout', () => {
  const {catalog, snapshot, enemy, input} = fixture();
  const model = B.createModel(catalog, snapshot, enemy, {goals: ['damage'], rounds: 1, fillAbilitySlots: true});
  const pinned = model.evaluate({...input, lockedSkillIds: [900009]});
  assert.deepEqual(pinned.equippedSkillIds,[900009]);
  const fixed = model.evaluate({...input, equippedSkillIds: []});
  assert.equal(fixed.valid, true);
  assert.deepEqual(fixed.equippedSkillIds, []);
});

test('pure damage completion excludes unrelated healing and protection but preserves explicit pins', () => {
  const {catalog,snapshot,enemy,input}=fixture(80);
  const utility=[400550,400640]; // Native First Aid and Guard.
  catalog.skills.push(...utility.map(id=>native.skills.find(skill=>skill.id===id)));
  catalog.statGrowth[1].rows[0].skillIds.push(...utility);
  const options={goals:['damage'],rounds:1,fillAbilitySlots:true,includeSupportOptions:true,jointOptimization:true};
  const result=B.createModel(catalog,snapshot,enemy,options).evaluate(input);
  assert.equal(result.valid,true);
  assert.deepEqual(result.equippedSkillIds,[]);
  assert.equal(result.skillCost,0);
  assert.equal(result.canHeal,false);
  assert.equal(result.canProtect,false);
  const incoming=B.createModel(catalog,snapshot,enemy,{...options,goals:['damage','stagger'],incomingDamage:100}).evaluate(input);
  assert.equal(incoming.valid,true);
  assert.deepEqual(incoming.equippedSkillIds,[]);
  assert.equal(incoming.canHeal,false);
  assert.equal(incoming.canProtect,false);
  const pinned=B.createModel(catalog,snapshot,enemy,options).evaluate({...input,lockedSkillIds:utility});
  assert.equal(pinned.valid,true);
  assert.deepEqual(pinned.equippedSkillIds.slice().sort((a,b)=>a-b),utility);
  assert.equal(pinned.skillCost,25);
  assert.ok(pinned.skillCost<=pinned.skillBudget);
  assert.equal(pinned.canHeal,true);
  assert.equal(pinned.canProtect,true);
  const partyOptions={...options,fillAbilitySlots:false,minHealers:1,minProtectors:0};
  const roleModel=B.createModel(catalog,snapshot,enemy,partyOptions);
  const needed=roleModel.evaluate(input);
  assert.ok(needed.equippedSkillIds.includes(400550));
  assert.ok(!needed.equippedSkillIds.includes(400640));
  const noRoles=B.createModel(catalog,snapshot,enemy,{...partyOptions,minHealers:0}).evaluate(input);
  assert.deepEqual(noRoles.equippedSkillIds,[]);
  const redundant=roleModel.evaluate({...input,supportRoles:[]});
  assert.deepEqual(redundant.equippedSkillIds,[]);
  const pinnedRedundant=roleModel.evaluate({...input,supportRoles:[],lockedSkillIds:utility});
  assert.ok(utility.every(id=>pinnedRedundant.equippedSkillIds.includes(id)));
});

test('damage completion retains paid action dependencies that improve the scored recipe', () => {
  const {catalog,snapshot,enemy,input}=fixture(80);
  catalog.skills.push(native.skills.find(skill=>skill.id===400650));
  catalog.statGrowth[1].rows[0].skillIds.push(400650);
  const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,fillAbilitySlots:true,
    includeSupportOptions:true,jointOptimization:true}).evaluate(input);
  assert.equal(result.valid,true);
  assert.deepEqual(result.equippedSkillIds,[400650]);
  assert.equal(result.actionCount,2);
  assert.ok(result.recipeSteps.some(step=>step.skillId===400650));
  assert.equal(result.skillCost,60);
});
