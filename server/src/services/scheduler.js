import { Campaign, Contact, Delivery, Template } from '../models.js';
import { sendWhatsApp } from './whatsapp.js';

async function audience(c){
  const q={workspaceId:c.workspaceId};
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
  await Campaign.findByIdAndUpdate(campaignId,{$set:{totals:{submitted,delivered,read:counts.read||0,failed:counts.failed||0}}});
}
export async function processCampaign(campaignId){
  const c=await Campaign.findById(campaignId);
  if(!c || ['processing','completed'].includes(c.status)) return c;
  c.status='processing'; c.startedAt=new Date(); c.lastError=''; await c.save();
  const contacts=await audience(c);
  const template=c.templateId ? await Template.findOne({_id:c.templateId,workspaceId:c.workspaceId}).lean() : null;
  for(const contact of contacts){
    let delivery=await Delivery.findOne({campaignId:c._id,contactId:contact._id});
    if(delivery && delivery.status!=='failed') continue;
    delivery=delivery||new Delivery({workspaceId:c.workspaceId,campaignId:c._id,contactId:contact._id,phone:contact.phone,status:'queued'});
    try{
      const result=await sendWhatsApp({workspaceId:c.workspaceId,phone:contact.phone,text:c.message,template});
      delivery.provider=result.provider; delivery.providerMessageId=result.id; delivery.status=result.status; delivery.sentAt=new Date();
      if(result.status==='delivered') delivery.deliveredAt=new Date();
      delivery.error='';
    }catch(err){ delivery.status='failed'; delivery.error=err.message; }
    await delivery.save();
  }
  await refreshCampaignTotals(c._id);
  const failed=await Delivery.countDocuments({campaignId:c._id,status:'failed'});
  c.status=failed===contacts.length && contacts.length ? 'failed' : 'completed'; c.completedAt=new Date();
  if(failed) c.lastError=`${failed} message(s) failed`;
  await c.save(); return c;
}
export async function runDueCampaigns(){
  const due=await Campaign.find({status:'scheduled',scheduledAt:{$lte:new Date()}}).select('_id').lean();
  for(const c of due) await processCampaign(c._id);
  return due.length;
}
