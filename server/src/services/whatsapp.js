import { Integration,Workspace,Delivery } from '../models.js';
import {InboundWindow} from '../paymentModels.js';
import {buildCarouselPayload} from './carousel.js';
import { decrypt } from '../utils/crypto.js';
import {accessForWorkspace,planLimitsForWorkspace} from '../plan.js';

const normalizePhone=(phone='')=>String(phone).replace(/[^0-9]/g,'');

async function enforceMessageAllowance(workspaceId){
  const workspace=await Workspace.findById(workspaceId).lean();
  const access=accessForWorkspace(workspace);
  if(!access.allowed)throw new Error(access.reason||'WA SANTA subscription required');
  const limits=await planLimitsForWorkspace(workspace);
  const max=Number(limits.monthlyMessages)||0;
  if(max<=0)return;
  const since=workspace.subscriptionStatus==='active'
    ? (workspace.currentPeriodStart||new Date(new Date().getFullYear(),new Date().getMonth(),1))
    : (workspace.trialStartedAt||workspace.createdAt||new Date(Date.now()-7*86400000));
  const used=await Delivery.countDocuments({workspaceId,createdAt:{$gte:since}});
  if(used>=max)throw new Error('Monthly message limit reached for your WA SANTA plan');
}

export async function sendWhatsApp({workspaceId,phone,text,template,integrationId=null,carousel=null,buttons=null}){
  await enforceMessageAllowance(workspaceId);

  let integration=null;
  if(integrationId){
    integration=await Integration.findOne({_id:integrationId,workspaceId,enabled:true}).lean();
    if(!integration)throw new Error('Selected WhatsApp profile is no longer connected');
  }
  if(!integration) integration=await Integration.findOne({workspaceId,isDefault:true,enabled:true}).lean();
  if(!integration) integration=await Integration.findOne({workspaceId,enabled:true}).sort({provider:-1,createdAt:1}).lean();

  if((carousel||buttons)&&(!integration||integration.provider!=='meta')){
    throw new Error('Image carousel messages require an active Meta WhatsApp Cloud API profile');
  }
  if(!integration||integration.provider==='demo'){
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
  if(template?.integrationId&&template?.metaTemplateName&&template?.metaStatus&&template.metaStatus!=='APPROVED'){
    throw new Error('Meta template is not approved yet. Current status: '+template.metaStatus);
  }

  if((carousel||buttons)&&template)throw new Error('A Meta template cannot be combined with a session interaction');
  if(buttons&&carousel)throw new Error('Choose buttons or carousel, not both');
  if(buttons&&(!Array.isArray(buttons)||buttons.length<1||buttons.length>3||
    buttons.some(x=>!/^[a-zA-Z0-9_-]{1,40}$/.test(String(x.id||''))||!String(x.title||'').trim()||String(x.title).length>20))){
    throw new Error('WhatsApp supports 1–3 reply buttons (label up to 20 characters)');
  }
  const body=carousel
    ? buildCarouselPayload({to,text,cards:carousel})
    : buttons ? {
        messaging_product:'whatsapp',recipient_type:'individual',to,type:'interactive',
        interactive:{type:'button',body:{text:String(text||'').trim().slice(0,1024)},
          action:{buttons:buttons.map(b=>({type:'reply',reply:{id:b.id,title:b.title}}))}}
      }
    : template?.metaTemplateName
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

  if(body.type!=='template'){
    if(buttons&&!String(text||'').trim())throw new Error('Reply buttons require message text');
    if(body.type==='text'&&(!body.text.body||body.text.body.length>4096))throw new Error('Free-form text must contain 1–4096 characters');
    // A consented contact is not automatically eligible for free-form Meta messages.
    // Templates are mandatory outside the 24-hour inbound customer-service window.
    const window=await InboundWindow.findOne({workspaceId,integrationId:integration._id,phone:to}).lean();
    if(!window||Date.now()-new Date(window.lastInboundAt).getTime()>=24*60*60*1000){
      throw new Error('Free-form Meta message blocked: customer must have messaged this number within 24 hours. Use an approved Meta template instead.');
    }
  }

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
  return {provider:'meta',id,status:'submitted',integrationId:integration._id};
}
