import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanMetaId,validMetaPhoneList,validateActivationSelection,activationSessionExpired,assertSignupMatchesSelection,shouldRegisterDuringActivation,countNewActivationSlots} from '../src/services/metaActivation.js';

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


test('connecting a number used with another provider never registers it again',()=>{
  assert.equal(shouldRegisterDuringActivation('existing'),false);
  assert.equal(shouldRegisterDuringActivation('coexistence'),false);
  assert.equal(shouldRegisterDuringActivation('new'),true);
});

test('separate Meta login must authorize the exact selected WABA and phone ID',()=>{
  const allowed={
    expectedWabaId:'1000012345',
    authorizedWabaId:'1000012345',
    expectedPhoneNumberId:'2000012345',
    returnedPhoneNumberId:'2000012345'
  };
  assert.equal(assertSignupMatchesSelection(allowed),true);
  assert.throws(()=>assertSignupMatchesSelection({
    ...allowed,authorizedWabaId:'9999912345'
  }),/different WhatsApp Business Account/);
  assert.throws(()=>assertSignupMatchesSelection({
    ...allowed,returnedPhoneNumberId:'8888812345'
  }),/different phone number/);
  // If Meta returns the WABA but no individual phone, our server still
  // validates requested phone membership against Meta /phone_numbers.
  assert.equal(assertSignupMatchesSelection({
    ...allowed,returnedPhoneNumberId:''
  }),true);
  assert.throws(()=>assertSignupMatchesSelection({
    ...allowed,expectedPhoneNumberId:'not-an-id'
  }),/numeric Meta asset ID/);
});

test('reauthorizing a saved Meta sender consumes zero additional subscription slots',()=>{
  const existing=[
    {workspaceId:'workspace-A',phoneNumberId:'12345678901'},
    {workspaceId:'workspace-B',phoneNumberId:'22222222222'}
  ];
  assert.equal(countNewActivationSlots(['12345678901'],existing,'workspace-A'),0);
  assert.equal(countNewActivationSlots(['12345678901','33333333333'],existing,'workspace-A'),1);
  assert.equal(countNewActivationSlots(['22222222222'],existing,'workspace-A'),1);
  assert.equal(countNewActivationSlots([],existing,'workspace-A'),0);
});
