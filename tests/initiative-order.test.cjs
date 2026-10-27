const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json');
const skill=native.skills.find(s=>s.id===230110);
function fixture({agility=50,offset=false,rounds=1,group=false}={}){
 const target={id:1,name:'Target',level:30,stats:{MaxHitPoint:1e9,MaxBreakPoint:100,Agility:0},resistances:{},passiveIds:[]};
 const model=B.createModel({...native,characters:[{id:1,name:'Caster'}],visions:[],equipment:[],artifacts:[]},{characters:[],inventory:[],resonances:[],party:[1,2,3],player:{}},target,{rounds,goals:['damage']});
 const member=(id,speed,bp)=>({characterId:id,evaluation:{skillId:skill.id,damage:100,brokenDamage:200,breakDamage:bp,availableMp:999,turnMp:0,stats:{Agility:speed,MaxHitPoint:1,PhysicalDefense:0,MagicalDefense:0},alwaysPassiveIds:[],passiveIds:[],supportActions:[]}});
 const early=member(1,agility,100),late=member(2,50,0);
 if(offset)early.evaluation.passiveIds=[1049];
 return {model,early,late};
}
test('native initiative sampling is reproducible and does not guarantee slightly faster Agility first',()=>{
 const {model,early,late}=fixture({agility:51});
 const a=model.evaluateParty([early,late]),b=model.evaluateParty([early,late]);
 assert.equal(a.initiativeSamples,16);assert.deepEqual(a,b);
 assert.ok(a.damage>600 && a.damage<700,'some native rolls let the non-breaker act first');
});
test('First Strike changes opening priority only, not every later global turn',()=>{
 const initial=fixture({agility:1,offset:true}),later=fixture({agility:1,offset:true,rounds:2});
 assert.equal(initial.model.evaluateParty([initial.early,initial.late]).damage,700,'opening first strike: 100 + 200 normal, then 200 + 200 additional');
 assert.equal(later.model.evaluateParty([later.early,later.late]).damage,650,'second round loses first-strike priority: normal 100 + 100, then 200 + 200 additional');
});
