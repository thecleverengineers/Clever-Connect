import {Campaign,Delivery,DeliveryReceipt} from '../models.js';

export const PENDING_DELIVERY_STATES=['queued','dispatching','acceptance_unknown','submitted','sent'];
export const DELIVERY_STATES=['queued','dispatching','acceptance_unknown','submitted','sent','delivered','read','failed','skipped'];

export function normalizedAudiencePhone(value){
  const phone=String(value||'').replace(/\D/g,'');
  return /^[0-9]{8,15}$/.test(phone)?phone:'';
}

export function precheckRecipient(contact,seen=new Set()){
  const phone=normalizedAudiencePhone(contact?.phone);
  if(!phone)return {code:'INVALID_PHONE',reason:'Phone number is missing or invalid'};
  if(contact.suppressed)return {code:'SUPPRESSED',reason:'Contact is suppressed'};
  if(contact.consentStatus==='opted_out')return {code:'OPTED_OUT',reason:'Contact opted out'};
  if(contact.consentStatus!=='opted_in')return {code:'NO_CONSENT',reason:'Contact has not opted in'};
  if(seen.has(phone))return {code:'DUPLICATE',reason:'Duplicate phone number within the selected audience'};
  seen.add(phone);
  return null;
}

// The buckets are disjoint. A read receipt also counts toward delivered,
// but is never added to the audience total a second time.
export function summarizeStatuses(counts={}){
  const skipped=counts.skipped||0;
  const failed=counts.failed||0;
  const read=counts.read||0;
  const delivered=(counts.delivered||0)+read;
  const unknown=(counts.acceptance_unknown||0);
  const pending=(counts.queued||0)+(counts.dispatching||0)+unknown+(counts.submitted||0)+(counts.sent||0);
  const audience=skipped+failed+delivered+pending;
  const submitted=(counts.submitted||0)+(counts.sent||0)+delivered;
  const eligible=audience-skipped;
  const pct=(n,d)=>d?Math.round(n*1000/d)/10:0;
  return {
    audience,eligible,skipped,submitted,delivered,read,failed,pending,unknown,
    deliveredPct:pct(delivered,eligible),failedPct:pct(failed,eligible),
    readPct:pct(read,delivered),audienceDeliveryPct:pct(delivered,audience),
    replied:counts.replied||0
  };
}

export async function refreshCampaignTotals(campaignId){
  const counts=await Delivery.aggregate([
    {$match:{campaignId}},
    {$group:{_id:'$status',count:{$sum:1}}}
  ]);
  const summary=summarizeStatuses(Object.fromEntries(counts.map(x=>[x._id,x.count])));
  summary.replied=await Delivery.countDocuments({campaignId,repliedAt:{$ne:null}});
  await Campaign.findByIdAndUpdate(campaignId,{$set:{totals:summary}});
  const campaign=await Campaign.findById(campaignId).select('dispatchFinishedAt status').lean();
  if(campaign?.dispatchFinishedAt&&campaign.status==='processing'&&!summary.pending){
    await Campaign.updateOne({_id:campaignId,status:'processing'},{$set:{status:summary.failed?(summary.delivered?'partial':'failed'):'completed',completedAt:new Date()}});
  }
  return summary;
}

// A Meta receipt can be duplicated or arrive out of order. Atomic status
// guards prevent read -> delivered, delivered -> sent, or delivered -> failed.
const transitions={
  sent:['queued','dispatching','acceptance_unknown','submitted'],
  delivered:['queued','dispatching','acceptance_unknown','submitted','sent'],
  read:['queued','dispatching','acceptance_unknown','submitted','sent','delivered'],
  failed:['queued','dispatching','acceptance_unknown','submitted','sent']
};
export async function applyMetaReceipt({workspaceId,providerMessageId,status,occurredAt,errorCode='',errorMessage=''}){
  if(!transitions[status]||!providerMessageId)return null;
  const time=occurredAt instanceof Date&&!isNaN(occurredAt.getTime())?occurredAt:new Date();
  const set={status};
  if(status==='delivered'||status==='read')set.deliveredAt=time;
  if(status==='read')set.readAt=time;
  if(status==='failed'){
    set.errorCode=String(errorCode||'META_DELIVERY_FAILED').slice(0,80);
    set.error=String(errorMessage||'Provider reported failure').slice(0,500);
  }
  const updated=await Delivery.findOneAndUpdate({
    workspaceId,provider:'meta',providerMessageId,status:{$in:transitions[status]}
  },{$set:set},{new:true});
  if(updated?.campaignId)await refreshCampaignTotals(updated.campaignId);
  return updated;
}

export async function storeMetaReceipt(receipt){
  if(!transitions[receipt.status]||!receipt.providerMessageId)return null;
  // Save first: Meta may send a receipt before we persist the send response.
  await DeliveryReceipt.updateOne({
    workspaceId:receipt.workspaceId,providerMessageId:receipt.providerMessageId,status:receipt.status
  },{$setOnInsert:{
    workspaceId:receipt.workspaceId,providerMessageId:receipt.providerMessageId,
    status:receipt.status,occurredAt:receipt.occurredAt,
    errorCode:receipt.errorCode||'',errorMessage:receipt.errorMessage||''
  }},{upsert:true});
  return applyMetaReceipt(receipt);
}

export async function reconcileMetaReceipts(delivery){
  if(delivery.provider!=='meta'||!delivery.providerMessageId)return;
  const receipts=await DeliveryReceipt.find({
    workspaceId:delivery.workspaceId,providerMessageId:delivery.providerMessageId
  }).sort({occurredAt:1,createdAt:1}).lean();
  for(const receipt of receipts)await applyMetaReceipt(receipt);
}
