import { Integration } from '../models.js';
import { decrypt } from '../utils/crypto.js';

const normalizePhone = (phone='') => phone.replace(/[^0-9]/g,'');
export async function sendWhatsApp({workspaceId, phone, text, template}){
  const integration = await Integration.findOne({workspaceId}).lean();
  if(!integration || !integration.enabled || integration.provider === 'demo'){
    return { provider:'demo', id:`demo-${Date.now()}-${Math.random().toString(36).slice(2,9)}`, status:'delivered' };
  }
  if(!integration.phoneNumberId || !integration.accessTokenEncrypted) throw new Error('Meta WhatsApp integration is incomplete');
  const token=decrypt(integration.accessTokenEncrypted);
  const body = template?.metaTemplateName ? {
    messaging_product:'whatsapp', to:normalizePhone(phone), type:'template',
    template:{ name:template.metaTemplateName, language:{code:template.language || 'en_US'} }
  } : { messaging_product:'whatsapp', recipient_type:'individual', to:normalizePhone(phone), type:'text', text:{preview_url:false, body:text} };
  const response=await fetch(`https://graph.facebook.com/v23.0/${integration.phoneNumberId}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message || 'WhatsApp Cloud API rejected the message');
  return {provider:'meta', id:data.messages?.[0]?.id, status:'submitted'};
}
