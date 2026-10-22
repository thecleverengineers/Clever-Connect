// The Facebook JavaScript SDK can reuse an already authenticated app session
// for read-only Meta portfolio discovery. A fresh interactive permission
// request is only appropriate when the customer explicitly requests it.
export function existingFacebookAccessToken(response){
  const token=response?.status==='connected'?response?.authResponse?.accessToken:'';
  return typeof token==='string'&&token.length>0?token:'';
}
export function shouldReuseFacebookSession(token,{forceLogin=false,regrant=false}={}){
  return !!token&&!forceLogin&&!regrant;
}
export function facebookDiscoveryLoginOptions({regrant=false}={}){
  return {
    scope:'public_profile,business_management,whatsapp_business_management',
    return_scopes:true,
    ...(regrant?{auth_type:'rerequest'}:{})
  };
}
