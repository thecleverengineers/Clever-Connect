import test from 'node:test';
import assert from 'node:assert/strict';
import {metaTemplateSyncIdentity,metaTemplateSyncFields,upsertRemoteMetaTemplate} from '../src/services/metaTemplateSync.js';

test('Meta template sync uses the canonical unique key, never the remote numeric ID',()=>{
  const identity=metaTemplateSyncIdentity('workspace-1','sender-2',{
    id:'987654321',name:'admin_order',language:'en'
  });
  assert.deepEqual(identity,{
    workspaceId:'workspace-1',integrationId:'sender-2',
    metaTemplateName:'admin_order',language:'en'
  });
  assert.equal('metaTemplateId' in identity,false);
  assert.throws(()=>metaTemplateSyncIdentity('w','s',{id:'1',language:'en'}),/without a name/);
  assert.throws(()=>metaTemplateSyncIdentity('w','s',{name:'admin_order'}),/without an ID/);
});

test('repeated Meta sync updates one document even if Meta numeric IDs differ',async()=>{
  const records=new Map();
  const model={
    async findOneAndUpdate(identity,update,opts={}){
      const key=[identity.workspaceId,identity.integrationId,identity.metaTemplateName,identity.language].join(':');
      if(!records.has(key)&&opts.upsert!==true)return null;
      const current=records.get(key)||{...identity,_id:'single-local-record'};
      const next={...current,...update.$set};
      records.set(key,next);
      return next;
    }
  };
  const base={name:'admin_order',language:'en',category:'UTILITY',
    status:'APPROVED',components:[{type:'BODY',text:'Your order {{1}}'}]};
  const first=await upsertRemoteMetaTemplate(model,'w1','sender',{...base,id:'111'});
  const second=await upsertRemoteMetaTemplate(model,'w1','sender',{...base,id:'222'});
  assert.equal(records.size,1);
  assert.equal(first._id,second._id);
  assert.equal(second.metaTemplateId,'222');
  assert.equal(second.body,'Your order {{1}}');
});

test('upsert collision from concurrent sync is recovered by updating winning record',async()=>{
  const requests=[];
  const model={
    async findOneAndUpdate(identity,update,opts){
      requests.push({identity,opts});
      if(opts.upsert){const err=new Error('E11000 duplicate key');err.code=11000;throw err;}
      return {_id:'existing',...identity,...update.$set};
    }
  };
  const row=await upsertRemoteMetaTemplate(model,'w','s',{id:'12',name:'admin_order',language:'en'});
  assert.equal(row._id,'existing');
  assert.equal(requests.length,2);
  assert.equal(requests[0].opts.upsert,true);
  assert.equal(requests[1].opts.upsert,false);
  assert.deepEqual(requests[0].identity,requests[1].identity);
});

test('non-index Mongo errors are never swallowed',async()=>{
  const model={async findOneAndUpdate(){throw new Error('Database disconnected')}};
  await assert.rejects(upsertRemoteMetaTemplate(model,'w','s',{id:'12',name:'x',language:'en'}),/Database disconnected/);
});

test('Meta template fields preserve valid statuses, content and last sync date',()=>{
  const row=metaTemplateSyncFields({id:'123',name:'status_notification',
    category:'UTILITY',status:'APPROVED',components:[{type:'BODY',text:'Hello {{1}}'}]});
  assert.equal(row.name,'status_notification');
  assert.equal(row.metaTemplateId,'123');
  assert.equal(row.metaStatus,'APPROVED');
  assert.ok(row.metaLastSyncedAt instanceof Date);
  assert.equal(row.body,'Hello {{1}}');
});
