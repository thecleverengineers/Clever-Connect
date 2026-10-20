// Linking an existing Cloud API number is not a new registration or a
// cross-provider migration. Only credentials authorized by the WABA owner
// can attach an existing sender to Clever Connect.
function expectMetaId(value,label){
  const id=String(value||'').trim();
  if(!/^\d{5,30}$/.test(id))throw new Error(label+' must be a numeric Meta ID, not the WhatsApp phone number');
  return id;
}

export async function verifyExistingCloudApiNumber({
  phoneNumberId,businessAccountId,accessToken,graphVersion='v23.0',request=globalThis.fetch
}){
  const phoneId=expectMetaId(phoneNumberId,'Phone Number ID');
  const wabaId=expectMetaId(businessAccountId,'WhatsApp Business Account ID');
  const token=String(accessToken||'').trim();
  if(!token)throw new Error('A system-user access token authorized for this WABA is required');
  if(!/^v\d+\.\d+$/.test(graphVersion))throw new Error('Invalid Graph API version');
  const get=async(path)=>{
    const response=await request('https://graph.facebook.com/'+graphVersion+'/'+path,{
      headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(15000)
    });
    const json=await response.json().catch(()=>({}));
    if(!response.ok){
      const code=json.error?.code?(' ('+json.error.code+')'):'';
      throw new Error('Meta could not authorize this account'+code+': '+String(json.error?.message||'Check the token and WhatsApp permissions').slice(0,220));
    }
    return json;
  };

  // Check API access to the actual number.
  const phone=await get(phoneId+'?fields=id,display_phone_number,verified_name');
  if(String(phone.id)!==phoneId)throw new Error('Meta returned a different Phone Number ID');
  // Verify the phone really belongs to the WABA specified by the owner.
  // This also rejects accidentally using a token for a different business.
  let after='',matched=false;
  for(let page=0;page<20;page++){
    const query=wabaId+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100'+
      (after?'&after='+encodeURIComponent(after):'');
    const data=await get(query);
    if((data.data||[]).some(entry=>String(entry.id)===phoneId)){matched=true;break;}
    const next=data.paging?.cursors?.after;
    if(!next||next===after)break;
    after=next;
  }
  if(!matched)throw new Error('This phone number is not visible under the selected WABA. Check its original provider and Meta asset permissions.');
  return {
    phoneNumberId:phoneId,businessAccountId:wabaId,
    displayPhoneNumber:String(phone.display_phone_number||''),
    verifiedName:String(phone.verified_name||'')
  };
}
