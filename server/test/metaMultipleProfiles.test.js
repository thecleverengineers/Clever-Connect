import test from 'node:test';
import assert from 'node:assert/strict';
import {entitledMetaIds} from '../src/plan.js';
import {validateActivationSelection} from '../src/services/metaActivation.js';

test('multiple independent Meta WABAs use one subscription slot per phone',()=>{
  const profiles=[
    {_id:'meta-waba-B-number-1',createdAt:'2026-10-20T09:00:00.000Z'},
    {_id:'meta-waba-A-number-2',createdAt:'2026-10-20T08:00:00.000Z'},
    {_id:'meta-waba-A-number-1',createdAt:'2026-10-20T07:00:00.000Z'}
  ];
  assert.deepEqual(entitledMetaIds(profiles,3),[
    'meta-waba-A-number-1','meta-waba-A-number-2','meta-waba-B-number-1'
  ]);
  assert.deepEqual(entitledMetaIds(profiles,2),[
    'meta-waba-A-number-1','meta-waba-A-number-2'
  ]);
  assert.deepEqual(entitledMetaIds(profiles,0),[]);
});

test('selecting two authorized phone profiles respects available plan capacity',()=>{
  const phones=[{id:'1234512345'},{id:'9876598765'},{id:'8888888888'}];
  assert.deepEqual(validateActivationSelection(['1234512345','9876598765'],phones,2),
    ['1234512345','9876598765']);
  assert.throws(()=>validateActivationSelection(['1234512345','9876598765'],phones,1),
    /subscription allowance/);
  assert.throws(()=>validateActivationSelection(['9999999999'],phones,3),
    /not authorized/);
});
