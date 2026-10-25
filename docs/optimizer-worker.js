/* Search runs off the UI thread; cancellation terminates this worker. */
importScripts('core.js', 'passives.js?v=18', 'damage.js', 'stats.js', 'battle.js?v=18', 'search.js?v=18');
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
    if(event.data.mode==='single'){
      // One character: Resonance, gear, and the best attack with its abilities/passives, for damage or stagger.
      // `available` is the item stock left after other characters' reservations; `taken` Resonances are in use elsewhere.
      const taken=new Set(event.data.taken || []);
      self.postMessage({id,type:'progress',message:'Trying your Resonances, gear and ability combinations…'});
      const evaluate=args=>model.evaluate(args);
      const candidates=CompanionSearch.buildCandidates(catalog,snapshot,event.data.characterId,{evaluate,enemy,options},
        options,new Map(event.data.available));
      const seen=new Set(),results=[];
      for(const c of candidates.filter(c=>!taken.has(c.visionId)).sort((a,b)=>b.score-a.score)){
        const key=`${c.visionId}:${c.evaluation.skillId}`;
        if(seen.has(key))continue;
        seen.add(key);results.push(c);
        if(results.length===3)break;
      }
      self.postMessage({id,type:'result',result:{results,scenario:model.scenario,elapsedMs:Math.round(performance.now()-start)}});
      return;
    }
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
      party.members=party.members.map(member=>({...member,evaluation:{...member.evaluation,...party.evaluation?.actionOverrides?.[member.characterId],limitUses:party.evaluation?.limitUses?.[member.characterId] || []}}));
    }
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',message:error.message || String(error)});
  }
};
