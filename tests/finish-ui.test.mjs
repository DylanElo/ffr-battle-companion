import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildExplanation,finishActions} from '../docs/build-details.js';
import {renderOptimizer} from '../docs/optimizer-ui.js';
const indexes=Object.fromEntries(['skills','passives','masterSkills','effects','equipment'].map(k=>[k,new Map()]));
indexes.skills.set(101,{id:101,name:'Meteor <test>'});
const finish={skillId:101,visionId:2,name:'Meteor <test>',supported:true,mpCost:0,apCost:0,secondaryReasons:['Debuff <test> is not scored']};
const evaluation={finish,finishUses:[{round:2,phase:'finish',skillId:101,visionId:2}],expectedFinishUses:1.5,remainingHp:90,remainingMp:5};
test('Finish summary distinguishes representative casts from mean counts and escapes native names and limitations',()=>{
 const html=finishActions(evaluation,indexes);
 assert.match(html,/Finish: Meteor &#60;test&#62;/);assert.match(html,/1 use\(s\) in the representative path; 1.5 on average \(rounds 2\)/);
 assert.match(html,/One owner is selected after the Additional phase in each qualifying round/);
 assert.match(html,/live ATK\/MAG and effects/);assert.match(html,/recorded base cost is 0 MP; normal cost rules still apply/);assert.match(html,/No equipped ability slot/);assert.match(html,/does not trigger another normal action start/);assert.doesNotMatch(html,/ActionBegin2/);
 assert.match(html,/secondary effects not scored: Debuff &#60;test&#62;/);assert.doesNotMatch(html,/<test>/);
});
test('unsupported Finish support or healing effects do not claim damage inclusion',()=>{
 const html=finishActions({finish:{...finish,supported:false,reason:'Healing <unmodeled>'}},indexes);
 assert.match(html,/Not scored: Healing &#60;unmodeled&#62;/);assert.doesNotMatch(html,/One owner|live ATK\/MAG|use\(s\)/);
 assert.equal(finishActions({},indexes),'');
});
test('Finish event traces show the true phase, selected skill, costs and skip reason',()=>{
 const html=buildExplanation({characterId:1,evaluation:{...evaluation,fallbackActionPlan:{maxHp:100},actionPlan:null,phaseEvents:[{round:2,phase:'finish',kind:'finish-selected',skillId:101,visionId:2,secondaryReasons:['Poison <not scored>']}],resourceEvents:[{round:2,phase:'finish',kind:'finish',skillId:101,damage:300,mpCost:0,hpCost:0,hpAfter:90,mpAfter:5}],resourceSkips:[{round:3,phase:'finish',skillId:101,reason:'Owner has no HP <test>'}]}},indexes);
 assert.match(html,/Finish phase · Finish: Meteor &#60;test&#62; — 300 damage; 0 MP; HP remaining 90, MP remaining 5/);
 assert.match(html,/Finish phase: selected Meteor &#60;test&#62;/);assert.match(html,/secondary effects not scored: Poison &#60;not scored&#62;/);
 assert.match(html,/Finish phase · Meteor &#60;test&#62;: Owner has no HP &#60;test&#62;/);
 assert.doesNotMatch(html,/Normal phase|undefined|<test>/);
});
test('party result cards expose the chosen Finish and retain zero cast counts',()=>{
 const html=renderOptimizer({catalog:{skills:[{id:101,name:'Meteor <test>'}]},snapshot:{},result:{results:[{members:[{characterId:1,evaluation:{...evaluation,finishUses:[],expectedFinishUses:0}}],evaluation:{damage:10}}]}});
 assert.match(html,/Finish: Meteor &#60;test&#62;/);assert.match(html,/0 use\(s\) in the representative path; 0 on average/);
});
test('worker carries party Finish cast maps to both result views without changing pre-party formula evidence',async()=>{
 const messages=[],member={characterId:1,evaluation:{valid:true,damage:10,common:{attack:77},finish,finishUses:[{round:99}],expectedFinishUses:99}};
 const partyState={remainingGuards:{1:[{percent:70,status:"Guard"}]},finishUses:{1:[]},expectedFinishUses:{1:0},phaseEvents:{1:[{phase:'finish',kind:'finish-selected',round:2,skillId:101}]},resourceEvents:{1:[{phase:'finish',kind:'finish',skillId:101,mpCost:0}]},actionOverrides:{1:{damage:20}}};
 const model={evaluate:()=>member.evaluation,evaluateParty:()=>({}),explainAbilities:()=>[]};
 const context={importScripts(){},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),CompanionBattle:{createModel:()=>model},CompanionSearch:{rankParties:()=>({results:[{members:[member],evaluation:partyState}]})},self:{postMessage:value=>messages.push(value)}};
 vm.runInNewContext(fs.readFileSync(new URL('../docs/optimizer-worker.js',import.meta.url),'utf8'),context);
 await context.self.onmessage({data:{id:1,catalog:{enemies:[{id:1}]},snapshot:{party:[1],characters:[{id:1,equipment:{}}]},enemyId:1,options:{partySize:1}}});
 const result=messages.find(message=>message.type==='result').result.results[0].members[0];
 for(const field of ['evaluation','explanationEvaluation']){assert.equal(JSON.stringify(result[field].finishUses),'[]');assert.equal(result[field].expectedFinishUses,0);assert.equal(result[field].remainingGuards[0].percent,70);assert.equal(result[field].finish,finish);assert.equal(result[field].resourceEvents[0].kind,'finish');}
 assert.equal(result.evaluation.damage,20);assert.equal(result.explanationEvaluation.damage,10);assert.equal(result.explanationEvaluation.common.attack,77);
});

test('healing Finish names the owner Divine recovery source instead of offensive damage stats',()=>{
 const html=finishActions({...evaluation,finish:{...finish,kind:'healing',name:'Sacred <heal>'}},indexes);
 assert.match(html,/owner’s Divine for healing, without target defense or critical hits/);
 assert.match(html,/durability goal and controlled incoming-hit scenario/);
 assert.doesNotMatch(html,/live ATK\/MAG/);assert.match(html,/Sacred &#60;heal&#62;/);
});
test('Finish appended parts are attached to one cast and native gauge gains show their actual result',()=>{
 indexes.skills.set(102,{id:102,name:'Splash <part>'});
 const html=buildExplanation({characterId:1,evaluation:{...evaluation,resourceEvents:[{round:2,phase:'finish',kind:'finish',skillId:101,damage:300,mpCost:0,hpAfter:90,mpAfter:5,lbGained:10,gaugeAfter:200},{round:2,phase:'finish',kind:'finish-append',skillId:102,parentSkillId:101,damage:50,paymentSuppressed:true,mpCost:0,hpCost:0,hpAfter:90,mpAfter:5}]}},indexes);
 assert.match(html,/Appended part: Splash &#60;part&#62; \(from Meteor &#60;test&#62;\) — 50 damage/);
 assert.match(html,/no separate MP or AP payment; part of the same Finish use/);
 assert.match(html,/1 use\(s\) in the representative path/);assert.doesNotMatch(html,/2 use\(s\)/);
 assert.match(html,/LB gauge gained 10, gauge after 200/);
});

test('healing Finish trace distinguishes calculated recovery, effective healing and per-recipient HP including OverHeal',()=>{
 const html=buildExplanation({characterId:1,evaluation:{...evaluation,finish:{...finish,kind:'healing'},resourceEvents:[{round:2,phase:'finish',kind:'finish-heal',skillId:101,healing:60,effectiveHealing:80,recipients:[{characterId:1,hpBefore:80,hpAfter:140,healed:60,maxHp:100},{characterId:'2<script>',hpBefore:80,hpAfter:100,healed:20,maxHp:100}],common:{statSource:'Divine',divine:120,coefficient:25,cap:9999,extraPhase:true,overheal:true},mpCost:0,hpCost:0,hpAfter:140,mpAfter:5}]}},indexes);
 assert.match(html,/Healing Finish: Meteor &#60;test&#62; — 60 healing per recipient from owner Divine 120; 80 HP restored in total/);
 assert.match(html,/Character #1: 60 HP restored \(80 → 140 \/ 100\)/);
 assert.match(html,/Character #2&#60;script&#62;: 20 HP restored \(80 → 100 \/ 100\)/);
 assert.match(html,/OverHeal permits HP above the normal maximum/);
 assert.match(html,/0 MP; owner HP remaining 140, MP remaining 5/);
 assert.doesNotMatch(html,/<script>|0 damage|live ATK\/MAG/);
});

test('protective Finish describes one received-skill shield while leaving unrelated defense buffs unscored',()=>{
 const html=finishActions({...evaluation,finish:{...finish,kind:'protection',name:'Bastion',secondaryReasons:['Protect and Shell 30% are not scored']}},indexes);
 assert.match(html,/next received physical or magical skill/);assert.match(html,/consumed after all parts of that skill, including a hit nullified by Hit and Run/);
 assert.match(html,/controlled incoming-hit scenario; no healing or damage is added/);assert.match(html,/Protect and Shell 30% are not scored/);
 assert.doesNotMatch(html,/live ATK\/MAG|Divine for healing|Not scored:/);
});

test('Finish shields show recipients, residual guards and actual consumption even on Hit and Run nullification',()=>{
 const guards=[{effectId:16129,status:'Guard <test>',percent:70}];
 const html=buildExplanation({characterId:1,evaluation:{...evaluation,finish:{...finish,kind:'protection'},remainingGuards:guards,resourceEvents:[{round:2,phase:'finish',kind:'finish-protection',skillId:101,guards,recipients:[{characterId:'2<test>',guards}],mpCost:0,hpAfter:90,mpAfter:5,paymentSuppressed:true},{round:3,phase:'normal',kind:'incoming',damageType:'Physic',damage:0,hpBefore:90,hpAfter:90,nullified:true,guardEffects:guards,guardFactor:.15,guardsConsumed:true}]}},indexes);
 assert.match(html,/Finish protection: Meteor &#60;test&#62; — 70% next-skill reduction/);
 assert.match(html,/Character #2&#60;test&#62;: 70%/);
 assert.match(html,/Shares the primary Finish payment and use; no second cast/);
 assert.match(html,/0 HP damage.*Hit and Run nullified this sampled hit/);
 assert.match(html,/damage factor ×0.15; next-skill shield consumed after this skill/);
 assert.match(html,/Next-skill shields remaining: 70%/);
 assert.doesNotMatch(html,/<test>/);
});
