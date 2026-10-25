import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dll=path.join(root,'importer/bin/Release/net10.0/BattleCompanionImporter.dll');
const parse=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'docs/save.js')).toString('base64'));
const app=fs.readFileSync(path.join(root,'docs/app.js'),'utf8');
const isolated=app.slice(app.indexOf('export async function readSave('),app.indexOf('\nasync function loadSave(')).replace('export ','');
const readSave=Function('S',isolated+';return readSave;')(parse);

test('browser and desktop importers agree on battle inputs in every detected save, without changing source files',async t=>{
  if(!fs.existsSync(dll))return t.skip('Local read-only desktop importer is not present in the published site.');
  const list=JSON.parse(execFileSync('dotnet',[dll,'--list'],{encoding:'utf8'})).saves;
  assert.ok(list.length>0,'Need at least one local save for read-only integration validation.');
  for(const file of list){
    const bytes=fs.readFileSync(file.path);
    const sha=crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
    const browser=await readSave(new File([bytes],file.fileName,{lastModified:Date.parse(file.lastWriteUtc)}));
    const desktop=JSON.parse(execFileSync('dotnet',[dll,'--save',file.path],{encoding:'utf8'}));
    assert.equal(browser.source.sha256,sha);
    assert.equal(desktop.source.sha256,sha);
    assert.deepEqual(browser.inventory,desktop.inventory);
    assert.deepEqual(browser.characters,desktop.characters);
    assert.deepEqual(browser.resonances,desktop.resonances);
    assert.deepEqual(browser.artifactOverrides,desktop.artifactOverrides);
    assert.equal(browser.player.GameDifficulty,desktop.player.GameDifficulty);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex').toUpperCase(),sha);
  }
  console.log(`Browser/desktop battle-input parity verified for ${list.length} save slots.`);
});

test('growth table keeps per-level experience costs and exact native difficulty multipliers',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'docs/data/catalog.json'),'utf8'));
  const rain=catalog.characters.find(c=>c.id===1001);
  const growth=catalog.statGrowth[rain.levelParamId];
  assert.equal(growth.experienceMode,'per-level-cost');
  let left=119338,level=1;
  for(const row of growth.rows){left-=row.requiredExperience;if(left<0)break;level=row.level;}
  assert.equal(level,30);
  assert.equal(growth.rows.find(r=>r.level===30).requiredExperience,13867);
  const expert=catalog.difficultyRules.find(r=>r.difficulty==='Expert');
  assert.equal(expert.DamageGivenRate,.8);
  assert.equal(expert.DamageTakenRate,1.4);
  assert.equal(expert.EnemyHpRate,1.6);
});
