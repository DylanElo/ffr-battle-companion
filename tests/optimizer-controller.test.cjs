const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../docs/optimizer-controller.js'),'utf8')
  .replace(/^import .*\r?\n/,'').replace('export function','function').replaceAll('import.meta.url',"'http://example.test/'")+'\nglobalThis.create=createOptimizerController;';
function fixture(){
  const handlers={},workers=[],timers=new Map(),snapshot={source:{sha256:'save1'}};
  const context=vm.createContext({URL,renderOptimizer:args=>args,document:{getElementById:()=>null,addEventListener:(name,fn)=>handlers[name]=fn},
    setTimeout:(fn,ms)=>{const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    Worker:class{constructor(){workers.push(this);}postMessage(data){this.message=data;}terminate(){this.terminated=true;}}});
  vm.runInContext(source,context);
  const controller=context.create({getCatalog:()=>({enemies:[]}),getSnapshot:()=>snapshot,rerender:()=>{},stageParty:()=>{},equipParty:()=>{},shareParty:()=>{}});
  controller.render();
  const click=attribute=>handlers.click({target:{closest:()=>({hasAttribute:name=>name===attribute})}});
  const start=()=>{click('data-solve-party');return workers.at(-1);};
  const completed={results:[{score:10,members:[1,2,3,4].map(characterId=>({characterId}))}]};
  const checkpoint=worker=>worker.onmessage({data:{id:worker.message.id,type:'checkpoint',result:completed}});
  return {controller,workers,timers,snapshot,handlers,click,start,completed,checkpoint};
}
test('party search has no watchdog and Stop keeps a completed party while ignoring a late result',()=>{
  const f=fixture(),worker=f.start();
  assert.equal(worker.message.options.timeMs,undefined);assert.equal(worker.message.options.partyTimeMs,undefined);
  assert.equal(f.timers.size,0);f.checkpoint(worker);
  assert.equal(f.controller.render().busy,true);assert.equal(worker.terminated,undefined);
  f.click('data-cancel-party');
  const view=f.controller.render();assert.equal(view.busy,false);assert.equal(view.result.results[0].score,10);
  assert.match(view.result.reasons.at(-1),/stopped early.*best completed party/);assert.equal(worker.terminated,true);assert.equal(f.timers.size,0);
  worker.onmessage({data:{id:worker.message.id,type:'result',result:{results:[]}}});assert.equal(f.controller.render().result.results[0].score,10);
});
test('party Stop without a checkpoint stops cleanly without fabricating results',()=>{
  const f=fixture(),worker=f.start();f.click('data-cancel-party');const view=f.controller.render();
  assert.equal(view.busy,false);assert.equal(view.result,null);assert.match(view.error,/No legal party completed/);assert.equal(worker.terminated,true);
});
test('Stop and worker failure retain completed parties',()=>{
  for(const kind of ['stop','message','runtime','empty']){
    const f=fixture(),worker=f.start();f.checkpoint(worker);
    if(kind==='stop')f.click('data-cancel-party');else if(kind==='message')worker.onmessage({data:{id:worker.message.id,type:'error',message:'Failed.'}});else if(kind==='empty')worker.onmessage({data:{id:worker.message.id,type:'result',result:{results:[]}}});else worker.onerror({message:'Failed.'});
    assert.equal(f.controller.render().result.results[0].score,10);assert.equal(f.controller.render().busy,false);assert.equal(worker.terminated,true);
  }
});
test('changing party requirements cancels old work and prevents stale application',()=>{
  const f=fixture(),worker=f.start();f.checkpoint(worker);
  f.handlers.change({target:{id:'optimizer-healer',type:'checkbox',checked:true,dataset:{}}});
  assert.equal(worker.terminated,true);assert.equal(f.timers.size,0);assert.equal(f.controller.render().result,null);
  worker.onmessage({data:{id:worker.message.id,type:'result',result:f.completed}});assert.equal(f.controller.render().result,null);
});
