import {renderOptimizer} from './optimizer-ui.js?v=15';

export function createOptimizerController({getCatalog,getSnapshot,getFaces=()=>({}),rerender,stageParty}){
  const state={enemyQ:'',bossOnly:true,enemyId:0,objective:'balanced',minHealers:1,minProtectors:0,difficulty:'save',broken:false,critical:false,mpPercent:100,fixedCharacterIds:[],progress:'',partyIndex:0};
  let result=null,busy=false,error='',worker=null,run=0,sourceHash='';
  function cancel(){run++;worker?.terminate();worker=null;busy=false;}
  function render(){
    const snapshot=getSnapshot(),hash=snapshot.source?.sha256 || '';
    if(hash!==sourceHash){cancel();sourceHash=hash;result=null;error='';state.fixedCharacterIds=[];}
    return renderOptimizer({catalog:getCatalog(),snapshot,state,result,busy,error,faces:getFaces()});
  }
  // Opened from a boss page: search that encounter, and show it even if it isn't a boss.
  function setEnemy(id){if(Number(id)===state.enemyId)return;cancel();state.enemyId=Number(id);state.enemyQ='';state.bossOnly=!!getCatalog().enemies.find(e=>e.id===Number(id))?.isBoss;result=null;error='';}
  function start(){
    const catalog=getCatalog(),snapshot=getSnapshot();
    const selected=document.getElementById('optimizer-enemy');
    if(selected)state.enemyId=Number(selected.value);
    cancel();const id=run,hash=snapshot.source?.sha256;
    busy=true;error='';result=null;state.partyIndex=0;state.progress='Preparing progression, passive packages and legal equipment…';
    const options={...state,partySize:4,maxResults:3,beamWidth:40,candidatesPerVision:4,maxEvaluations:12000,perLoadoutBudget:120,timeMs:13000};
    worker=new Worker(new URL('./optimizer-worker.js?v=15',import.meta.url));
    worker.onmessage=event=>{
      if(event.data.id!==run || getSnapshot().source?.sha256!==hash)return;
      if(event.data.type==='progress')state.progress=event.data.message;
      else if(event.data.type==='result'){result=event.data.result;busy=false;worker.terminate();worker=null;}
      else if(event.data.type==='error'){error=event.data.message;cancel();}
      rerender();
    };
    worker.onerror=event=>{if(id!==run)return;error=event.message || 'The search worker could not start.';cancel();rerender();};
    worker.postMessage({id,catalog,snapshot,enemyId:state.enemyId,options});rerender();
  }
  function exportParty(index){
    const party=result?.results?.[index];if(!party)return;
    const snapshot=getSnapshot();
    const content={created:new Date().toISOString(),save:snapshot.source.fileName,sourceHash:snapshot.source.sha256,
      scenario:result.scenario,modelEvidence:result.modelEvidence,search:{approximate:true,evaluations:result.evaluations,reasons:result.reasons},
      note:'Native-formula prediction and companion plan; not a game save.',party};
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
    a.download='ffr-party-recommendation.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-solve-party'))start();
    else if(button.hasAttribute('data-party-tab')){state.partyIndex=Number(button.dataset.partyTab);rerender();}
    else if(button.hasAttribute('data-cancel-party')){cancel();rerender();}
    else if(button.hasAttribute('data-apply-party-index')){
      const party=result?.results?.[Number(button.dataset.applyPartyIndex)];
      if(party){try{stageParty(party.members);error='';}catch(e){error=e.message;}rerender();}
    }else if(button.hasAttribute('data-export-party'))exportParty(Number(button.dataset.exportParty));
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='optimizer-enemy-q'){state.enemyQ=event.target.value;result=null;rerender();}
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    const fields={'optimizer-enemy':'enemyId','optimizer-boss-only':'bossOnly','optimizer-objective':'objective',
      'optimizer-healer':'minHealers','optimizer-protector':'minProtectors','optimizer-difficulty':'difficulty',
      'optimizer-broken':'broken','optimizer-critical':'critical','optimizer-mp':'mpPercent'};
    if(fields[input.id]){
      const key=fields[input.id];state[key]=input.type==='checkbox'?(key.startsWith('min')?Number(input.checked):input.checked):
        ['enemyId','mpPercent'].includes(key)?Number(input.value):input.value;
      result=null;error='';rerender();
    }else if(input.dataset.optimizerLock){
      const id=Number(input.dataset.optimizerLock);
      state.fixedCharacterIds=input.checked?[...new Set([...state.fixedCharacterIds,id])]:state.fixedCharacterIds.filter(n=>n!==id);
      result=null;rerender();
    }
  });
  return {render,cancel,setEnemy};
}
