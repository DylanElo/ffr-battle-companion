import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExplanation} from '../docs/build-details.js';
import {renderOptimizer} from '../docs/optimizer-ui.js';
const indexes=Object.fromEntries(['skills','passives','masterSkills','effects','equipment'].map(key=>[key,new Map()]));
indexes.skills.set(406060,{id:406060,name:'Gamble Shot <test>',mag:30,calcType:'Physic'});
const actionPlan={maxHp:100,turn:{leaves:[{skillId:406060}],steps:[{skillId:406060}]}};
const base={skillId:406060,skillIds:[406060],recipeLabel:'Gamble Shot',actionPlan,gambleSamples:32,initiativeSamples:32,sampleKind:'native-initiative-and-gamble',remainingHp:90,remainingMp:10,hpSpent:0,remainingGoodLuck:5,criticalChance:.5,hitProbability:.5};
const render=overrides=>buildExplanation({characterId:1,evaluation:{...base,...overrides}},indexes);

test('Gamble resource traces label a sampled critical hit and the number of parts that actually landed',()=>{
 const html=render({resourceEvents:[{round:1,skillId:406060,mpCost:18,goodLuckAfter:5,hitProbability:.425,
 context:{gambleStageOutcome:true,gambleOutcome:true,gambleHitOutcomes:[true,false,true,false,false,true,false,false]}}]});
 assert.match(html,/sampled Gamble critical hit \(3\/8 parts landed\)/);
 assert.match(html,/per-part hit chance 42.5% at this state/);
 assert.match(html,/Gamble Shot &#60;test&#62;/);assert.doesNotMatch(html,/<test>/);
 assert.match(html,/luck 5/);
});

test('a failed primary roll is shown as a sampled miss without inventing a luck gain',()=>{
 const html=render({remainingGoodLuck:0,resourceEvents:[{round:1,skillId:406060,mpCost:18,goodLuckAfter:0,hitProbability:.5,
 context:{gambleStageOutcome:false,gambleOutcome:false,gambleHitOutcomes:Array(8).fill(false)}}]});
 assert.match(html,/sampled Gamble miss \(0\/8 parts landed\)/);
 assert.match(html,/Good Luck remaining 0 \/ 10/);assert.match(html,/luck 0/);
});

test('averaged HP and MP remain distinct from representative discrete luck and event paths',()=>{
 const html=render({});
 assert.match(html,/Damage and HP\/MP totals are sampled averages across 32 reproducible/);
 assert.match(html,/Luck, skipped actions and the event trace show one representative path/);
 assert.match(html,/outcomes are not guaranteed/);
});

test('the Gamble damage-input label describes a hit chance instead of a chance to crit after landing',()=>{
 const html=render({});
 assert.match(html,/every landed Gamble hit is critical; reference per-part hit chance 50%/);
 assert.doesNotMatch(html,/critical chance 50%/);
});

test('Gamble and accuracy modifiers explain shared rolls, accuracy checks and conditional one-time luck',()=>{
 const html=render({passiveAnalysis:{applied:[{kind:'gambleShot',value:true},{kind:'accuracyBonus',value:15}]}});
 assert.match(html,/one shared critical-or-miss roll, followed by the eight parts’ accuracy checks/);
 assert.match(html,/\+5 luck is gained once when at least one part lands/);
 assert.match(html,/accuracy \+15 points/);
});

test('the hit-only luck warning is hidden only for a verified Gamble lifecycle on this character',()=>{
 const passiveAnalysis={unsupported:[{effectId:65006,reason:'Gamble gain is unmodeled'},{effectId:990001,reason:'Other random gain is unmodeled'}]};
 assert.doesNotMatch(render({passiveAnalysis}),/Gamble gain is unmodeled/);
 assert.match(render({passiveAnalysis}),/Other random gain is unmodeled/);
 assert.match(render({passiveAnalysis,gambleSamples:0}),/Gamble gain is unmodeled/);
 assert.match(render({passiveAnalysis,actionPlan:{maxHp:100,turn:{steps:[{skillId:220010}]}}}),/Gamble gain is unmodeled/);
 const policy={generatorTurn:{steps:[{skillId:406060}]},spenderTurn:{steps:[{skillId:406050}]}};
 assert.doesNotMatch(render({passiveAnalysis,actionPlan:{maxHp:100,turn:{luckPolicy:policy}}}),/Gamble gain is unmodeled/);
});

const catalog={characters:[],visions:[],equipment:[],skills:[],passives:[],masterSkills:[],effects:[],enemies:[]},snapshot={characters:[],resonances:[],party:[],inventory:[]};
test('party summaries use native initiative and Gamble sampling metadata when Gamble is present',()=>{
 const html=renderOptimizer({catalog,snapshot,result:{results:[{members:[],evaluation:{damage:100,rounds:5,gambleSamples:32,initiativeSamples:32}}]}});
 assert.match(html,/Averages 32 reproducible native initiative and Gamble paths/);
 assert.match(html,/Luck, event traces, stagger and LB round labels show one representative path/);
 assert.doesNotMatch(html,/Averages 32 native-priority samples/);
 const ordinary=renderOptimizer({catalog,snapshot,result:{results:[{members:[],evaluation:{damage:100,rounds:5,gambleSamples:0,initiativeSamples:16}}]}});
 assert.match(ordinary,/Averages 16 native-priority samples/);
});
