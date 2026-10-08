import { Integration } from '../models.js';
import { decrypt } from '../utils/crypto.js';

const normalizePhone=(phone='')=>String(phone).replace(/[^0-9]/g,'');

export async function sendWhatsApp({workspaceId,phone,text,template}){
  const integration=await Integration.findOne({workspaceId}).lean();

  if(!integration||!integration.enabled||integration.provider==='demo'){
    return {
      provider:'demo',
      id:'demo-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),
      status:'delivered'
    };
  }

  const to=normalizePhone(phone);
  if(to.length<8||to.length>15) throw new Error('Recipient phone number is invalid');
  if(!integration.phoneNumberId||!integration.accessTokenEncrypted) throw new Error('Meta WhatsApp integration is incomplete');

  const token=decrypt(integration.accessTokenEncrypted);
  const body=template?.metaTemplateName
    ? {
        messaging_product:'whatsapp',
        to,
        type:'template',
        template:{name:template.metaTemplateName,language:{code:template.language||'en_US'}}
      }
    : {
        messaging_product:'whatsapp',
        recipient_type:'individual',
        to,
        type:'text',
        text:{preview_url:false,body:String(text||'').trim()}
      };

  if(body.type==='text'&&!body.text.body) throw new Error('Message text is required');

  const version=integration.graphVersion||'v23.0';
  let response;
  try{
    response=await fetch('https://graph.facebook.com/'+version+'/'+integration.phoneNumberId+'/messages',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)
    });
  }catch(e){
    if(e.name==='TimeoutError') throw new Error('WhatsApp Cloud API timed out');
    throw e;
  }

  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message||'WhatsApp Cloud API rejected the message');
  const id=data.messages?.[0]?.id;
  if(!id) throw new Error('WhatsApp Cloud API did not return a message ID');
  return {provider:'meta',id,status:'submitted'};
}
