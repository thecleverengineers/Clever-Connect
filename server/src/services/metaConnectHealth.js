// One-click WhatsApp Embedded Signup health and registration checks.
// These probes are read-only. They cannot register, migrate, delete,
// re-route conversations or reveal the BISU access token to the browser.
export const requiredMetaScopes=Object.freeze([
  'whatsapp_business_management','whatsapp_business_messaging'
]);

export function inspectMetaBusinessToken(info,expectedAppId,now=Date.now()){
  if(!info||info.is_valid!==true)
    throw new Error('Meta rejected the business integration token. Please authorize the account again.');
  if(String(info.app_id||'')!==String(expectedAppId||''))
    throw new Error('The token belongs to another Meta developer app. Choose the configured Clever Connect app.');
  if(Number(info.expires_at)>0&&Number(info.expires_at)*1000<=now)
    throw new Error('The Meta token has expired. Reauthorize your WhatsApp account.');
  const scopes=new Set([
    ...(Array.isArray(info.scopes)?info.scopes:[]),
    ...(Array.isArray(info.granular_scopes)?info.granular_scopes.map(x=>x.scope):[])
  ]);
  const missing=requiredMetaScopes.filter(s=>!scopes.has(s));
  if(missing.length)
    throw new Error('Meta has not granted required permissions: '+missing.join(', ')+
      '. Approve both WhatsApp management and messaging during authorization.');
  return {authorized:true,scopes:requiredMetaScopes,appId:String(info.app_id)};
}

export function metaNumberRegistrationAction(mode,remoteStatus){
  // Prior providers and Business App coexistence are never registered here;
  // re-registering could break an existing, independently managed sender.
  if(mode==='existing'||mode==='coexistence')return 'preserve';
  if(mode!=='new')throw new Error('Unsupported Meta onboarding mode');
  if(String(remoteStatus||'').toUpperCase()==='CONNECTED')return 'preserve';
  return 'register';
}

export function onboardingResultMessage({selected=0,activated=0,attention=0}={}){
  if(!selected)return 'No WhatsApp numbers were selected.';
  if(activated&&attention)return activated+' connected; '+attention+' need attention in WhatsApp Manager.';
  if(activated)return activated+' WhatsApp number(s) connected and saved.';
  return 'Your selected numbers could not be fully activated. No existing connections were disconnected.';
}

export async function inspectMetaTokenWithGraph({
  token,appId,appSecret,graphVersion='v23.0',
  request=globalThis.fetch
}){
  if(!token||!appId||!appSecret)throw new Error('Meta OAuth configuration is incomplete');
  if(!/^v\d+\.\d+$/.test(graphVersion))throw new Error('Invalid Meta Graph API version');
  // The token stays server-side. No introspection data or token is returned
  // to the customer beyond the names of authorized permissions.
  const query=new URLSearchParams({input_token:String(token)});
  const response=await request('https://graph.facebook.com/'+graphVersion+'/debug_token?'+query,{
    headers:{Authorization:'Bearer '+appId+'|'+appSecret},
    signal:AbortSignal.timeout(12000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Meta could not validate this WhatsApp authorization: '+
    String(data?.error?.message||'Check app permissions').slice(0,180));
  return inspectMetaBusinessToken(data.data,appId);
}
