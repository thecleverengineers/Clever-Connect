// Read-only diagnostics. A valid /{phone_id} GET only proves asset access;
// it does not establish the whatsapp_business_messaging permission required
// to send. Do not expose or persist raw access tokens in diagnostics.
export function verifyMessagingPermissionDebug(info,appId){
  if(!info||String(info.app_id||'')!==String(appId||''))return {checked:false,reason:'different_app'};
  if(info.is_valid!==true)throw new Error('The Meta access token is expired or invalid. Generate a new authorized system-user token.');
  if(Number(info.expires_at)>0&&Number(info.expires_at)*1000<=Date.now())
    throw new Error('The Meta access token has expired. Generate a new authorized system-user token.');
  const scopeNames=[
    ...(Array.isArray(info.scopes)?info.scopes:[]),
    ...(Array.isArray(info.granular_scopes)?info.granular_scopes.map(x=>x.scope):[])
  ];
  if(scopeNames.length&&!scopeNames.includes('whatsapp_business_messaging'))
    throw new Error('Meta token lacks whatsapp_business_messaging permission. Grant it on the selected WABA and issue a new access token.');
  return {checked:true,valid:true,messagingPermission:scopeNames.includes('whatsapp_business_messaging')};
}
