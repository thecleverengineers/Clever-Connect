import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverMetaPortfolios} from '../src/services/metaPortfolioDiscovery.js';

const fixtures={
  'debug_token':{data:{is_valid:true,app_id:'12345678',scopes:['business_management','whatsapp_business_management']}},
  'me':{id:'76543210',name:'Meta Account Owner'},
  'me/businesses':{data:[{id:'100001',name:'Example Group'},{id:'100002',name:'Another Business'}]},
  '100001/owned_whatsapp_business_accounts':{data:[{id:'200001',name:'Sales WABA'}]},
  '100001/client_whatsapp_business_accounts':{data:[{id:'200002',name:'Shared Support'}]},
  '200001/phone_numbers':{data:[{id:'300001',display_phone_number:'+919876543210',verified_name:'Sales'}]},
  '200002/phone_numbers':{data:[]},
  '100002/owned_whatsapp_business_accounts':{data:[]},
  '100002/client_whatsapp_business_accounts':{data:[]}
};
function setup(values=fixtures){
  const queried=[];
  const request=async (url,options)=>{
    const full=new URL(url);
    assert.equal(full.origin,'https://graph.facebook.com');
    assert.ok(options.headers.Authorization.startsWith('Bearer '));
    const path=full.pathname.replace('/v23.0/','');
    queried.push(path);
    const found=values[path];
    if(!found)return {ok:false,json:async()=>({error:{message:'Not permitted',code:10}})};
    return {ok:true,json:async()=>found};
  };
  return {request,queried};
}
test('discovers portfolios and WABA numbers for exactly the authorized Facebook identity',async()=>{
  const {request,queried}=setup();
  const result=await discoverMetaPortfolios({accessToken:'user-token',appId:'12345678',appSecret:'secret',request});
  assert.deepEqual(result.metaAccount,{id:'76543210',name:'Meta Account Owner'});
  assert.equal(result.portfolios.length,2);
  assert.equal(result.portfolios[0].wabas.length,2);
  assert.equal(result.portfolios[0].wabas[0].numbers[0].displayPhoneNumber,'+919876543210');
  assert.equal(result.portfolios[0].wabas[0].numbers[0].id,'300001');
  assert.deepEqual(result.portfolios[1].wabas,[]);
  assert.ok(!JSON.stringify(result).includes('user-token'));
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(queried.includes('me/businesses'));
});
test('never lists assets from another app session',async()=>{
  const {request}=setup({...fixtures,debug_token:{data:{is_valid:true,app_id:'12345679',scopes:['business_management']}}});
  await assert.rejects(discoverMetaPortfolios({accessToken:'user-token',appId:'12345678',appSecret:'secret',request}),/another Meta app/);
});
test('refuses token without business-management permission',async()=>{
  const {request}=setup({...fixtures,debug_token:{data:{is_valid:true,app_id:'12345678',scopes:['public_profile']}}});
  await assert.rejects(discoverMetaPortfolios({accessToken:'user-token',appId:'12345678',appSecret:'secret',request}),/business_management/);
});
test('partial WABA permissions do not erase visible portfolios',async()=>{
  const {request}=setup({...fixtures,'100001/owned_whatsapp_business_accounts':undefined});
  const result=await discoverMetaPortfolios({accessToken:'user-token',appId:'12345678',appSecret:'secret',request});
  assert.equal(result.portfolios.length,2);
  assert.ok(result.warnings.length);
});
