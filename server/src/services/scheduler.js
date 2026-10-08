import { Campaign, Contact, Delivery, Template } from '../models.js';
import { sendWhatsApp } from './whatsapp.js';

async function audience(c){
  const q={workspaceId:c.workspaceId,consentStatus:'opted_in',suppressed:false};
  if(c.audienceType==='list' && c.listId) q.lists=c.listId;
  if(c.audienceType==='contacts') q._id={$in:c.contactIds||[]};
  return Contact.find(q).lean();
}

export async function refreshCampaignTotals(campaignId){
  const rows=await Delivery.aggregate([
    {$match:{campaignId}},
    {$group:{_id:'$status',count:{$sum:1}}}
  ]);
  const counts=Object.fromEntries(rows.map(x=>[x._id,x.count]));
  const submitted=(counts.submitted||0)+(counts.sent||0)+(counts.delivered||0)+(counts.read||0);
  const delivered=(counts.delivered||0)+(counts.read||0);
  await Campaign.findByIdAndUpdate(campaignId,{$set:{totals:{
    submitted,
    delivered,
    read:counts.read||0,
    failed:counts.failed||0
  }}});
  return {submitted,delivered,read:counts.read||0,failed:counts.failed||0};
}

function renderMessage(text,contact){
  return String(text||'')
    .replace(/{{\s*name\s*}}/gi,contact.name||'')
    .replace(/{{\s*phone\s*}}/gi,contact.phone||'')
    .replace(/{{\s*email\s*}}/gi,contact.email||'');
}

export async function processCampaign(campaignId,{retryFailedOnly=false}={}){
  const c=await Campaign.findOneAndUpdate(
    {_id:campaignId,status:{$in:['draft','scheduled','failed','partial','completed']}},
    {$set:{status:'processing',startedAt:new Date(),lastError:''},$unset:{completedAt:1}},
    {new:true}
  );
  if(!c) return null;

  const contacts=await audience(c);
  if(!contacts.length){
    c.status='failed';
    c.completedAt=new Date();
    c.lastError='No opted-in, unsuppressed contacts matched this audience';
    await c.save();
    return c;
  }

  const template=c.templateId
    ? await Template.findOne({_id:c.templateId,workspaceId:c.workspaceId}).lean()
    : null;

  let attempted=0;
  for(const contact of contacts){
    let delivery=await Delivery.findOne({campaignId:c._id,contactId:contact._id});
    if(retryFailedOnly && (!delivery || delivery.status!=='failed')) continue;
    if(!retryFailedOnly && delivery && delivery.status!=='failed') continue;

    attempted++;
    delivery=delivery||new Delivery({
      workspaceId:c.workspaceId,
      campaignId:c._id,
      contactId:contact._id,
      phone:contact.phone,
      message:c.message||'',
      status:'queued'
    });

    try{
      const rendered=renderMessage(c.message||template?.body||'',contact);
      const result=await sendWhatsApp({
        workspaceId:c.workspaceId,
        phone:contact.phone,
        text:rendered,
        template
      });
      delivery.message=rendered;
      delivery.provider=result.provider;
      delivery.providerMessageId=result.id;
      delivery.status=result.status;
      delivery.sentAt=new Date();
      if(result.status==='delivered') delivery.deliveredAt=new Date();
      delivery.error='';
    }catch(err){
      delivery.status='failed';
      delivery.error=String(err.message||'Delivery failed').slice(0,500);
    }
    await delivery.save();
  }

  const totals=await refreshCampaignTotals(c._id);
  const allDeliveries=await Delivery.countDocuments({campaignId:c._id});
  c.status=totals.failed
    ? (totals.submitted>0?'partial':'failed')
    : (allDeliveries?'completed':'failed');
  c.completedAt=new Date();
  c.lastError=totals.failed?(String(totals.failed)+' message(s) failed'):(attempted?'':'No new deliveries were required');
  await c.save();
  return c;
}

export async function runDueCampaigns(){
  const due=await Campaign.find({status:'scheduled',scheduledAt:{$lte:new Date()}}).select('_id').lean();
  for(const c of due) await processCampaign(c._id);
  return due.length;
}
