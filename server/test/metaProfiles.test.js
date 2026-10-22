import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeMetaProfiles} from '../src/services/metaProfiles.js';

test('Multiple profiles in one Meta WABA count as distinct senders but one business account',()=>{
  const summary=summarizeMetaProfiles([
    {id:'x1',provider:'meta',businessPortfolioId:'portA',businessAccountId:'wabaA',
      enabled:true,connectionStatus:'connected',planAllowed:true},
    {id:'x2',provider:'meta',businessPortfolioId:'portA',businessAccountId:'wabaA',
      enabled:true,connectionStatus:'connected',planAllowed:true},
    {id:'demo',provider:'demo',enabled:true}
  ]);
  assert.equal(summary.total,2);
  assert.equal(summary.businessAccounts,1);
  assert.equal(summary.businessPortfolios,1);
  assert.equal(summary.ready,2);
  assert.deepEqual(summary.groups[0].profileIds,['x1','x2']);
});
test('Profiles from separate Meta WABAs and portfolios do not overwrite or coalesce',()=>{
  const summary=summarizeMetaProfiles([
    {id:'x1',provider:'meta',businessPortfolioId:'portA',businessAccountId:'wabaA',
      enabled:true,connectionStatus:'connected',planAllowed:true},
    {id:'x2',provider:'meta',businessPortfolioId:'portB',businessAccountId:'wabaB',
      enabled:true,connectionStatus:'error',planAllowed:true},
    {id:'x3',provider:'meta',businessPortfolioId:'portB',businessAccountId:'wabaC',
      enabled:false,connectionStatus:'disabled',planAllowed:false}
  ]);
  assert.equal(summary.total,3);
  assert.equal(summary.businessAccounts,3);
  assert.equal(summary.businessPortfolios,2);
  assert.equal(summary.ready,1);
  assert.equal(summary.needsAttention,2);
  assert.equal(summary.planRestricted,1);
  assert.deepEqual(summary.groups.map(x=>x.businessAccountId),['wabaA','wabaB','wabaC']);
});
test('Legacy connections without WABA IDs remain individual and never join another WABA',()=>{
  const summary=summarizeMetaProfiles([
    {id:'a',provider:'meta',connectionStatus:'connected',enabled:true},
    {id:'b',provider:'meta',connectionStatus:'connected',enabled:true}
  ]);
  assert.equal(summary.businessAccounts,2);
  assert.equal(summary.groups.length,2);
});
