import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existingFacebookAccessToken,
  shouldReuseFacebookSession,
  facebookDiscoveryLoginOptions
} from '../../client/src/facebookDiscoverySession.js';

test('an already authenticated Meta session can browse portfolios without another login dialog',()=>{
  assert.equal(existingFacebookAccessToken({status:'connected',authResponse:{accessToken:'temporary-valid-user-token'}}),'temporary-valid-user-token');
  assert.equal(shouldReuseFacebookSession('temporary-valid-user-token'),true);
  assert.equal(shouldReuseFacebookSession('temporary-valid-user-token',{forceLogin:true}),false);
  assert.equal(shouldReuseFacebookSession('temporary-valid-user-token',{regrant:true}),false);
});

test('a missing/unauthorized session does not bypass Facebook authentication',()=>{
  assert.equal(existingFacebookAccessToken({status:'not_authorized',authResponse:{accessToken:'untrusted'}}),'');
  assert.equal(existingFacebookAccessToken({status:'unknown'}),'');
  assert.equal(existingFacebookAccessToken(null),'');
  assert.equal(shouldReuseFacebookSession(''),false);
});

test('ordinary discovery does not re-request permissions on every click',()=>{
  const normal=facebookDiscoveryLoginOptions();
  assert.equal(normal.auth_type,undefined);
  assert.match(normal.scope,/business_management/);
  assert.match(normal.scope,/whatsapp_business_management/);
  assert.equal(normal.return_scopes,true);

  // The user explicitly opts in to regrant a permission previously declined.
  const retry=facebookDiscoveryLoginOptions({regrant:true});
  assert.equal(retry.auth_type,'rerequest');
});
