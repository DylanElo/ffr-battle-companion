import test from 'node:test';
import assert from 'node:assert/strict';
import {commandPlan} from '../docs/build-details.js';
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
});

test('an opening already named by the battle model is not announced twice',()=>{
 const ev={recipeLabel:'Open with Witching Hour; then Dystopia',turn:{openingTurn:phase(408090,'Witching Hour')}};
 assert.equal(commandPlan(ev,indexes),'Open with Witching Hour; then Dystopia');
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


test('adaptive luck policies describe threshold-based generation instead of a fixed alternation',()=>{
 const ev={recipeLabel:'Fire',turn:{rotationTurns:[phase(400460,'Generate'),phase(220010,'Spend')],luckPolicy:{generatorTurn:phase(400460,'Generate'),spenderTurn:phase(220010,'Spend'),requiredLuck:8,requiredTurnLuck:5}}};
 assert.equal(commandPlan(ev,indexes),'generate Good Luck to 8 with Generate; then spend with Spend');
});

