const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../docs/damage.js');
const P=require('../docs/passives.js');
const catalog=require('../docs/data/catalog.json');
const native=require('./fixtures/native-combat.json');

for(const row of native.fixtures)test(`executed native instructions: ${row.id}`,()=>{
  const actual=row.kind==='ratio'?{ratioFactor:D.ratioFactor(row.input.attack,row.input.defense)}:
    row.kind==='damage'?D.damage(row.input):D.breakDamage(row.input);
  for(const [key,value] of Object.entries(row.expected))assert.equal(actual[key],value,`${row.id}.${key}`);
});

test('native MP costs preserve zero, truncate and multiply independent cost factors',()=>{
  assert.deepEqual([0,15,19,20].map(n=>D.skillMpCost(n,[150])),[0,22,28,30]);
  assert.deepEqual([0,15,19,20].map(n=>D.skillMpCost(n,[150,150])),[0,33,42,45]);
  assert.equal(D.skillMpCost(15,[0]),1);
});

test('Legendary SOLDIER uses the higher attack and defense; Job Change requires its actual command',()=>{
  const context={skill:{id:400100,dmgType:'Physic',attr:'Ability',element:'None'}};
  const legendary=P.analyze(catalog,[1491],context);
  assert.equal(legendary.modifiers.dominantPower,true);
  assert.equal(legendary.modifiers.dominantDefence,true);
  assert.equal(P.analyze(catalog,[1410],context).modifiers.dominantPower,false);
  assert.match(P.analyze(catalog,[1410],context).deferred[0].reason,/commandId/);
  assert.equal(P.analyze(catalog,[1410],{...context,commandId:102}).modifiers.dominantPower,true);
  assert.equal(P.analyze(catalog,[1410],{...context,commandId:1}).modifiers.dominantPower,false);
});
