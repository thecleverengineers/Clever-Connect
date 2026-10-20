import { Integration,Workspace,Delivery } from '../models.js';
import {InboundWindow} from '../paymentModels.js';
import {buildCarouselPayload} from './carousel.js';
import { decrypt } from '../utils/crypto.js';
import {accessForWorkspace,planLimitsForWorkspace,requireMetaSenderEntitlement} from '../plan.js';

const normalizePhone=(phone='')=>String(phone).replace(/[^0-9]/g,'');

// Conservative app pacing per connected phone. Meta's *actual* portfolio
// messaging tier/throughput is dynamic and continues to be enforced by Meta.
// This local 4-msg/s control is not presented as an official Meta limit.
const nextSendByProfile=new Map();
async function paceProfile(profileId){
  const id=String(profileId);
  const now=Date.now();
  const due=Math.max(now,nextSendByProfile.get(id)||now);
  nextSendByProfile.set(id,due+250);
  if(due>now)await new Promise(resolve=>setTimeout(resolve,due-now));
}


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
  const used=await Delivery.countDocuments({workspaceId,createdAt:{$gte:since},status:{$nin:['queued','skipped']}});
  if(used>=max)throw new Error('Monthly message limit reached for your WA SANTA plan');
}

export async function sendWhatsApp({workspaceId,phone,text,template,integrationId=null,carousel=null,buttons=null,templateParams=[]}){
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
  // Recheck entitlement at dispatch time; saved profiles above a downgraded plan stay intact but cannot send.
  if(integration?.provider==='meta')await requireMetaSenderEntitlement(workspaceId,integration._id);

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
  if(template){
    if(integration.provider!=='meta'||!template.metaTemplateId||!template.metaTemplateName||template.metaStatus!=='APPROVED'){
      throw new Error('Template sending requires an APPROVED template and an active Meta WhatsApp profile');
    }
    if(!template.integrationId||String(template.integrationId)!==String(integration._id)){
      throw new Error('Template must be sent using its approved Meta profile');
    }
    if(template.category==='AUTHENTICATION')throw new Error('Use the secure OTP flow for authentication templates');
    if(['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat)&&!template.headerMediaUrl){
      throw new Error('Approved media template requires a public HTTPS media URL before sending');
    }
    const required=[...String(template.body||'').matchAll(/{{\s*(\d+)\s*}}/g)]
      .map(x=>Number(x[1])).reduce((max,num)=>Math.max(max,num),0);
    if(templateParams.length!==required||templateParams.some(x=>!String(x||'').trim())){
      throw new Error('Template body requires '+required+' variable values');
    }
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
        template:{
          name:template.metaTemplateName,language:{code:template.language||'en_US'},
          ...(templateParams.length||['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat)?{
            components:[
              ...(['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat)?[{
                type:'header',
                parameters:[{type:template.headerFormat.toLowerCase(),[template.headerFormat.toLowerCase()]:{
                  link:String(template.headerMediaUrl)
                }}]
              }]:[]),
              ...(templateParams.length?[{type:'body',parameters:templateParams.map(x=>({type:'text',text:String(x)}))}]:[])
            ]
          }:{})
        }
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

  await paceProfile(integration._id);
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
    // Transport failures after transmission cannot prove Meta did not accept
    // the request. Mark these as UNKNOWN and never automatically resend.
    const unknown=new Error(e?.name==='TimeoutError'?'WhatsApp Cloud API timed out — acceptance unknown':
      'WhatsApp Cloud API transport error — acceptance unknown');
    unknown.submissionUnknown=true;
    unknown.cause=e;
    throw unknown;
  }

  let data;
  try{data=await response.json()}catch(e){
    const unknown=new Error('WhatsApp Cloud API response was not readable — acceptance unknown');
    unknown.submissionUnknown=true;unknown.cause=e;
    throw unknown;
  }
  if(!response.ok){
    const message=data?.error?.message||'WhatsApp Cloud API rejected the message';
    const rejected=new Error(message);
    rejected.providerErrorCode=String(data?.error?.code||'');
    // A provider-side failure is not proof that a request was never accepted.
    // Keep 5xx outcomes conservative; explicit client and rate-limit
    // rejections are confirmed unsuccessful and suitable for operator review.
    rejected.submissionUnknown=response.status>=500;
    throw rejected;
  }
  const id=data.messages?.[0]?.id;
  if(!id){
    const unknown=new Error('WhatsApp Cloud API accepted the request but no message ID was returned');
    unknown.submissionUnknown=true;
    throw unknown;
  }
  return {provider:'meta',id,status:'submitted',integrationId:integration._id};
}
