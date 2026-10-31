import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describeItem, describeAbility} from '../docs/piece-details.js';

const maps = () => Object.fromEntries(['equipment','skills','passives','masterSkills','effects'].map(k => [k,new Map()]));
const indexes = maps();
indexes.effects.set(9,{id:9,params:[30]});
indexes.skills.set(400010,{id:400010,name:'Defend',desc:'Reduce damage taken.',equipCost:5});
indexes.passives.set(7,{id:7,name:'Counter',desc:'Counter {Effect1Param1}% of attacks.',equipCost:12,effectBundles:[{effectId:9}]});
indexes.passives.set(8,{id:8,name:'Broken',desc:'Gain {Effect1Param1}.',effectBundles:[{effectId:404}]});
indexes.masterSkills.set(3,{id:3,name:'Mastery',desc:'Grants abilities',equipCost:20});
indexes.equipment.set(1,{id:1,name:'Blade',description:'A sharp blade.',passiveIds:[7,999]});
indexes.equipment.set(2,{id:2,name:'Plain',passiveIds:[]});

test('describeItem gives the text and one filled-in effect per known passive',()=>{
  assert.deepEqual(describeItem(indexes.equipment.get(1),indexes),
    {id:1,name:'Blade',text:'A sharp blade.',effects:[{name:'Counter',text:'Counter 30% of attacks.'}]});
});
test('describeItem never invents text',()=>{
  assert.equal(describeItem(indexes.equipment.get(2),indexes).text,'');
});
test('describeAbility finds the kind, cost and text, or null',()=>{
  assert.deepEqual(describeAbility(400010,indexes),{id:400010,name:'Defend',kind:'active',cost:5,text:'Reduce damage taken.'});
  assert.equal(describeAbility(7,indexes).kind,'passive');
  assert.equal(describeAbility(3,indexes).kind,'master');
  assert.equal(describeAbility(123456,indexes),null);
});
test('an effect placeholder says unknown only when the effect is missing',()=>{
  assert.match(describeAbility(7,indexes).text,/30%/);
  assert.match(describeAbility(8,indexes).text,/unknown/);
});

test('a Rate placeholder is a multiplier shown as a percent gain',()=>{
  indexes.passives.set(10,{id:10,name:'Heal+',desc:'Healing up {Effect1Param1Rate}%.',effectBundles:[{effectId:11}]});
  indexes.effects.set(11,{id:11,params:[120]});
  assert.equal(describeAbility(10,indexes).text,'Healing up 20%.');
});

test('a turn-count placeholder becomes the effect duration with its unit',()=>{
  indexes.effects.set(12,{id:12,params:[],duration:1});
  indexes.passives.set(11,{id:11,name:'Brace',desc:'Lasts {Effect1Turn} {Effect1Turn}|plural(one=turn, other=turns).',effectBundles:[{effectId:12}]});
  assert.equal(describeAbility(11,indexes).text,'Lasts 1 turn.');
  indexes.effects.get(12).duration=3;
  assert.equal(describeAbility(11,indexes).text,'Lasts 3 turns.');
});

// Untranslated passives whose effect rows are absent from the catalog: nothing to fill from.
const missingEffectData = ['passives:1495','passives:1496','passives:1497','passives:1500'];
test('every catalog ability description is fully filled in',()=>{
  const catalog = JSON.parse(fs.readFileSync(new URL('../docs/data/catalog.json',import.meta.url)));
  const real = Object.fromEntries(['equipment','skills','passives','masterSkills','effects'].map(k => [k,new Map(catalog[k].map(x => [x.id,x]))]));
  const bad = [];
  for (const kind of ['skills','passives','masterSkills']) for (const a of catalog[kind]) {
    if (!a.desc) continue;
    const text = describeAbility(a.id,real)?.text || '';
    if (/unknown|\{Effect/.test(text)) !missingEffectData.includes(`${kind}:${a.id}`) && bad.push(`${kind}:${a.id}`);
  }
  assert.deepEqual(bad,[],`unfilled descriptions: ${bad.join(', ')}`);
});
