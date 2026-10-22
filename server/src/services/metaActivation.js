// Compact, independently testable validation for staged Meta number activation.
const META_ID=/^[0-9]{5,30}$/;
export function cleanMetaId(id,label='Meta ID'){
  const value=String(id||'').trim();
  if(!META_ID.test(value))throw new Error(label+' must be a valid numeric Meta asset ID');
  return value;
}
export function validMetaPhoneList(rows){
  const seen=new Set();
  return (Array.isArray(rows)?rows:[]).filter(row=>{
    const id=String(row?.id||'');
    if(!META_ID.test(id)||seen.has(id))return false;
    seen.add(id);return true;
  }).slice(0,250).map(row=>({
    id:String(row.id),
    displayPhoneNumber:String(row.display_phone_number||row.displayPhoneNumber||'').slice(0,40),
    verifiedName:String(row.verified_name||row.verifiedName||'').slice(0,120)
  }));
}
export function validateActivationSelection(ids,authorized,maxConnections){
  if(!Array.isArray(ids)||ids.length<1)throw new Error('Select at least one WhatsApp number to activate');
  if(ids.length>maxConnections)throw new Error('Selected WhatsApp numbers exceed your subscription allowance');
  const selected=ids.map(id=>cleanMetaId(id,'Phone Number ID'));
  if(new Set(selected).size!==selected.length)throw new Error('The same WhatsApp number was selected more than once');
  const allowed=new Set(authorized.map(phone=>String(phone.id)));
  if(selected.some(id=>!allowed.has(id)))throw new Error('Selected phone number was not authorized in this Meta session');
  return selected;
}
// Bind Meta's second (credential-issuing) login to the exact WABA/number
// that the customer selected in the first, read-only portfolio browser.
// Backend Graph checks must still independently confirm membership.
// Sharing an existing Cloud API number with another authorized partner
// must NEVER trigger a new /register request or external deregistration.
export const shouldRegisterDuringActivation=mode=>mode==='new';

export function assertSignupMatchesSelection({
  expectedWabaId='',authorizedWabaId='',expectedPhoneNumberId='',returnedPhoneNumberId=''
}={}){
  if(expectedWabaId&&cleanMetaId(expectedWabaId,'Selected WABA')!==cleanMetaId(authorizedWabaId,'Authorized WABA')){
    throw new Error('Meta authorized a different WhatsApp Business Account. No number has been connected.');
  }
  if(expectedPhoneNumberId){
    cleanMetaId(expectedPhoneNumberId,'Selected Phone Number ID');
    if(returnedPhoneNumberId&&cleanMetaId(returnedPhoneNumberId,'Meta Phone Number ID')!==expectedPhoneNumberId){
      throw new Error('Meta returned a different phone number from the one selected. No number has been connected.');
    }
  }
  return true;
}

export function activationSessionExpired(row,at=Date.now()){
  return !row||!row.expiresAt||new Date(row.expiresAt).getTime()<=at;
}
