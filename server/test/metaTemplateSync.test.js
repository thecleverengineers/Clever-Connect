import test from 'node:test';
import assert from 'node:assert/strict';
import {metaTemplateIdentity,reconcileMetaTemplate} from '../src/services/metaTemplateSync.js';

test('Meta template stable key is workspace, sender, name and language rather than numeric ID',()=>{
  const identity=metaTemplateIdentity('w','sender',{id:'12',name:'admin_order',language:'en'});
  assert.deepEqual(identity,{
    workspaceId:'w',integrationId:'sender',metaTemplateName:'admin_order',language:'en'
  });
  assert.equal('metaTemplateId' in identity,false);
  assert.equal(metaTemplateIdentity('w','sender',{id:'12',name:'',language:'en'}),null);
  assert.equal(metaTemplateIdentity('w','sender',{id:'',name:'admin_order',language:'en'}),null);
});
test('repeat sync is idempotent even if Meta ID changes',async()=>{
  const table=new Map();
  const model={async findOneAndUpdate(key,update,opts){
    const ref=[key.workspaceId,key.integrationId,key.metaTemplateName,key.language].join(':');
    if(!table.has(ref)&&!opts.upsert)return null;
    const next={...key,...(table.get(ref)||{}),...update.$set,_id:table.get(ref)?._id||'original'};
    table.set(ref,next);
    return next;
  }};
  const key=metaTemplateIdentity('w','s',{id:'111',name:'admin_order',language:'en'});
  const first=await reconcileMetaTemplate(model,key,{name:'admin_order',metaTemplateId:'111',metaStatus:'APPROVED'});
  const second=await reconcileMetaTemplate(model,key,{name:'admin_order',metaTemplateId:'222',metaStatus:'APPROVED'});
  assert.equal(first._id,second._id);
  assert.equal(table.size,1);
  assert.equal(second.metaTemplateId,'222');
});
test('unique-index insertion race retries as update only (no duplicate insert)',async()=>{
  const calls=[];
  const model={async findOneAndUpdate(key,update,opts){
    calls.push(opts);
    if(opts.upsert){const e=new Error('duplicate key');e.code=11000;throw e;}
    return {...key,...update.$set,_id:'winning-row'};
  }};
  const key=metaTemplateIdentity('w','s',{id:'111',name:'admin_order',language:'en'});
  const result=await reconcileMetaTemplate(model,key,{metaTemplateId:'111'});
  assert.equal(result._id,'winning-row');
  assert.deepEqual(calls.map(x=>x.upsert),[true,false]);
});
test('real database errors are not mistaken for duplicate-key races',async()=>{
  const model={async findOneAndUpdate(){throw Error('Database unavailable')}};
  await assert.rejects(reconcileMetaTemplate(model,{workspaceId:'w'},{metaTemplateId:'333'}),/Database unavailable/);
});
