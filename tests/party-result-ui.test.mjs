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
test('model caveats and warnings sit in the collapsed estimate panel, not above the result',()=>{
  const html=party(),panel=html.indexOf('<details class="how">');
  assert.ok(panel>0 && html.indexOf('Model estimate')>panel && html.indexOf('A model limit &#60;test&#62;')>panel);
});
