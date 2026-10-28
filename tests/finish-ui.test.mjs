import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const finish={skillId:101,visionId:2,name:'Meteor <test>',supported:true,mpCost:0,apCost:0,secondaryReasons:['Debuff <test> is not scored']};
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

