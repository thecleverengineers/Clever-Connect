import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMetaSendError} from '../src/services/metaSendErrors.js';
import {verifyMessagingPermissionDebug} from '../src/services/metaTokenDiagnostics.js';

test('Meta OAuth failures identify sender credentials, not Clever Connect session',()=>{
  const a=classifyMetaSendError({httpStatus:401,error:{code:190,message:'Authentication Error'}});
  assert.equal(a.code,'META_SENDER_AUTH_REQUIRED');
  assert.equal(a.senderAuthFailure,true);
  assert.match(a.message,/access token/);
  const b=classifyMetaSendError({httpStatus:403,error:{code:10,message:'Application does not have permission'}});
  assert.equal(b.code,'META_SENDER_AUTH_REQUIRED');
  const c=classifyMetaSendError({httpStatus:400,error:{message:'Authentication Error'}});
  assert.equal(c.senderAuthFailure,true);
});

test('Meta rate limits and ordinary delivery errors do not incorrectly mark sender credentials invalid',()=>{
  for(const error of [
    {code:4,message:'Request limit reached'},
    {code:131026,message:'Message undeliverable'},
    {code:131047,message:'Re-engagement message'}
  ]){
    const classification=classifyMetaSendError({httpStatus:400,error});
    assert.equal(classification.senderAuthFailure,false);
    assert.equal(classification.code,'META_SEND_REJECTED');
  }
});

test('Validate messaging permission only for token issued by configured Meta app',()=>{
  const good=verifyMessagingPermissionDebug({
    app_id:'1234567',is_valid:true,scopes:['whatsapp_business_messaging'],expires_at:0
  },'1234567');
  assert.equal(good.checked,true);
  assert.equal(good.messagingPermission,true);
  const other=verifyMessagingPermissionDebug({app_id:'9876543',is_valid:false},'1234567');
  assert.equal(other.checked,false);
});

test('Missing, expired and invalid Meta token scopes cannot pass health verification',()=>{
  assert.throws(()=>verifyMessagingPermissionDebug({
    app_id:'1234567',is_valid:true,scopes:['whatsapp_business_management']
  },'1234567'),/whatsapp_business_messaging/);
  assert.throws(()=>verifyMessagingPermissionDebug({
    app_id:'1234567',is_valid:false
  },'1234567'),/invalid/);
  assert.throws(()=>verifyMessagingPermissionDebug({
    app_id:'1234567',is_valid:true,expires_at:Math.round(Date.now()/1000)-60,scopes:['whatsapp_business_messaging']
  },'1234567'),/expired/);
  assert.equal(verifyMessagingPermissionDebug({
    app_id:'1234567',is_valid:true,granular_scopes:[{scope:'whatsapp_business_messaging'}]
  },'1234567').messagingPermission,true);
});
