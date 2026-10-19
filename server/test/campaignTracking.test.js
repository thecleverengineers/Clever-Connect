import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckRecipient,summarizeStatuses,normalizedAudiencePhone} from '../src/services/campaignTracking.js';

test('prechecks classify invalid, suppressed, no-consent and duplicate contacts',()=>{
  const seen=new Set();
  assert.deepEqual(precheckRecipient({phone:'+91 98765 43210',consentStatus:'opted_in'},seen),null);
  assert.equal(precheckRecipient({phone:'919876543210',consentStatus:'opted_in'},seen)?.code,'DUPLICATE');
  assert.equal(precheckRecipient({phone:'invalid',consentStatus:'opted_in'},seen)?.code,'INVALID_PHONE');
  assert.equal(precheckRecipient({phone:'919876543211',suppressed:true,consentStatus:'opted_in'},seen)?.code,'SUPPRESSED');
  assert.equal(precheckRecipient({phone:'919876543212',consentStatus:'opted_out'},seen)?.code,'OPTED_OUT');
  assert.equal(precheckRecipient({phone:'919876543213',consentStatus:'pending'},seen)?.code,'NO_CONSENT');
  assert.equal(normalizedAudiencePhone('+91 98765 43210'),'919876543210');
});

test('funnel reconciles audience exactly once without double-counting read',()=>{
  const a=summarizeStatuses({skipped:10,failed:8,queued:5,submitted:7,sent:10,delivered:20,read:40});
  assert.equal(a.audience,100);
  assert.equal(a.delivered,60);
  assert.equal(a.pending,22);
  assert.equal(a.read,40);
  assert.equal(a.eligible,90);
  assert.equal(a.submitted,77);
  assert.equal(a.deliveredPct,66.7);
  assert.equal(a.failedPct,8.9);
  assert.equal(a.readPct,66.7);
  assert.equal(a.skipped+a.delivered+a.failed+a.pending,a.audience);
});

test('empty campaign produces finite zero percent rates',()=>{
  const a=summarizeStatuses({});
  assert.equal(a.audience,0);
  assert.equal(a.deliveredPct,0);
  assert.equal(a.failedPct,0);
  assert.equal(a.readPct,0);
});
