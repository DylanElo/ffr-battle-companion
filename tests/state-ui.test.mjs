import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExplanation,commandPlan} from '../docs/build-details.js';
import {renderOptimizer} from '../docs/optimizer-ui.js';
import {createOptimizerController} from '../docs/optimizer-controller.js';
const indexes=Object.fromEntries(['skills','passives','masterSkills','effects','equipment'].map(key=>[key,new Map()]));
indexes.skills.set(408090,{id:408090,name:'Witching Hour',equipCost:20});
indexes.skills.set(220010,{id:220010,name:'Fire',equipCost:10,mag:30});
indexes.skills.set(400460,{id:400460,name:'Focus',equipCost:20});
const phase=(id,label)=>({recipeLabel:label,leaves:[{skillId:id}],steps:[{skillId:id}],mp:8});

test('opening and rotating commands remain visible rather than showing only the steady attack',()=>{
 const ev={recipeLabel:'Fire',turn:{openingTurn:phase(408090,'Witching Hour'),rotationTurns:[phase(400460,'Focus'),phase(220010,'Fire')]}};
 assert.equal(commandPlan(ev,indexes),'Open with Witching Hour; then repeat Focus → Fire');
 const html=buildExplanation({characterId:1,evaluation:{...ev,skillId:220010,equippedSkillIds:[408090],skillBudget:100,skillCost:20,maxSkillSlots:8}},indexes);
 assert.match(html,/Used in the selected command sequence/);
 assert.match(html,/Open with Witching Hour/);
 assert.match(buildExplanation({characterId:1,evaluation:{...ev,actionPlan:{maxHp:100},remainingHp:100}},indexes),/Opening: Witching Hour — 8 MP/);
});

test('resource explanations show paid HP, native skips and the representative state trace',()=>{
 const html=buildExplanation({characterId:1,evaluation:{skillId:220010,recipeLabel:'Fire',actionPlan:{maxHp:100},remainingHp:0,hpSpent:100,remainingMp:5,remainingGoodLuck:8,
 resourceSkips:[{round:4,skillId:220010,reason:'The caster has no HP remaining. <test>'}],resourceEvents:[{round:1,skillId:220010,mpCost:5,hpCost:5,hpBefore:100,hpAfter:95,goodLuckAfter:8}],
 passiveAnalysis:{applied:[{kind:'primaryStatScale',value:150}]}}},indexes);
 assert.match(html,/HP remaining 0 \/ 100; HP paid 100/);
 assert.match(html,/forecast ends at zero HP/);
 assert.match(html,/Reference passive inputs before resource payment/);
 assert.match(html,/STR \/ STA \/ INT \/ SPR \/ SPD scale 150%/);
 assert.match(html,/HP, MP and AP have no direct scale/);
 assert.match(html,/representative forecast/);
 assert.match(html,/Round 4/);assert.match(html,/&#60;test&#62;/);
});

const catalog={characters:[],visions:[],equipment:[],skills:[],passives:[],masterSkills:[],effects:[],enemies:[]};
const snapshot={characters:[],resonances:[],party:[],inventory:[]};
test('controlled incoming-hit settings default to zero and describe their fixed event timing',()=>{
 const html=renderOptimizer({catalog,snapshot});
 assert.match(html,/id="optimizer-incoming-damage"[^>]*value="0"/);
 assert.match(html,/after acting, each round/);
 assert.match(html,/after defense, before Mirror reduction/);
 assert.match(html,/Set 0 for no incoming hits/);
});

test('party event settings are clamped and passed to the worker as explicit scenario options',()=>{
 const previousDocument=globalThis.document,previousWorker=globalThis.Worker,handlers={};let posted;
 globalThis.document={addEventListener:(name,handler)=>handlers[name]=handler,getElementById:()=>null};
 globalThis.Worker=class{terminate(){}postMessage(value){posted=value;}};
 try{
  createOptimizerController({getCatalog:()=>catalog,getSnapshot:()=>snapshot,rerender:()=>{},stageParty:()=>{}});
  handlers.change({target:{id:'optimizer-incoming-damage',type:'number',value:'9999999999'}});
  handlers.change({target:{id:'optimizer-incoming-type',type:'select-one',value:'Magic'}});
  const button={hasAttribute:name=>name==='data-solve-party'};
  handlers.click({target:{closest:()=>button}});
  assert.equal(posted.options.incomingDamage,99999999);assert.equal(posted.options.incomingType,'Magic');
  handlers.change({target:{id:'optimizer-incoming-damage',type:'number',value:'-5'}});
  handlers.click({target:{closest:()=>button}});
  assert.equal(posted.options.incomingDamage,0);
 }finally{globalThis.document=previousDocument;globalThis.Worker=previousWorker;}
});


test('incoming hits and Limit Bursts use event labels and their actual costs',()=>{
 const html=buildExplanation({characterId:1,evaluation:{actionPlan:{maxHp:100},remainingHp:80,resourceEvents:[
  {round:1,kind:'incoming',damageType:'Magic',damage:20,hpBefore:100,hpAfter:80,mirrorReduction:true},
  {round:2,kind:'limit',skillId:220010,damage:300,hpAfter:80,mpAfter:17,goodLuckAfter:0}
 ]}},indexes);
 assert.match(html,/Magic incoming hit: 20 HP damage/);
 assert.match(html,/Mirror reduction applied/);
 assert.match(html,/Limit Burst: Fire — 300 damage; HP remaining 80, MP remaining 17/);
 assert.doesNotMatch(html,/Skill #undefined|Skill #0|: 0 MP/);
});

test('adaptive luck policies describe threshold-based generation instead of a fixed alternation',()=>{
 const ev={recipeLabel:'Fire',turn:{rotationTurns:[phase(400460,'Generate'),phase(220010,'Spend')],luckPolicy:{generatorTurn:phase(400460,'Generate'),spenderTurn:phase(220010,'Spend'),requiredLuck:8,requiredTurnLuck:5}}};
 assert.equal(commandPlan(ev,indexes),'generate Good Luck to 8 with Generate; then spend with Spend');
 const html=buildExplanation({characterId:1,evaluation:{...ev,actionPlan:{maxHp:100},remainingHp:100}},indexes);
 assert.match(html,/Generate to 8 luck: Generate/);assert.match(html,/Spend when available: Spend/);assert.doesNotMatch(html,/Rotation 1/);
});

test('native luck lifecycle effects handled by actionPlan are not labelled unsupported',()=>{
 const html=buildExplanation({characterId:1,evaluation:{actionPlan:{maxHp:100,passiveIds:[1499,1511]},remainingHp:100,
 passiveAnalysis:{unsupported:[{effectId:65004,reason:'AddGoodLuck unmodeled'},{effectId:65005,reason:'AddGoodLuck unmodeled'},{effectId:65006,reason:'Random gain is unmodeled'}]}}},indexes);
 assert.doesNotMatch(html,/AddGoodLuck unmodeled/);assert.match(html,/Random gain is unmodeled/);
});

test('unconfirmed luck effects keep their unsupported warning without a handled passive source',()=>{
 const html=buildExplanation({characterId:1,evaluation:{actionPlan:{maxHp:100,passiveIds:[]},remainingHp:100,passiveAnalysis:{unsupported:[{effectId:65004,reason:'Unconfirmed timing'}]}}},indexes);
 assert.match(html,/Unconfirmed timing/);
});
