import test from 'node:test';
import assert from 'node:assert/strict';
import {entitledMetaIds} from '../src/plan.js';
import {validateActivationSelection} from '../src/services/metaActivation.js';

test('different Meta WABAs can connect multiple independent numbers within plan slots',()=>{
  const profiles=[
    {_id:'business-two-phone',createdAt:'2026-10-20T10:00:00Z'},
    {_id:'business-one-second-phone',createdAt:'2026-10-20T09:00:00Z'},
    {_id:'business-one-first-phone',createdAt:'2026-10-20T08:00:00Z'}
  ];
  assert.deepEqual(entitledMetaIds(profiles,3),[
    'business-one-first-phone','business-one-second-phone','business-two-phone'
  ]);
  assert.deepEqual(entitledMetaIds(profiles,2),[
    'business-one-first-phone','business-one-second-phone'
  ]);
  assert.deepEqual(entitledMetaIds(profiles,0),[]);
});
test('activation validates each selected number against available subscription slots',()=>{
  const authorized=[{id:'1234512345'},{id:'9876598765'}];
  assert.deepEqual(validateActivationSelection(['1234512345','9876598765'],authorized,2),
    ['1234512345','9876598765']);
  assert.throws(()=>validateActivationSelection(['1234512345','9876598765'],authorized,1),
    /subscription allowance/);
  assert.throws(()=>validateActivationSelection(['5555555555'],authorized,2),/not authorized/);
});
