const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// GitHub Pages caches each URL for ten minutes. A reference without ?v=, or one file at two versions,
// lets a returning visitor run new code against a stale copy of another file.
const docs=path.join(__dirname,'../docs');
const read=file=>fs.readFileSync(path.join(docs,file),'utf8');
const strings=text=>[...text.matchAll(/'([^']+)'/g)].map(m=>m[1]);
const PATTERNS=[
  /(?:src|href)="(?!https?:|data:)([^"]+\.(?:js|css))[^"]*"/g,
  /\bfrom '(\.[^']+)'/g,
  /new URL\('(\.[^']+)'/g,
  /\bfetch\('([^']+)'\)/g,
];

function references(){
  const out=[];
  for(const file of fs.readdirSync(docs).filter(f=>/\.(js|html)$/.test(f))){
    const text=read(file);
    for(const pattern of PATTERNS)for(const m of text.matchAll(pattern))out.push({from:file,url:m[0].includes('"')?m[0].slice(m[0].indexOf('"')+1,-1):m[1]});
    for(const m of text.matchAll(/\bimportScripts\(([^)]*)\)/g))for(const url of strings(m[1]))out.push({from:file,url});
  }
  return out.map(r=>{const [file,query='']=r.url.replace(/^\.\//,'').split('?');return {...r,file,version:query.match(/^v=(\d+)$/)?.[1]};});
}

test('every browser-loaded local asset carries a ?v= cache version',()=>{
  const missing=references().filter(r=>!r.version).map(r=>`${r.from} → ${r.url}`);
  assert.deepEqual(missing,[]);
});

test('each asset is referenced at one version everywhere',()=>{
  const versions=new Map();
  for(const r of references())versions.set(r.file,new Set([...(versions.get(r.file) || []),r.version]));
  const split=[...versions].filter(([,v])=>v.size>1).map(([file,v])=>`${file}: ${[...v].join(', ')}`);
  assert.deepEqual(split,[]);
});

test('every versioned reference points at a file that exists',()=>{
  const absent=references().filter(r=>!fs.existsSync(path.join(docs,r.file))).map(r=>`${r.from} → ${r.file}`);
  assert.deepEqual(absent,[]);
});

test('the optimizer worker imports each script at the version the site loads',()=>{
  const site=new Map(references().filter(r=>r.from!=='optimizer-worker.js').map(r=>[r.file,r.version]));
  const stale=references().filter(r=>r.from==='optimizer-worker.js' && site.has(r.file) && site.get(r.file)!==r.version).map(r=>`${r.file}: worker ${r.version}, site ${site.get(r.file)}`);
  assert.deepEqual(stale,[]);
});
