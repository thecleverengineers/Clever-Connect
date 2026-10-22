import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectMetaBusinessToken,inspectMetaTokenWithGraph,
  metaNumberRegistrationAction,onboardingResultMessage
} from '../src/services/metaConnectHealth.js';

test('one-click Meta signup requires an authentic BISU token from this Meta app',()=>{
  const token={
    is_valid:true,app_id:'12345678901',expires_at:0,
    scopes:['whatsapp_business_management','whatsapp_business_messaging']
  };
  assert.equal(inspectMetaBusinessToken(token,'12345678901').authorized,true);
  assert.throws(()=>inspectMetaBusinessToken({...token,app_id:'11111111111'},'12345678901'),/another Meta developer app/);
  assert.throws(()=>inspectMetaBusinessToken({...token,is_valid:false},'12345678901'),/rejected/);
  assert.throws(()=>inspectMetaBusinessToken({...token,expires_at:1},'12345678901'),/expired/);
});
test('one-click Meta onboarding verifies both messaging and management scopes',()=>{
  const common={is_valid:true,app_id:'12345678901'};
  assert.throws(()=>inspectMetaBusinessToken({
    ...common,scopes:['whatsapp_business_management']
  },'12345678901'),/whatsapp_business_messaging/);
  assert.throws(()=>inspectMetaBusinessToken({
    ...common,scopes:['whatsapp_business_messaging']
  },'12345678901'),/whatsapp_business_management/);
  assert.equal(inspectMetaBusinessToken({...common,granular_scopes:[
    {scope:'whatsapp_business_management'},
    {scope:'whatsapp_business_messaging',target_ids:['55555555555']}
  ]},'12345678901').authorized,true);
});
test('Meta Graph introspection checks tokens server-side and never returns token strings',async()=>{
  const secret='APP-SECRET-DONT-EXPOSE';
  const access='BISU-TOKEN-DONT-EXPOSE';
  const request=async (url,options)=>{
    assert.match(url,/^https:\/\/graph\.facebook\.com\/v23\.0\/debug_token\?/);
    assert.ok(url.includes(encodeURIComponent(access)));
    assert.equal(options.headers.Authorization,'Bearer 12345678901|'+secret);
    return {ok:true,json:async()=>({data:{
      is_valid:true,app_id:'12345678901',
      scopes:['whatsapp_business_management','whatsapp_business_messaging']
    }})};
  };
  const result=await inspectMetaTokenWithGraph({
    token:access,appId:'12345678901',appSecret:secret,request
  });
  assert.equal(result.authorized,true);
  assert.ok(!JSON.stringify(result).includes(access));
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('existing Cloud API and coexistence links never register or deregister Meta phone',()=>{
  assert.equal(metaNumberRegistrationAction('existing','CONNECTED'),'preserve');
  assert.equal(metaNumberRegistrationAction('existing','PENDING'),'preserve');
  assert.equal(metaNumberRegistrationAction('coexistence',''),'preserve');
  assert.equal(metaNumberRegistrationAction('new','CONNECTED'),'preserve');
  assert.equal(metaNumberRegistrationAction('new','PENDING'),'register');
  assert.equal(metaNumberRegistrationAction('new',''),'register');
  assert.throws(()=>metaNumberRegistrationAction('dangerous','PENDING'),/Unsupported/);
});
test('activation response truthfully distinguishes partial success and attention',()=>{
  assert.match(onboardingResultMessage({selected:3,activated:2,attention:1}),/2 connected/);
  assert.match(onboardingResultMessage({selected:2,activated:0,attention:2}),/No existing connections were disconnected/);
});
