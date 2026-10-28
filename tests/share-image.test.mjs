import test from 'node:test';
import assert from 'node:assert/strict';
import {shareCard, cardLayout} from '../docs/share-image.js';

const indexes={characters:new Map([[1,{id:1,name:'Nichol'}],[2,{id:2,name:'Fina'}]]),visions:new Map([[10,{id:10,name:'Victoria'}]]),
  equipment:new Map([[100,{id:100,name:'Death Adder'}],[101,{id:101,name:'Earrings'}]]),
  skills:new Map([[230110,{id:230110,name:'Faith'}],[500,{id:500,name:'Darkga'}],[600,{id:600,name:'First Aid'}]]),
  passives:new Map(Array.from({length:8},(_,i)=>[900+i,{id:900+i,name:`Passive ${i+1}`}])),masterSkills:new Map()};
const member=(characterId,evaluation,equipment={weaponId:100,armorId:-1,accessoryIds:[101,-1]})=>({characterId,visionId:characterId===2?10:-1,equipment,evaluation});
const party=(evaluation={})=>({members:[
  member(1,{skillId:230110,recipeLabel:'Faith',damage:0,equippedSkillIds:[600]}),
  member(2,{skillId:500,recipeLabel:'Darkga',damage:5644.6,equippedSkillIds:[900,600]})],
  evaluation:{damage:27787.2,supportUsed:{characterId:1,skillId:230110,targetIds:[2]},...evaluation}});

test('the share card names each member with their Resonance, move, damage, gear and abilities',()=>{
  const fina=shareCard(party(),indexes,{title:'Gogmagog (Lv 34)'}).members[1];
  assert.deepEqual(fina,{id:2,visionId:10,name:'Fina',resonance:'Victoria',move:'Darkga',damage:'5,645',
    gear:[{label:'Weapon',name:'Death Adder'},{label:'Armor',name:'—'},{label:'Acc. 1',name:'Earrings'},{label:'Acc. 2',name:'—'}],abilities:['Passive 1','First Aid']});
});
test('the support caster reads Support instead of zero damage',()=>{
  assert.equal(shareCard(party(),indexes).members[0].damage,'Support');
});
test('the card carries the party total and the fight it was built for',()=>{
  const card=shareCard(party(),indexes,{title:'Gogmagog (Lv 34)'});
  assert.deepEqual([card.title,card.total],['Gogmagog (Lv 34)','27,787']);
});
test('the change against the current setup appears only when there is one',()=>{
  assert.deepEqual([shareCard(party(),indexes,{current:{damage:20000}}).change,shareCard(party(),indexes).change],['+39% vs current setup','']);
});
test('a long ability list ends with a count of the rest so the picture keeps its size',()=>{
  const long=party();long.members[1].evaluation.equippedSkillIds=[900,901,902,903,904,905,906,907];
  assert.deepEqual(shareCard(long,indexes).members[1].abilities,['Passive 1','Passive 2','Passive 3','Passive 4','Passive 5','+3 more']);
});
test('the card lists the boss weaknesses it was given, and none for any fight',()=>{
  assert.deepEqual([shareCard(party(),indexes,{weak:['Wind','Light']}).weak,shareCard(party(),indexes).weak],[['Wind','Light'],[]]);
});
test('a single build carries its own heading',()=>{
  assert.equal(shareCard({members:[party().members[1]],evaluation:{damage:5645}},indexes,{heading:'Best build'}).heading,'Best build');
});
test('the square picture is 1080 by 1080 with four members two to a row',()=>{
  const {width,height,cells}=cardLayout({members:4,abilityRows:6,square:true});
  assert.deepEqual([width,height,cells.map(c=>[c.x,c.y])],[1080,1080,[[40,168],[550,168],[40,596],[550,596]]]);
});
test('every square panel fits its content and stays inside the picture',()=>{
  const layout=cardLayout({members:4,gearRows:4,abilityRows:6,square:true});
  assert.ok(layout.cells.every(c=>c.h>=182+Math.max(4*26,24+6*22)+8 && c.y+c.h<=layout.height-76));
});
test('a single build in the square picture is drawn twice as large and centered',()=>{
  const {cells:[cell]}=cardLayout({members:1,gearRows:4,abilityRows:1,square:true});
  assert.deepEqual([cell.zoom,cell.h,cell.y],[2,588,292]);
});
test('the wide picture keeps its four columns across 1200 pixels',()=>{
  const {width,cells}=cardLayout({members:4,abilityRows:5});
  assert.deepEqual([width,cells.map(c=>c.x),cells[0].w],[1200,[40,325,610,895],265]);
});
