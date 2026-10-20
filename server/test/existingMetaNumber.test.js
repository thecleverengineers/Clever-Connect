import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingCloudApiNumber} from '../src/services/existingMetaNumber.js';

const fakeRequests=(pages)=>async(url,opts)=>{
  assert.match(url,/^https:\/\/graph\.facebook\.com\/v23\.0\//);
  assert.equal(opts.headers.Authorization,'Bearer authorized-token');
  assert.equal(opts.method,undefined);
  const body=url.includes('/phone_numbers?')?pages.shift():{id:'1234567890',display_phone_number:'+919000000000',verified_name:'Existing Business'};
  return {ok:true,json:async()=>body};
};

test('existing Cloud API number links only if the token can read its WABA membership',async()=>{
  const result=await verifyExistingCloudApiNumber({
    phoneNumberId:'1234567890',businessAccountId:'9988776655',
    accessToken:'authorized-token',request:fakeRequests([{data:[{id:'1234567890'}]}])
  });
  assert.equal(result.phoneNumberId,'1234567890');
  assert.equal(result.businessAccountId,'9988776655');
  assert.equal(result.displayPhoneNumber,'+919000000000');
});
test('rejects a WABA token that cannot access the requested number',async()=>{
  await assert.rejects(verifyExistingCloudApiNumber({
    phoneNumberId:'1234567890',businessAccountId:'9988776655',
    accessToken:'authorized-token',request:fakeRequests([{data:[{id:'1111111111'}]}])
  }),/not visible/);
});
test('never allows using a formatted phone number in place of Meta numeric IDs',async()=>{
  await assert.rejects(verifyExistingCloudApiNumber({phoneNumberId:'+919000000000',businessAccountId:'9988776655',accessToken:'token'}),/numeric/);
});
test('rejects Graph permission failures and does not register a number',async()=>{
  const paths=[];
  const request=async(url)=>{paths.push(url);return {ok:false,json:async()=>({error:{code:10,message:'Missing permission'}})}};
  await assert.rejects(verifyExistingCloudApiNumber({phoneNumberId:'1234567890',businessAccountId:'9988776655',accessToken:'authorized-token',request}),/Meta could not authorize/);
  assert.equal(paths.length,1);
  assert.equal(paths.some(p=>p.includes('/register')),false);
});
