import { Campaign, Contact, Delivery, Template, Workspace, Integration } from '../models.js';
import {recordOutbound} from './liveChat.js';
import {accessForWorkspace} from '../plan.js';
import { sendWhatsApp } from './whatsapp.js';
import {precheckRecipient,refreshCampaignTotals,reconcileMetaReceipts} from './campaignTracking.js';

async function audience(c){
  const q={workspaceId:c.workspaceId};
  if(c.audienceType==='list'&&c.listId)q.lists=c.listId;
  if(c.audienceType==='contacts')q._id={$in:c.contactIds||[]};
  return Contact.find(q).sort({_id:1}).lean();
}
async function snapshotAudience(c){
  if(c.audienceSnapshottedAt)return;
  const seen=new Set();
  for(const contact of await audience(c)){
    const excluded=precheckRecipient(contact,seen);
    await Delivery.updateOne({workspaceId:c.workspaceId,campaignId:c._id,contactId:contact._id},{
      $setOnInsert:{
        workspaceId:c.workspaceId,campaignId:c._id,contactId:contact._id,
        phone:String(contact.phone||''),recipientName:contact.name||'',recipientEmail:contact.email||'',
        message:c.message||'',status:excluded?'skipped':'queued',
        skipReason:excluded?.reason||'',errorCode:excluded?.code||''
      }
    },{upsert:true});
  }
  await Campaign.updateOne({_id:c._id},{$set:{audienceSnapshottedAt:new Date()}});
}
export {refreshCampaignTotals} from './campaignTracking.js';

function renderMessage(text,contact){
  return String(text||'')
    .replace(/{{\s*name\s*}}/gi,contact.name||'')
    .replace(/{{\s*phone\s*}}/gi,contact.phone||'')
    .replace(/{{\s*email\s*}}/gi,contact.email||'');
}

export async function processCampaign(campaignId,{retryFailedOnly=false}={}){
  const existing=await Campaign.findById(campaignId).lean();
  if(!existing)return null;
  const workspace=await Workspace.findById(existing.workspaceId).lean();
  const access=accessForWorkspace(workspace);
  if(!access.allowed){
    await Campaign.findByIdAndUpdate(campaignId,{$set:{status:'failed',completedAt:new Date(),lastError:access.reason||'WA SANTA subscription required'}});
    return null;
  }
  const c=await Campaign.findOneAndUpdate(
    {_id:campaignId,status:{$in:['draft','scheduled','failed','partial','completed']}},
    {$set:{status:'processing',startedAt:new Date(),lastError:''},$unset:{completedAt:1,dispatchFinishedAt:1}},
    {new:true}
  );
  if(!c) return null;

  await snapshotAudience(c);
  await refreshCampaignTotals(c._id);
  const queued=await Delivery.find({workspaceId:c.workspaceId,campaignId:c._id,status:retryFailedOnly?'failed':'queued'}).lean();
  if(!queued.length){
    const summary=await refreshCampaignTotals(c._id);
    c.status=summary.pending?'processing':summary.failed?(summary.delivered?'partial':'failed'):'completed';
    c.dispatchFinishedAt=new Date();c.completedAt=summary.pending?null:new Date();
    await c.save();return c;
  }
  const template=c.templateId
    ? await Template.findOne({_id:c.templateId,workspaceId:c.workspaceId}).lean()
    : null;

  let attempted=0;
  for(const item of queued){
    let delivery=await Delivery.findOne({_id:item._id,workspaceId:c.workspaceId});
    if(!delivery||!['queued',...(retryFailedOnly?['failed']:[])].includes(delivery.status))continue;
    const contact={_id:delivery.contactId,name:delivery.recipientName,phone:delivery.phone,email:delivery.recipientEmail};

    attempted++;

    let actualIntegrationId=null;
    try{
      const eligible=await Contact.exists({
        _id:contact._id,workspaceId:c.workspaceId,consentStatus:'opted_in',suppressed:false
      });
      if(!eligible)throw new Error('Contact opted out or was suppressed before dispatch');
      const isTemplate=c.sendMode==='template'||(c.templateId&&!c.sendMode);
      if(isTemplate&&(!template||template.metaStatus!=='APPROVED'))throw new Error('Approved Meta template is unavailable');
      const rendered=isTemplate?renderMessage(template.body,contact):renderMessage(c.message,contact);
      const values=isTemplate?(c.templateParams||[]).map(value=>renderMessage(value,contact)):[];
      const isCarousel=!isTemplate&&c.contentType==='carousel';
      const cards=isCarousel?(c.carouselCards||[]).map(card=>({
        imageUrl:card.imageUrl,
        caption:renderMessage(card.caption,contact),
        buttonText:card.buttonText,buttonUrl:card.buttonUrl
      })):null;
      const result=await sendWhatsApp({
        workspaceId:c.workspaceId,
        phone:contact.phone,
        text:rendered,
        template:isTemplate?template:null,
        templateParams:values,
        carousel:cards,
        integrationId:template?.integrationId||c.integrationId||null
      });
      actualIntegrationId=result.integrationId||null;
      delivery.message=rendered;
      delivery.provider=result.provider;
      delivery.providerMessageId=result.id;
      delivery.status=result.status;
      delivery.sentAt=new Date();
      if(result.status==='delivered') delivery.deliveredAt=new Date();
      delivery.error='';delivery.errorCode='';delivery.attemptCount=(delivery.attemptCount||0)+1;
    }catch(err){
      delivery.status='failed';
      delivery.error=String(err.message||'Delivery failed').slice(0,500);
      delivery.errorCode='DISPATCH_ERROR';delivery.attemptCount=(delivery.attemptCount||0)+1;
    }
    await delivery.save();
    await reconcileMetaReceipts(delivery);
    if(delivery.status==='submitted'&&delivery.provider==='meta'&&delivery.providerMessageId){
      try{
        const profile=await Integration.findOne({_id:actualIntegrationId||template?.integrationId||c.integrationId,workspaceId:c.workspaceId}).lean()
          ||await Integration.findOne({workspaceId:c.workspaceId,isDefault:true,provider:'meta'}).lean();
        if(profile)await recordOutbound({integration:profile,phone:contact.phone,text:delivery.message,
          providerMessageId:delivery.providerMessageId,status:delivery.status,source:'campaign',
          campaignId:c._id,deliveryId:delivery._id});
      }catch(e){console.error('Campaign chat mirror failed',e)}
    }
  }

  const totals=await refreshCampaignTotals(c._id);
  c.status=totals.pending?'processing':totals.failed?(totals.delivered?'partial':'failed'):'completed';
  c.dispatchFinishedAt=new Date();
  c.completedAt=totals.pending?null:new Date();
  c.lastError=totals.failed?String(totals.failed)+' message(s) failed':'';
  await c.save();
  return c;
}

export async function runDueCampaigns(){
  const due=await Campaign.find({status:'scheduled',scheduledAt:{$lte:new Date()}}).select('_id').lean();
  for(const c of due) await processCampaign(c._id);
  return due.length;
}
