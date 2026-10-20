import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_PAGE_IDS,pageFromHash,allowedWorkspacePage,
  resolveWorkspacePage,workspacePageHash
} from '../../client/src/workspaceRouting.js';

test('every workspace section has a stable, refresh-safe route',()=>{
  for(const id of WORKSPACE_PAGE_IDS){
    assert.equal(pageFromHash(workspacePageHash(id)),id);
    assert.equal(resolveWorkspacePage(workspacePageHash(id),{allowed:true,isSuperAdmin:true}),id);
  }
  assert.equal(pageFromHash('#/campaigns'),'campaigns');
  assert.equal(pageFromHash('#/whatsapp-api'),'whatsapp-api');
  assert.equal(pageFromHash('#/chatbot'),'chatbot');
  assert.equal(pageFromHash('#/templates'),'templates');
});
test('malformed routes and unknown pages return a safe default',()=>{
  for(const hash of ['#/not-real','#/admin/secret','#/../../admin','#/','',null]){
    assert.equal(pageFromHash(hash),null);
    assert.equal(resolveWorkspacePage(hash,{allowed:true,isSuperAdmin:false}),'overview');
  }
  assert.equal(workspacePageHash('not-real'),'#/overview');
});
test('subscription locks and super-admin authorization survive refresh',()=>{
  const locked={allowed:false,isSuperAdmin:false};
  assert.equal(allowedWorkspacePage('campaigns',locked),'subscription');
  assert.equal(resolveWorkspacePage('#/whatsapp-api',locked),'subscription');
  assert.equal(resolveWorkspacePage('#/subscription',locked),'subscription');
  assert.equal(resolveWorkspacePage('#/profile',locked),'profile');
  assert.equal(resolveWorkspacePage('#/admin',{allowed:true,isSuperAdmin:false}),'overview');
  assert.equal(resolveWorkspacePage('#/admin',{allowed:true,isSuperAdmin:true}),'admin');
});
test('hash routing normalizes known routes without navigating to injected URLs',()=>{
  assert.equal(pageFromHash('#/CAMPAIGNS'),'campaigns');
  assert.equal(pageFromHash('#/campaigns/'),'campaigns');
  assert.equal(pageFromHash('#/https://external.test'),null);
  assert.equal(pageFromHash('#/campaigns?x=y'),null);
});
