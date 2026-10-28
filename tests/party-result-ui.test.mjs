import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOptimizer} from '../docs/optimizer-ui.js';

const catalog={characters:[{id:1,name:'Nichol'},{id:2,name:'Fina'}],skills:[{id:230110,name:'Faith'},{id:500,name:'Blizzard'}]};
const snapshot={characters:[],resonances:[],party:[],inventory:[]};
const party=(evaluation={})=>renderOptimizer({catalog,snapshot,canEquip:true,result:{results:[{members:[
  {characterId:1,equipment:{accessoryIds:[]},evaluation:{skillId:230110,recipeLabel:'Faith',damage:0,actionDescription:'Recasts a support action each round instead of attacking.'}},
  {characterId:2,equipment:{accessoryIds:[]},evaluation:{skillId:500,recipeLabel:'Blizzard',damage:1234,actionDescription:'Receives Faith only when its caster acts earlier.'}}],
  evaluation:{damage:1234,supportUsed:{characterId:1,skillId:230110,targetIds:[2]},warnings:['A model limit <test>'],...evaluation}}]}});
const card=(html,name)=>html.slice(html.indexOf(`<h4>${name}</h4>`),html.indexOf('</article>',html.indexOf(`<h4>${name}</h4>`)));

test('only the support caster is labelled Support',()=>{
  assert.match(card(party(),'Nichol'),/class="support">Support</);
});
test('the ally a support action boosts keeps its own damage',()=>{
  assert.doesNotMatch(card(party(),'Fina'),/class="support"/);
});
test('the boosted ally names the support it receives',()=>{
  assert.match(card(party(),'Fina'),/<span>Faith from Nichol<\/span>/);
});
test('Equip in my save comes before the member cards',()=>{
  const html=party();
  assert.ok(html.indexOf('data-equip-party-index')<html.indexOf('class="member"'));
});
test('the result carries no engine notes, sample counts or model warnings',()=>{
  const html=party({initiativeSamples:16});
  assert.doesNotMatch(html,/Model estimate|How this is estimated|native-priority samples|A model limit|Why this build/);
});
test('each card lists its abilities with their AP and what they do',()=>{
  const html=renderOptimizer({catalog:{...catalog,passives:[{id:900,name:'Mana Overload',desc:'Magic damage +35% while MP is high.',equipCost:20}]},snapshot,canEquip:true,result:{results:[{members:[
    {characterId:2,equipment:{accessoryIds:[]},abilityReasons:[{id:900,cost:20,damageDelta:918.2}],evaluation:{skillId:500,damage:1234,equippedSkillIds:[900],skillCost:20,skillBudget:100}}],
    evaluation:{damage:1234}}]}});
  assert.match(card(html,'Fina'),/Abilities <span class="dim">20 \/ 100 AP<\/span>[\s\S]*Mana Overload[\s\S]*\+918 damage per round[\s\S]*Magic damage \+35%/);
});
test('a card shows the round its member runs out of MP',()=>{
  const html=renderOptimizer({catalog,snapshot,result:{results:[{members:[
    {characterId:2,equipment:{accessoryIds:[]},evaluation:{skillId:500,damage:1234,mpExhaustedRounds:[4,5]}}],evaluation:{damage:1234}}]}});
  assert.match(card(html,'Fina'),/class="warn">Out of MP from round 4</);
});
test('the picture shape toggle sits next to Copy image and marks the chosen shape',()=>{
  const html=renderOptimizer({catalog,snapshot,picture:'square',result:{results:[{members:[
    {characterId:2,equipment:{accessoryIds:[]},evaluation:{skillId:500,damage:1234}}],evaluation:{damage:1234}}]}});
  assert.match(html,/Copy image<\/button><span class="shape" role="group" aria-label="Picture shape"><button type="button" class="chip" data-picture="wide" aria-pressed="false">Wide<\/button><button type="button" class="chip" data-picture="square" aria-pressed="true">Square<\/button>/);
});
