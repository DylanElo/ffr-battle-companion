const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../docs/passives.js'),S=require('../docs/stats.js'),native=require('../docs/data/catalog.json');
function fixture(){
 const catalog={characters:[{id:1,levelParamId:1,stats:{HitPoint:100,MagicPoint:50,Attack:11,Defence:21,Intelligence:31,Mind:41,Agility:5,Divine:7,PhysicalAttack:3,PhysicalDefense:4,MagicalAttack:5,MagicalDefense:6},baseSkillEquipCost:100,passiveIds:[]}],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},equipment:[],skills:[],passives:[],masterSkills:[],visions:[],effects:[native.effects.find(e=>e.id===16603)]};
 const snapshot={characters:[{id:1,experience:0,baseParameters:[],equippedSkillIds:[],activeSkillIds:[],equipment:{weaponId:-1,armorId:-1,accessoryIds:[]}}],resonances:[]};
 return {catalog,snapshot};
}
test('Demon Form expands AllParamUp into precisely five native primary-stat scales',()=>{
 const {catalog}=fixture(),decoded=P.decode(catalog.effects[0]),analysis=P.analyze(catalog,[],{activeEffectIds:[16603]});
 assert.equal(decoded.kind,'primaryStatScale');assert.equal(decoded.value,150);
 assert.deepEqual(analysis.terms.map(t=>t.parameter),['Attack','Defence','Intelligence','Mind','Agility']);
 assert.ok(analysis.terms.every(t=>t.kind==='statScale' && t.value===150));
 assert.equal(analysis.modifiers.statScale.Mind,150);
 assert.equal(analysis.unsupported.length,0);
});
test('Demon Form scales primaries and derived combat stats without multiplying HP, MP, AP or intrinsic derived additions',()=>{
 const {catalog,snapshot}=fixture(),analysis=P.analyze(catalog,[],{activeEffectIds:[16603]});
 const base=S.characterStats(catalog,snapshot,1),boosted=S.characterStats(catalog,snapshot,1,null,analysis.terms);
 for(const key of ['Attack','Defence','Intelligence','Mind','Agility'])assert.equal(boosted.stats[key],Math.trunc(base.stats[key]*1.5),key);
 for(const key of ['HitPoint','MagicPoint','EquipCost'])assert.equal(boosted.stats[key],base.stats[key],key);
 assert.equal(boosted.stats.PhysicalAttack,19,'scaled STR16 + intrinsic ATK3');
 assert.equal(boosted.stats.PhysicalDefense,35,'scaled STA31 + intrinsic DEF4');
 assert.equal(boosted.stats.MagicalAttack,51,'scaled INT46 + intrinsic MAG5');
 assert.equal(boosted.stats.MagicalDefense,67,'scaled SPR61 + intrinsic MDEF6');
 assert.equal(boosted.stats.Divine,68,'only the Mind-derived part changes:61+7');
});
test('primary-stat scale follows native float32 delta calculation then per-effect integer conversion',()=>{
 const f=Math.fround,eps=f(2**-23),basis=11;
 const exact=f(f(f(basis)*f(f(f(150)*f(.01))+eps))-f(basis));
 assert.equal(S.effectDelta(basis,{kind:'statScale',value:150}),Math.trunc(exact));
 assert.ok(exact>5.5 && exact<5.501,'native scale epsilon is retained');
 const {catalog,snapshot}=fixture(),terms=P.analyze(catalog,[],{activeEffectIds:[16603]}).terms;
 const twice=S.characterStats(catalog,snapshot,1,null,[...terms,...terms]);
 assert.equal(twice.stats.Attack,21,'native effect aggregation truncates each +5.5 scale delta before adding it');
 const percent=S.characterStats(catalog,snapshot,1,null,[{kind:'statPercent',parameter:'Attack',value:50},{kind:'statPercent',parameter:'Attack',value:50}]);
 assert.equal(percent.stats.Attack,21,'both effect handlers pass through the per-effect integer aggregator');
});
test('AllParamUp refuses unknown trailing parameter layouts',()=>{
 const effect={...native.effects.find(e=>e.id===16603),params:[150,1,...Array(13).fill(-1)]};
 assert.match(P.decode(effect).unsupported,/primary-stat scale layout/);
});
