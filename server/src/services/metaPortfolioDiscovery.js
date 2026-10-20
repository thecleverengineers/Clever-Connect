// Meta portfolio discovery, scoped to the Meta identity that explicitly
// authorized Clever Connect via Facebook Login. Never persist user tokens.
//
// Phone numbers returned by WABA /phone_numbers are API-managed numbers.
// WhatsApp Business App-only numbers may be absent until Meta Coexistence
// onboarding, and cannot be force-enumerated through this endpoint.
const META_ID=/^[0-9]{5,30}$/;
export function normalizedMetaAsset(data){
  if(!META_ID.test(String(data?.id||'')))return null;
  return {id:String(data.id),name:String(data.name||'Unnamed').slice(0,120)};
}

export async function discoverMetaPortfolios({accessToken,appId,appSecret,graphVersion='v23.0',request=globalThis.fetch}){
  const token=String(accessToken||'').trim();
  if(!token||token.length>3500)throw new Error('Sign in with Facebook before discovering portfolios');
  if(!/^\d{5,30}$/.test(String(appId||''))||!appSecret)throw new Error('Meta App configuration is incomplete');
  if(!/^v\d+\.\d+$/.test(graphVersion))throw new Error('Invalid Graph API version');
  const endpoint='https://graph.facebook.com/'+graphVersion+'/';
  async function call(path,bearer){
    const response=await request(endpoint+path,{
      headers:{Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(12000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      const code=data.error?.code?' ('+data.error.code+')':'';
      throw new Error('Meta declined portfolio access'+code+': '+String(data.error?.message||'Check Meta permissions').slice(0,180));
    }
    return data;
  }
  const tokenInfo=await call('debug_token?input_token='+encodeURIComponent(token),String(appId)+'|'+String(appSecret));
  if(!tokenInfo.data?.is_valid||String(tokenInfo.data.app_id)!==String(appId)){
    throw new Error('Facebook login belongs to another Meta app or the session has expired');
  }
  const scopes=new Set(tokenInfo.data.scopes||[]);
  if(!scopes.has('business_management')){
    throw new Error('Meta did not grant business_management. Approve portfolio access in Facebook Login or enable the permission in Meta App Review.');
  }
  const identity=await call('me?fields=id,name',token);
  const businessPages=[];
  let cursor='';
  for(let page=0;page<5;page++){
    const result=await call('me/businesses?fields=id,name&limit=100'+(cursor?'&after='+encodeURIComponent(cursor):''),token);
    businessPages.push(...(Array.isArray(result.data)?result.data:[]));
    const next=result.paging?.cursors?.after;
    if(!next||next===cursor||businessPages.length>=250)break;
    cursor=next;
  }
  const businesses=businessPages.slice(0,250).map(normalizedMetaAsset).filter(Boolean);
  const out=[];let inaccessible=0;
  for(const b of businesses){
    const whatsapps=new Map();
    for(const edge of ['owned_whatsapp_business_accounts','client_whatsapp_business_accounts']){
      let wabaCursor='';
      for(let page=0;page<3;page++){
        try{
          const result=await call(b.id+'/'+edge+'?fields=id,name&limit=100'+(wabaCursor?'&after='+encodeURIComponent(wabaCursor):''),token);
          for(const w of result.data||[]){
            const normalized=normalizedMetaAsset(w);
            if(normalized)whatsapps.set(normalized.id,{...normalized,source:edge==='owned_whatsapp_business_accounts'?'owned':'shared',numbers:[]});
          }
          const next=result.paging?.cursors?.after;
          if(!next||next===wabaCursor)break;
          wabaCursor=next;
        }catch(e){inaccessible++;break;}
      }
    }
    for(const w of whatsapps.values()){
      if(!scopes.has('whatsapp_business_management'))continue;
      let phoneCursor='';
      for(let page=0;page<3;page++){
        try{
          const result=await call(w.id+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100'+(phoneCursor?'&after='+encodeURIComponent(phoneCursor):''),token);
          for(const n of result.data||[]){
            if(!META_ID.test(String(n.id||'')))continue;
            w.numbers.push({
              id:String(n.id),
              displayPhoneNumber:String(n.display_phone_number||'').slice(0,40),
              verifiedName:String(n.verified_name||'').slice(0,120)
            });
          }
          const next=result.paging?.cursors?.after;
          if(!next||next===phoneCursor)break;
          phoneCursor=next;
        }catch(e){inaccessible++;break;}
      }
    }
    out.push({...b,wabas:[...whatsapps.values()]});
  }
  return {
    metaAccount:{id:String(identity.id||''),name:String(identity.name||'Facebook account').slice(0,120)},
    portfolios:out,
    warnings:[
      ...(inaccessible?['Some portfolios, WABAs or phone numbers could not be read due to Meta asset permissions.']:[]),
      ...(!scopes.has('whatsapp_business_management')?['WhatsApp Business management permission was not granted. API phone numbers may not be visible.']:[])
    ],
    note:'This list includes portfolios and API-managed WABA phone numbers visible to this Meta login. Business App-only numbers are selected and checked for eligibility inside Meta Coexistence signup; they may not appear here.'
  };
}
