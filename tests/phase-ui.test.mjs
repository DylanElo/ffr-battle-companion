import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildExplanation,bonusActions} from '../docs/build-details.js';
import {renderOptimizer} from '../docs/optimizer-ui.js';
const indexes=Object.fromEntries(['skills','passives','masterSkills','effects','equipment'].map(k=>[k,new Map()]));
indexes.skills.set(1,{id:1,name:'Attack <unsafe>',mag:20});
indexes.skills.set(406060,{id:406060,name:'Gamble Shot'});
const render=ev=>buildExplanation({characterId:1,evaluation:ev},indexes);
const plan={maxHp:100,turn:{steps:[{skillId:1}]}};
test('fallback plans show paid phases, resource costs and escaped MP skip reasons in native participation-grant order',()=>{
 const ev={actionPlan:null,fallbackActionPlan:plan,extraActions:1,expectedExtraActions:1.5,remainingHp:85,hpSpent:15,remainingMp:0,
 phaseEvents:[{round:1,phase:'normal',kind:'bonus-granted',sourceId:'2<script>',reason:'stagger <test>'},{round:1,phase:'additional',kind:'actor-finished',paid:true}],
 resourceEvents:[{round:1,phase:'additional',skillId:1,mpCost:8,hpCost:15,hpBefore:100,hpAfter:85}],resourceSkips:[{round:2,phase:'additional',skillId:1,reason:'Insufficient MP <test>'}]};
 const html=render(ev);
 assert.equal(ev.actionPlan,null);
 assert.match(html,/Paid bonus actions: 1 in the representative path; 1.5 on average/);
 assert.match(html,/Additional phases pay their normal MP and HP costs/);
 assert.match(html,/do not call BeginTurn or advance Focus duration/);
 assert.match(html,/Bonus actions follow the order participation was granted\./); assert.doesNotMatch(html,/not a guaranteed manual command order|unverified order|freely reorder/i);
 assert.match(html,/Additional phase · Attack &#60;unsafe&#62;: 8 MP, 15 HP/);
 assert.match(html,/Additional phase · Attack &#60;unsafe&#62;: Insufficient MP &#60;test&#62;/);
 assert.match(html,/bonus granted by #2&#60;script&#62; \(stagger &#60;test&#62;\)/);
 assert.match(html,/actor finished; action paid/);assert.doesNotMatch(html,/<script>|<test>|Agility/);
});
test('deterministic grants and failed bonus payment remain visible with zero combat samples',()=>{
 const html=render({fallbackActionPlan:plan,combatSamples:0,extraActions:0,expectedExtraActions:0,remainingHp:100,remainingMp:0,phaseEvents:[{round:1,phase:'additional',kind:'actor-finished',paid:false}]});
 assert.match(html,/Paid bonus actions: 0/);assert.match(html,/no paid action/);assert.doesNotMatch(html,/32 reproducible/);
 assert.equal(bonusActions({}), '');
});
test('combat metadata labels average paths and keeps handled Gamble warnings suppressed',()=>{
 const html=render({actionPlan:{maxHp:100,turn:{steps:[{skillId:406060}]}},remainingHp:100,combatSamples:32,gambleSamples:32,sampleKind:'native-initiative-and-combat',passiveAnalysis:{unsupported:[{effectId:65006,reason:'Unmodeled gain'}]}});
 assert.match(html,/32 reproducible native initiative and combat paths/);assert.doesNotMatch(html,/Unmodeled gain/);
 assert.match(html,/every landed Gamble hit is critical/);
});
test('incoming nullification and conditional passive meanings match the explicit scenario',()=>{
 const html=render({fallbackActionPlan:plan,remainingHp:100,resourceEvents:[{round:1,phase:'normal',kind:'incoming',damageType:'Physic',damage:0,hpBefore:100,hpAfter:100,nullified:true}],passiveAnalysis:{applied:[{kind:'fullGaugeBreakPercent',value:50},{kind:'incomingPhysicalNullifyChance',value:35},{kind:'bonusPhaseChancePercent',value:15}]}});
 assert.match(html,/Hit and Run nullified this sampled hit/);
 assert.match(html,/outgoing stagger \+50% while LB gauge is full/);
 assert.match(html,/35% chance to nullify a physical incoming hit after this character has attacked/);
 assert.match(html,/bonus-phase chance \+15 percentage points/);
});
test('party sample notice prioritizes combat metadata and retains ordinary initiative samples',()=>{
 const catalog={},snapshot={};
 const output=evaluation=>renderOptimizer({catalog,snapshot,result:{results:[{members:[],evaluation}]}});
 assert.match(output({combatSamples:32,gambleSamples:32,initiativeSamples:32}),/Averages 32 reproducible native initiative and combat paths/);
 assert.doesNotMatch(output({combatSamples:32,gambleSamples:32,initiativeSamples:32}),/native initiative and Gamble paths/);
 assert.match(output({combatSamples:0,initiativeSamples:16}),/Averages 16 native-priority samples/);
});
test('worker maps party phases and representative resources to both output evaluations and preserves scalar reference inputs',async()=>{
 const partyState={extraActions:{1:0},expectedExtraActions:{1:1.25},phaseEvents:{1:[{round:1,phase:'additional',kind:'actor-finished',paid:false}]},combatSamples:32,gambleSamples:32,initiativeSamples:32,sampleKind:'native-initiative-and-combat',remainingMp:{1:0},resourceEvents:{1:[{phase:'additional',mpCost:10}]},actionOverrides:{1:{damage:80,common:{attack:999}}}};
 const member={characterId:1,evaluation:{valid:true,damage:10,common:{attack:77},extraActions:99,fallbackActionPlan:plan}};
 const messages=[],model={evaluate:()=>member.evaluation,evaluateParty:()=>({}),explainAbilities:()=>[]};
 const context={importScripts(){},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),CompanionBattle:{createModel:()=>model},CompanionSearch:{rankParties:()=>({results:[{members:[member],evaluation:partyState}]})},self:{postMessage:v=>messages.push(v)}};
 vm.runInNewContext(fs.readFileSync(new URL('../docs/optimizer-worker.js',import.meta.url),'utf8'),context);
 await context.self.onmessage({data:{id:1,catalog:{enemies:[{id:1}]},snapshot:{party:[1],characters:[{id:1,equipment:{}}]},enemyId:1,options:{partySize:1}}});
 const result=messages.find(m=>m.type==='result').result.results[0].members[0];
 for(const field of ['evaluation','explanationEvaluation']){
  for(const key of ['extraActions','expectedExtraActions','phaseEvents','remainingMp','resourceEvents'])assert.equal(JSON.stringify(result[field][key]),JSON.stringify(partyState[key][1]),`${field}.${key}`);
  assert.equal(result[field].combatSamples,32);assert.equal(result[field].sampleKind,'native-initiative-and-combat');
 }
 assert.equal(result.evaluation.damage,80);assert.equal(result.explanationEvaluation.damage,10);
 assert.equal(result.explanationEvaluation.common.attack,77);assert.equal(result.explanationEvaluation.fallbackActionPlan,plan);
});
