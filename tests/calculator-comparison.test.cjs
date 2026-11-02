const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),C=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
const reference=require('./fixtures/codex-mundanity-comparison.json');
const statNames={HitPoint:'HP',MaxMagicPoint:'MP',PhysicalAttack:'Physical Attack',MagicalAttack:'Magic Attack',PhysicalDefense:'Physical Defense',MagicalDefense:'Magic Defense',Agility:'Speed',Divine:'Sanctity'};

test('32 identical Mundanity/Solar builds match Codex stats, MP, AP, stagger and quantized HP scope',()=>{
  for(const row of reference.cases){
    const character=C.characters.find(c=>c.id===row.characterId),growth=C.statGrowth[character.levelParamId].rows.filter(r=>r.level<=reference.setup.level);
    const normal=C.skills.filter(s=>s.hasUnit===character.name && s.attr==='Fight').sort((a,b)=>a.id-b.id)[0];
    const equipment={weaponId:row.weaponId,armorId:-1,accessoryIds:[row.solar?12078:-1,-1],visionId:-1};
    const snapshot={characters:[{id:row.characterId,joinStatus:'Join',usable:true,experience:growth.reduce((n,r)=>n+r.requiredExperience,0),baseParameters:[],
      activeSkillIds:[normal.id,...growth.flatMap(r=>r.skillIds).filter(id=>C.skills.some(s=>s.id===id))],equippedSkillIds:Array(8).fill(-1),equipment}],
      resonances:reference.setup.masteryRank9.map(id=>({id,awakeningPoints:0,sync:[{characterId:row.characterId,points:C.visions.find(v=>v.id===id).synchro.at(-1).requiredPoints}]})),
      inventory:[{id:row.weaponId,quantity:1},{id:12078,quantity:1}],party:[row.characterId],player:{difficulty:'Normal'}};
    const enemy={id:1,level:55,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:300,Mind:300,Agility:0},resistances:row.fireWeakness?{Fire:'Weakness'}:{},passiveIds:[]};
    const model=B.createModel({...C,skillRules:rules},snapshot,enemy,{goals:['damage'],rounds:1,actionId:row.skillId,includeSupportOptions:false});
    const result=model.evaluate({characterId:row.characterId,visionId:-1,equipment,equippedSkillIds:row.essence?[1389]:[]});
    const label=JSON.stringify(row);
    assert.equal(result.valid,true,label);
    for(const [local,external] of Object.entries(statNames))assert.equal(result.stats[local],reference.expectedStats[String(row.characterId)][external],local+label);
    assert.equal(result.turnMp,row.external.mpCost,label);
    assert.equal(result.skillCost,row.external.ap,label);
    assert.equal(result.breakDamage,row.external.stagger,label);
    // These one-hit references omit final truncation; our native float32 path truncates each normal/critical outcome.
    assert.ok(Math.abs(result.damage-row.external.damage)<1,label);
  }
});
