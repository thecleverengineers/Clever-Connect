import crypto from 'node:crypto';
import {Integration} from './models.js';
import {decrypt} from './utils/crypto.js';

export const normalizePhone=(v='')=>{
  const digits=String(v).replace(/\D/g,'');
  return digits.length>=8&&digits.length<=15?('+'+digits):'';
};
export const hashOtp=(otp)=>crypto.createHash('sha256').update(String(otp)).digest('hex');
export const createOtp=()=>String(crypto.randomInt(100000,1000000));

export async function sendMetaOtp({workspaceId,integrationId,phone,otp}){
  const integration=await Integration.findOne({
    _id:integrationId,
    workspaceId,
    provider:'meta',
    enabled:true
  }).lean();
  if(!integration) throw new Error('Selected Meta WhatsApp connection is unavailable');
  if(!integration.phoneNumberId||!integration.accessTokenEncrypted) throw new Error('Meta WhatsApp connection is incomplete');
  if(!integration.otpTemplateName) throw new Error('Configure an approved Meta authentication template for OTP first');

  const to=normalizePhone(phone).replace('+','');
  if(!to) throw new Error('Enter a valid WhatsApp phone number');

  const token=decrypt(integration.accessTokenEncrypted);
  const version=integration.graphVersion||'v23.0';
  const body={
    messaging_product:'whatsapp',
    to,
    type:'template',
    template:{
      name:integration.otpTemplateName,
      language:{code:integration.otpTemplateLanguage||'en_US'},
      components:[
        {type:'body',parameters:[{type:'text',text:String(otp)}]},
        {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:String(otp)}]}
      ]
    }
  };
  const response=await fetch('https://graph.facebook.com/'+version+'/'+integration.phoneNumberId+'/messages',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message||'Unable to send WhatsApp OTP');
  return {id:data.messages?.[0]?.id||'',provider:'meta'};
}
