import express from 'express';
import mongoose from 'mongoose';
import {Campaign,Delivery,Template,Contact,ContactList} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {processCampaign} from '../services/scheduler.js';
import {sendWhatsApp} from '../services/whatsapp.js';

const r=express.Router();
r.use(requireAuth);

async function normalizeCampaign(req, existing=null){
  const body=req.body||{};
  const data={};
  if(body.name!==undefined) data.name=String(body.name||'').trim();
  if(body.message!==undefined) data.message=String(body.message||'').trim();
  if(body.templateId!==undefined) data.templateId=body.templateId||null;
  if(body.audienceType!==undefined) data.audienceType=['all','list','contacts'].includes(body.audienceType)?body.audienceType:'all';
  if(body.listId!==undefined) data.listId=body.listId||null;
  if(body.contactIds!==undefined) data.contactIds=Array.isArray(body.contactIds)?body.contactIds.filter(mongoose.isValidObjectId):[];
  if(body.scheduledAt!==undefined) data.scheduledAt=body.scheduledAt?new Date(body.scheduledAt):null;

  const merged={...(existing?.toObject?.()||existing||{}),...data};
  if(!merged.name) throw new Error('Campaign name is required');
  if(!merged.message&&!merged.templateId) throw new Error('Add a message or choose a template');
  if(merged.templateId){
    const template=await Template.findOne({_id:merged.templateId,workspaceId:req.workspaceId}).select('_id').lean();
    if(!template) throw new Error('Selected template was not found');
  }
  if(merged.audienceType==='list'){
    if(!merged.listId) throw new Error('Choose a contact list');
    const list=await ContactList.findOne({_id:merged.listId,workspaceId:req.workspaceId}).select('_id').lean();
    if(!list) throw new Error('Selected contact list was not found');
  }
  if(merged.audienceType==='contacts'&&!merged.contactIds?.length) throw new Error('Choose at least one contact');
  if(data.scheduledAt instanceof Date && Number.isNaN(data.scheduledAt.getTime())) throw new Error('Invalid schedule date');
  return data;
}

r.get('/',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.status) q.status=req.query.status;
  const rows=await Campaign.find(q).sort({createdAt:-1}).populate('listId','name').populate('templateId','name body integrationId metaStatus metaTemplateName').lean();
  res.json(rows);
});

r.get('/deliveries',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.status) q.status=req.query.status;
  const limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
  const rows=await Delivery.find(q).sort({createdAt:-1}).limit(limit)
    .populate('contactId','name phone consentStatus')
    .populate('campaignId','name status')
    .lean();
  res.json(rows);
});

r.get('/:id/deliveries',async(req,res)=>{
  const campaign=await Campaign.findOne({_id:req.params.id,workspaceId:req.workspaceId}).select('_id').lean();
  if(!campaign) return res.sendStatus(404);
  res.json(await Delivery.find({workspaceId:req.workspaceId,campaignId:req.params.id})
    .sort({createdAt:-1}).populate('contactId','name phone consentStatus').populate('campaignId','name status').lean());
});

r.post('/',async(req,res)=>{
  try{
    const data=await normalizeCampaign(req);
    data.workspaceId=req.workspaceId;
    if(data.scheduledAt){
      data.status=data.scheduledAt>new Date()?'scheduled':'draft';
    }
    const row=await Campaign.create(data);
    res.status(201).json(row);
  }catch(e){res.status(400).json({message:e.message})}
});

