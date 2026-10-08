import express from 'express';
import mongoose from 'mongoose';
import {ChatConversation,ChatMessage} from '../chatModels.js';
import {Integration,Contact,Delivery} from '../models.js';
import {digits,recordOutbound} from '../services/liveChat.js';
import {sendWhatsApp} from '../services/whatsapp.js';

const r=express.Router();
r.get('/conversations',async(req,res)=>{
  const query={workspaceId:req.workspaceId};
  if(req.query.integrationId&&mongoose.isValidObjectId(req.query.integrationId))query.integrationId=req.query.integrationId;
  const list=await ChatConversation.find(query).sort({lastMessageAt:-1}).limit(150)
    .populate('contactId','name phone consentStatus')
    .populate('integrationId','name displayPhoneNumber').lean();
  res.json(list);
});
r.get('/conversations/:id/messages',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const convo=await ChatConversation.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
  if(!convo)return res.sendStatus(404);
  const rows=await ChatMessage.find({workspaceId:req.workspaceId,conversationId:convo._id})
    .sort({createdAt:-1}).limit(150).lean();
  res.json({conversation:convo,messages:rows.reverse()});
});
r.post('/conversations/:id/read',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const row=await ChatConversation.findOneAndUpdate({_id:req.params.id,workspaceId:req.workspaceId},
    {$set:{unreadCount:0}},{new:true});
  if(!row)return res.sendStatus(404);
  res.json({ok:true});
});
r.put('/conversations/:id/agent',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const row=await ChatConversation.findOneAndUpdate({_id:req.params.id,workspaceId:req.workspaceId},
    {$set:{botPaused:req.body.botPaused===true,assignedTo:req.body.botPaused===true?req.user._id:null,
      ...(req.body.botPaused===true?{activeFlowId:null,awaitingNodeId:''}:{})}},{new:true});
  if(!row)return res.sendStatus(404);
  res.json(row);
});
r.post('/conversations/:id/reply',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const body=String(req.body.text||'').trim();
  if(!body||body.length>4096)return res.status(400).json({message:'Reply must contain 1–4096 characters'});
  const convo=await ChatConversation.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!convo)return res.sendStatus(404);
  const integration=await Integration.findOne({_id:convo.integrationId,workspaceId:req.workspaceId,provider:'meta',enabled:true}).lean();
  if(!integration)return res.status(409).json({message:'Connected Meta profile is not available'});
  if(!convo.lastInboundAt||Date.now()-new Date(convo.lastInboundAt).getTime()>=24*60*60*1000){
    return res.status(409).json({message:'24-hour reply window has expired. Use an approved Meta template to resume the conversation.'});
  }
  const contact=await Contact.findOne({workspaceId:req.workspaceId,phone:'+'+digits(convo.phone)}).lean();
  if(contact&&(contact.suppressed||contact.consentStatus==='opted_out'))return res.status(403).json({message:'Contact is opted out'});
  try{
    const result=await sendWhatsApp({workspaceId:req.workspaceId,phone:convo.phone,text:body,integrationId:integration._id});
    const msg=await recordOutbound({integration,phone:convo.phone,text:body,providerMessageId:result.id,status:result.status,source:'agent'});
    await ChatConversation.updateOne({_id:convo._id},{$set:{botPaused:true,assignedTo:req.user._id,activeFlowId:null,awaitingNodeId:''}});
    await Delivery.create({workspaceId:req.workspaceId,contactId:contact?._id||null,phone:'+'+convo.phone,message:body,
      provider:'meta',providerMessageId:result.id,status:result.status,sentAt:new Date()}).catch(console.error);
    res.status(201).json(msg);
  }catch(e){res.status(502).json({message:e.message})}
});
export default r;