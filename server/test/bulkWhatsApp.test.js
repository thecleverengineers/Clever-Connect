import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPhone,splitManualNumbers,parsePhoneCsv,matchConsentedNumbers} from '../../client/src/bulkRecipients.js';
import {entitledMetaIds} from '../src/plan.js';

test('manual numbers normalize and deduplicate without granting consent',()=>{
  assert.equal(canonicalPhone('+91 98765 43210'),'919876543210');
  assert.equal(canonicalPhone('abc 919876543210'),'');
  assert.equal(canonicalPhone('1234'),'');
  assert.deepEqual(splitManualNumbers('+919876543210\n+919876543211,+919876543212'),['+919876543210','+919876543211','+919876543212']);
  const contacts=[
    {_id:'a',phone:'+919876543210',consentStatus:'opted_in',suppressed:false},
    {_id:'b',phone:'+919876543211',consentStatus:'opted_out',suppressed:true}
  ];
  const result=matchConsentedNumbers(['+919876543210','919876543210','+919876543211','+919876543212','invalid'],contacts);
  assert.deepEqual(result.accepted.map(c=>c._id),['a']);
  assert.equal(result.duplicate,1);
  assert.equal(result.rejected.length,3);
});

test('CSV parser accepts quoted phone column and rejects malformed data',()=>{
  assert.deepEqual(parsePhoneCsv('Name,Mobile Number,Email\n"Customer, First",+919876543210,a@example.com\nSecond,+919876543211,b@example.com'),
    ['+919876543210','+919876543211']);
  assert.deepEqual(parsePhoneCsv('+919876543210\n+919876543211'),['+919876543210','+919876543211']);
  assert.throws(()=>parsePhoneCsv('name,email\nFirst,test@example.com'),/phone/);
  assert.throws(()=>parsePhoneCsv('"unfinished'),/quotation/);
  assert.throws(()=>parsePhoneCsv('phone\n'+Array(5001).fill('+919876543210').join('\n')),/5,000/);
});

test('subscription entitlement reserves oldest profiles after downgrade',()=>{
  const profiles=[
    {_id:'b',createdAt:'2026-10-20T11:00:00Z'},
    {_id:'c',createdAt:'2026-10-20T12:00:00Z'},
    {_id:'a',createdAt:'2026-10-19T11:00:00Z'}
  ];
  assert.deepEqual(entitledMetaIds(profiles,2),['a','b']);
  assert.deepEqual(entitledMetaIds(profiles,0),[]);
  assert.deepEqual(entitledMetaIds(profiles,5),['a','b','c']);
});
