/* Search runs off the UI thread; cancellation terminates this worker. */
importScripts('core.js', 'passives.js', 'damage.js', 'stats.js', 'battle.js', 'search.js');
let rulesPromise;
self.onmessage = async event => {
  const {id,catalog,snapshot,enemyId,options} = event.data;
  try {
    rulesPromise ||= fetch('skill-rules.json').then(response=>{if(!response.ok)throw new Error('Native skill eligibility rules are unavailable.');return response.json();});
    catalog.skillRules=await rulesPromise;
    const enemy=catalog.enemies.find(row=>row.id===Number(enemyId));
    if(!enemy)throw new Error('Select an enemy from the native catalog.');
    const model=CompanionBattle.createModel(catalog,snapshot,enemy,options);
    const start=performance.now();
    self.postMessage({id,type:'progress',message:'Evaluating owned skills, passive combinations and legal equipment…'});
    const result=CompanionSearch.rankParties(catalog,snapshot,{
      evaluate:args=>model.evaluate(args),
      evaluateParty:(members,context)=>model.evaluateParty(members,context),
      enemy,options
    });
    result.elapsedMs=Math.round(performance.now()-start);
    result.approximate=true;
    result.reasons=[...new Set([...(result.reasons || []),'Passive packages use a bounded surrogate search before native-formula evaluation.'])];
    result.scenario=model.scenario;
    result.modelEvidence=model.evidence;
    for(const party of result.results || []){
      party.members=party.members.map(member=>({...member,evaluation:{...member.evaluation,...party.evaluation?.actionOverrides?.[member.characterId]}}));
    }
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',message:error.message || String(error)});
  }
};
