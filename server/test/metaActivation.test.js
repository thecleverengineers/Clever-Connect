import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanMetaId,validMetaPhoneList,validateActivationSelection,activationSessionExpired} from '../src/services/metaActivation.js';

test('Meta selectable numbers are unique, valid, bounded and do not include token material',()=>{
  const items=validMetaPhoneList([
    {id:'12345678901',display_phone_number:'+919111111111',verified_name:'Business A',access_token:'should-not-appear'},
    {id:'12345678901',display_phone_number:'+919111111111'},
    {id:'22222222222',display_phone_number:'+919222222222',verified_name:'Business B'},
    {id:'not-a-meta-id',display_phone_number:'wrong'}
  ]);
  assert.deepEqual(items.map(x=>x.id),['12345678901','22222222222']);
  assert.equal(JSON.stringify(items).includes('should-not-appear'),false);
  assert.equal(cleanMetaId(' 12345678901 '),'12345678901');
  assert.throws(()=>cleanMetaId('+919111111111'),/numeric/);
});

test('user must explicitly select numbers that belong to the authorized WABA',()=>{
  const permitted=[{id:'12345678901'},{id:'22222222222'}];
  assert.deepEqual(validateActivationSelection(['22222222222'],permitted,1),['22222222222']);
  assert.throws(()=>validateActivationSelection([],permitted,1),/Select at least one/);
  assert.throws(()=>validateActivationSelection(['12345678901','22222222222'],permitted,1),/subscription allowance/);
  assert.throws(()=>validateActivationSelection(['12345678901','12345678901'],permitted,2),/more than once/);
  assert.throws(()=>validateActivationSelection(['33333333333'],permitted,2),/not authorized/);
});

test('staged Meta authorizations expire explicitly even before Mongo TTL cleanup',()=>{
  const now=Date.now();
  assert.equal(activationSessionExpired({expiresAt:new Date(now-1000)},now),true);
  assert.equal(activationSessionExpired({expiresAt:new Date(now+1000)},now),false);
  assert.equal(activationSessionExpired(null,now),true);
});
