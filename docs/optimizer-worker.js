/* Search runs off the UI thread; cancellation terminates this worker. */
importScripts('core.js?v=26', 'passives.js?v=25', 'damage.js?v=6', 'stats.js?v=24', 'battle.js?v=39', 'search.js?v=31', 'unlock-recommendations.js?v=1');
// The setup as saved: its gear, Resonance and equipped abilities, scored by the same model for a before/after.
const savedSetup=(snapshot,id)=>snapshot.characters.find(c=>c.id===id);
function currentOf(model,snapshot,id){
  const saved=savedSetup(snapshot,id);if(!saved?.equipment)return null;
  const evaluation=model.evaluate({characterId:id,visionId:Number(saved.equipment.visionId),equipment:saved.equipment,current:true});
  return evaluation.valid?evaluation:null;
}
let rulesPromise;
self.onmessage = async event => {
  const {id,catalog,snapshot,enemyId,options} = event.data;
  try {
    rulesPromise ||= fetch('skill-rules.json?v=1').then(response=>{if(!response.ok)throw new Error('Native skill eligibility rules are unavailable.');return response.json();});
    catalog.skillRules=await rulesPromise;
    const enemy=enemyId===CompanionBattle.GENERAL_ENEMY_ID?CompanionBattle.generalEnemy(catalog,snapshot):catalog.enemies.find(row=>row.id===Number(enemyId));
    if(!enemy)throw new Error('Select an enemy from the native catalog.');
    if(event.data.mode==='unlocks'){
      const result=CompanionUnlocks.recommend(catalog,snapshot,event.data.characterId,event.data.build,enemy,options,
        {core:Companion,stats:CompanionStats,battle:CompanionBattle},message=>self.postMessage({id,type:'progress',message}));
      self.postMessage({id,type:'result',result});
      return;
    }
    const model=CompanionBattle.createModel(catalog,snapshot,enemy,{...options,includeSupportOptions:event.data.mode!=='single'});
    const start=performance.now();
    if(event.data.mode==='single'){
      // One character: Resonance, gear, and the best attack with its abilities/passives, for damage or stagger.
      // `available` is the item stock left after other characters' reservations; `taken` Resonances are in use elsewhere.
      const taken=new Set(event.data.taken || []);
      self.postMessage({id,type:'progress',message:'Trying your Resonances, gear and ability combinations…'});
      const evaluate=args=>model.evaluate(args);
      const available=new Map(event.data.available);
      const candidates=CompanionSearch.buildCandidates(catalog,snapshot,event.data.characterId,{evaluate,enemy,options},
        options,available);
      // shortcut: complete a bounded shortlist; increase candidate budgets for a wider comparison.
      const completed=candidates.filter(c=>!taken.has(c.visionId)).sort((a,b)=>b.score-a.score)
        .slice(0,Math.max(3,3*(options.candidatesPerVision || 6)))
        .map(c=>CompanionSearch.finalizeBuilds(catalog,snapshot,[c],available,{evaluate,enemy,options})[0])
        .sort((a,b)=>b.score-a.score);
      const seen=new Set(),results=[];
      for(const c of completed){
        const key=`${c.visionId}:${c.evaluation.skillId}`;
        if(seen.has(key))continue;
        seen.add(key);results.push(c);
        if(results.length===3)break;
      }
      results.sort((a,b)=>b.score-a.score);
      for(const member of results){
        member.evaluation={...member.evaluation,warnings:[...new Set([...(model.globalWarnings || []),...(member.evaluation.warnings || [])])]};
        member.abilityReasons=model.explainAbilities(member);
      }
      const baseline=event.data.baseline;
      const before=baseline?model.evaluate({characterId:event.data.characterId,visionId:baseline.visionId,equipment:baseline,
        current:true,equippedSkillIds:baseline.equippedSkillIds || []}):null;
      self.postMessage({id,type:'result',result:{results,before,current:currentOf(model,snapshot,event.data.characterId),scenario:model.scenario,modelEvidence:model.evidence,elapsedMs:Math.round(performance.now()-start)}});
      return;
    }
    self.postMessage({id,type:'progress',message:'Evaluating owned skills, passive combinations and legal equipment…'});
    const result=CompanionSearch.rankParties(catalog,snapshot,{
      progress:message=>self.postMessage({id,type:'progress',message}),
      evaluate:args=>model.evaluate(args),
      evaluateParty:(members,context)=>model.evaluateParty(members,context),
      enemy,options
    });
    const members=snapshot.party.filter(n=>n>0).map(n=>({characterId:n,evaluation:currentOf(model,snapshot,n)}));
    const completeCurrent=members.length===(options?.partySize ?? 4) && members.every(m=>m.evaluation) && new Set(members.map(m=>m.characterId)).size===members.length;
    result.current=completeCurrent?{...model.evaluateParty(members),characterIds:members.map(m=>m.characterId)}:null;
    result.elapsedMs=Math.round(performance.now()-start);
    result.approximate=true;
    result.reasons=[...new Set([...(result.reasons || []),'Passive packages use a bounded surrogate search before native-formula evaluation.'])];
    result.scenario=model.scenario;
    result.modelEvidence=model.evidence;
    for(const party of result.results || []){
      party.members=party.members.map(member=>{
        const state={};
        for(const key of ['remainingHp','hpSpent','resourceSkips','stateLeafResults','resourceEvents','remainingGoodLuck','overclockCharges','overclockStates','overheat','demonForm','remainingMp','mpExhaustedRounds','extraActions','expectedExtraActions','phaseEvents','finishUses','expectedFinishUses','remainingGuards']){
          const values=party.evaluation?.[key];
          if(values && Object.hasOwn(values,member.characterId))state[key]=values[member.characterId];
        }
        for(const key of ['gambleSamples','combatSamples','sampleKind','initiativeSamples'])if(Object.hasOwn(party.evaluation || {},key))state[key]=party.evaluation[key];
        if(state.stateLeafResults?.length)state.leafResults=state.stateLeafResults;
        state.limitUses=party.evaluation?.limitUses?.[member.characterId] || [];
        return {...member,abilityReasons:model.explainAbilities(member),
          explanationEvaluation:{...member.evaluation,...state},
          evaluation:{...member.evaluation,...party.evaluation?.actionOverrides?.[member.characterId],...state}};
      });
    }
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',message:error.message || String(error)});
  }
};