r.post('/single/send',async(req,res)=>{
  try{
    let contact=null;
    let phone='';
    if(req.body.contactId){
      contact=await Contact.findOne({_id:req.body.contactId,workspaceId:req.workspaceId}).lean();
      if(!contact) return res.status(404).json({message:'Contact not found'});
      if(contact.suppressed||contact.consentStatus!=='opted_in') return res.status(409).json({message:'Contact must be opted in and not suppressed before live messaging'});
      phone=contact.phone;
    }else{
      phone=String(req.body.phone||'').trim();
      if(!phone) return res.status(400).json({message:'Choose a contact or enter a phone number'});
      if(req.body.consentConfirmed!==true) return res.status(400).json({message:'Confirm that this recipient has opted in'});
    }
    const template=req.body.templateId?await Template.findOne({_id:req.body.templateId,workspaceId:req.workspaceId}).lean():null;
    const rawMessage=String(req.body.message||template?.body||'').trim();
    if(!rawMessage&&!template) return res.status(400).json({message:'Add a message or choose a template'});
    const message=rawMessage
      .replace(/{{\s*name\s*}}/gi,contact?.name||'')
      .replace(/{{\s*phone\s*}}/gi,contact?.phone||phone)
      .replace(/{{\s*email\s*}}/gi,contact?.email||'');
    const result=await sendWhatsApp({workspaceId:req.workspaceId,phone,text:message,template,integrationId:template?.integrationId||null});
    const d=await Delivery.create({
      workspaceId:req.workspaceId,
      contactId:contact?._id||null,
      phone,
      message,
      provider:result.provider,
      providerMessageId:result.id,
      status:result.status,
      sentAt:new Date(),
      deliveredAt:result.status==='delivered'?new Date():undefined
    });
    res.json(d);
  }catch(e){res.status(502).json({message:e.message})}
});

r.put('/:id',async(req,res)=>{
  const existing=await Campaign.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!existing) return res.sendStatus(404);
  if(existing.status==='processing') return res.status(409).json({message:'A processing campaign cannot be edited'});
  try{
    const data=await normalizeCampaign(req,existing);
    if(Object.prototype.hasOwnProperty.call(data,'scheduledAt')){
      if(data.scheduledAt&&data.scheduledAt>new Date()) data.status='scheduled';
      else if(['scheduled','cancelled'].includes(existing.status)) data.status='draft';
    }
    const row=await Campaign.findOneAndUpdate({_id:req.params.id,workspaceId:req.workspaceId},{$set:data},{new:true,runValidators:true});
    res.json(row);
  }catch(e){res.status(400).json({message:e.message})}
});

r.post('/:id/send',async(req,res)=>{
  const row=await Campaign.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!row) return res.sendStatus(404);
  if(row.status==='processing') return res.status(409).json({message:'Campaign is already processing'});
  row.status='draft';
  row.scheduledAt=null;
  await row.save();
  setImmediate(()=>processCampaign(row._id).catch(console.error));
  res.status(202).json({ok:true,status:'processing'});
});

r.post('/:id/retry-failed',async(req,res)=>{
  const row=await Campaign.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!row) return res.sendStatus(404);
  if(row.status==='processing') return res.status(409).json({message:'Campaign is already processing'});
  const failed=await Delivery.countDocuments({workspaceId:req.workspaceId,campaignId:row._id,status:'failed'});
  if(!failed) return res.status(409).json({message:'There are no failed deliveries to retry'});
  row.status='draft';
  row.lastError='';
  await row.save();
  setImmediate(()=>processCampaign(row._id,{retryFailedOnly:true}).catch(console.error));
  res.status(202).json({ok:true,retrying:failed});
});

r.post('/:id/reschedule',async(req,res)=>{
  const at=new Date(req.body.scheduledAt);
  if(Number.isNaN(at.getTime())||at<=new Date()) return res.status(400).json({message:'Choose a future date and time'});
  const row=await Campaign.findOneAndUpdate(
    {_id:req.params.id,workspaceId:req.workspaceId,status:{$ne:'processing'}},
    {$set:{scheduledAt:at,status:'scheduled',completedAt:null,lastError:''}},
    {new:true}
  );
  if(!row) return res.status(409).json({message:'Campaign is processing or was not found'});
  res.json(row);
});

r.post('/:id/cancel',async(req,res)=>{
  const row=await Campaign.findOneAndUpdate(
    {_id:req.params.id,workspaceId:req.workspaceId,status:{$in:['draft','scheduled']}},
    {$set:{status:'cancelled',lastError:'Cancelled by user'}},
    {new:true}
  );
  if(!row) return res.status(409).json({message:'Only draft or scheduled campaigns can be cancelled'});
  res.json(row);
});

r.delete('/:id',async(req,res)=>{
  const row=await Campaign.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
  if(!row) return res.sendStatus(404);
  if(row.status==='processing') return res.status(409).json({message:'Wait for processing to finish before deleting'});
  await Delivery.deleteMany({workspaceId:req.workspaceId,campaignId:req.params.id});
  await Campaign.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});

export default r;
