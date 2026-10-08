import express from 'express';
import mongoose from 'mongoose';
import {Integration,Contact,Delivery,Workspace} from '../models.js';
import {PaymentConfig,PaymentOrder,InboundWindow} from '../paymentModels.js';
import {safeReference,normalizedPhone,sendOrderDetails,reconcileOrder} from '../services/paymentCheckout.js';
import {planLimitsForWorkspace} from '../plan.js';

const router=express.Router();
const ownerOrAdmin=req=>['owner','admin'].includes(req.user?.role)||!!req.user?.isSuperAdmin;
const validId=value=>mongoose.isValidObjectId(value);

router.get('/configs',async(req,res)=>{
  const [profiles,configs]=await Promise.all([
    Integration.find({workspaceId:req.workspaceId,provider:'meta'}).select('_id name enabled phoneNumberId displayPhoneNumber connectionStatus').lean(),
    PaymentConfig.find({workspaceId:req.workspaceId}).lean()
  ]);
  res.json(profiles.map(x=>({
    integrationId:String(x._id),name:x.name,phone:x.displayPhoneNumber||x.phoneNumberId,
    connected:x.enabled&&x.connectionStatus==='connected',
    paymentConfig:configs.find(c=>String(c.integrationId)===String(x._id))?{
      configurationName:configs.find(c=>String(c.integrationId)===String(x._id)).configurationName,
      enabled:configs.find(c=>String(c.integrationId)===String(x._id)).enabled,
      linkedConfirmedAt:configs.find(c=>String(c.integrationId)===String(x._id)).linkedConfirmedAt
    }:null
  })));
});

router.put('/configs/:id',async(req,res)=>{
  if(!ownerOrAdmin(req))return res.status(403).json({message:'Only workspace owners and admins can configure checkout'});
  if(!validId(req.params.id))return res.sendStatus(404);
  const integration=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId,provider:'meta'}).lean();
  if(!integration)return res.status(404).json({message:'Meta connection not found in this workspace'});
  const configurationName=String(req.body.configurationName||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(configurationName)){
    return res.status(400).json({message:'Enter the exact Razorpay payment configuration name from WhatsApp Manager (up to 60 characters)'});
  }
  if(req.body.confirmLinked!==true)return res.status(400).json({message:'Confirm that Razorpay is linked to this Meta WhatsApp Business Account in WhatsApp Manager'});
  const saved=await PaymentConfig.findOneAndUpdate(
    {workspaceId:req.workspaceId,integrationId:integration._id},
    {$set:{configurationName,enabled:req.body.enabled!==false,linkedConfirmedAt:new Date()}},
    {upsert:true,new:true,runValidators:true}
  );
  res.json({integrationId:String(integration._id),configurationName:saved.configurationName,enabled:saved.enabled,linkedConfirmedAt:saved.linkedConfirmedAt});
});

router.get('/orders',async(req,res)=>{
  const orders=await PaymentOrder.find({workspaceId:req.workspaceId}).sort({createdAt:-1}).limit(200)
    .populate('contactId','name phone').populate('integrationId','name displayPhoneNumber').lean();
  res.json(orders);
});

router.get('/window',async(req,res)=>{
  const integrationId=String(req.query.integrationId||'');
  if(!validId(integrationId))return res.status(400).json({message:'Choose a valid Meta WhatsApp profile'});
  const integration=await Integration.findOne({_id:integrationId,workspaceId:req.workspaceId,provider:'meta'}).select('_id').lean();
  if(!integration)return res.sendStatus(404);
  const windows=await InboundWindow.find({workspaceId:req.workspaceId,integrationId}).lean();
  res.json({windows:windows.filter(w=>Date.now()-new Date(w.lastInboundAt).getTime()<24*60*60*1000).map(x=>({phone:x.phone,lastInboundAt:x.lastInboundAt}))});
});

router.post('/orders/send',async(req,res)=>{
  const {integrationId,contactId}=req.body||{};
  if(!validId(integrationId)||!validId(contactId))return res.status(400).json({message:'Choose a Meta profile and saved contact'});
  const title=String(req.body.title||'').trim().slice(0,120);
  const inputAmount=Number(req.body.amountRupees);
  const amountPaise=Math.round(inputAmount*100);
  const idempotencyKey=String(req.body.idempotencyKey||'').trim();
  if(!title||title.length>120)return res.status(400).json({message:'Enter a valid order title'});
  if(!Number.isFinite(inputAmount)||!Number.isSafeInteger(amountPaise)||amountPaise<100||amountPaise>100000000||Math.abs(inputAmount*100-amountPaise)>0.00001){
    return res.status(400).json({message:'Enter a valid INR amount between ₹1 and ₹10,00,000 with at most two decimals'});
  }
  if(!/^[a-f\d-]{16,64}$/i.test(idempotencyKey))return res.status(400).json({message:'A valid unique request token is required'});
  const existing=await PaymentOrder.findOne({workspaceId:req.workspaceId,idempotencyKey}).lean();
  if(existing)return res.json({order:existing,duplicate:true});

  const [integration,contact,config]=await Promise.all([
    Integration.findOne({_id:integrationId,workspaceId:req.workspaceId,provider:'meta',enabled:true}).lean(),
    Contact.findOne({_id:contactId,workspaceId:req.workspaceId,consentStatus:'opted_in',suppressed:false}).lean(),
    PaymentConfig.findOne({workspaceId:req.workspaceId,integrationId,enabled:true}).lean()
  ]);
  if(!integration||integration.connectionStatus!=='connected'||!integration.accessTokenEncrypted)return res.status(409).json({message:'Connect an active Meta WhatsApp profile before accepting payments'});
  if(!contact)return res.status(403).json({message:'Recipient must be a saved, opted-in and unsuppressed contact'});
  if(!config)return res.status(409).json({message:'Link Razorpay in WhatsApp Manager and save its payment configuration for this Meta profile'});
  const phone=normalizedPhone(contact.phone);
  const window=await InboundWindow.findOne({workspaceId:req.workspaceId,integrationId:integration._id,phone}).lean();
  if(!window||Date.now()-new Date(window.lastInboundAt).getTime()>=24*60*60*1000){
    return res.status(409).json({message:'A free-form order_details message requires an active 24-hour customer-service window. Ask the customer to message your WhatsApp number first, or use an approved order-details template.'});
  }
  const workspace=await Workspace.findById(req.workspaceId).lean();
  const limits=await planLimitsForWorkspace(workspace);
  if(limits.monthlyMessages>0){
    const since=workspace.subscriptionStatus==='active'?
      (workspace.currentPeriodStart||new Date(new Date().getFullYear(),new Date().getMonth(),1)):
      (workspace.trialStartedAt||workspace.createdAt||new Date(Date.now()-7*86400000));
    const used=await Delivery.countDocuments({workspaceId:req.workspaceId,createdAt:{$gte:since}});
    if(used>=limits.monthlyMessages)return res.status(429).json({message:'Your monthly WhatsApp message allowance has been reached'});
  }
  let order;
  try{
    order=await PaymentOrder.create({
      workspaceId:req.workspaceId,integrationId:integration._id,contactId:contact._id,
      createdBy:req.user._id,phone:contact.phone,referenceId:safeReference(),idempotencyKey,
      title,amountPaise,configurationName:config.configurationName,status:'sending'
    });
  }catch(e){
    if(e.code===11000){
      const previous=await PaymentOrder.findOne({workspaceId:req.workspaceId,idempotencyKey}).lean();
      if(previous)return res.json({order:previous,duplicate:true});
    }
    throw e;
  }
  try{
    const messageId=await sendOrderDetails(integration,order);
    order.status='submitted';order.messageId=messageId;order.submittedAt=new Date();
    await order.save();
    try{
      await Delivery.create({
        workspaceId:req.workspaceId,contactId:contact._id,phone:contact.phone,
        message:'Razorpay checkout: '+title,provider:'meta',providerMessageId:messageId,status:'submitted',sentAt:new Date()
      });
    }catch(logError){
      // Provider has already accepted the order. A tracking DB error must not
      // mark the checkout as unsent and risk a duplicate payment request.
      console.error('Payment checkout delivery tracking failed',order.referenceId,logError);
    }
    return res.status(201).json({order});
  }catch(e){
    // A timeout can mean Meta accepted the message. Never automatically resend.
    order.status=e?.name==='TimeoutError'?'verification_pending':'send_failed';
    order.lastError=String(e.message||'Unable to send checkout').slice(0,500);
    await order.save();
    return res.status(502).json({message:order.status==='verification_pending'?'Meta timed out; delivery is uncertain. Check before creating another order.':order.lastError,order});
  }
});

router.post('/orders/:id/verify',async(req,res)=>{
  if(!validId(req.params.id))return res.sendStatus(404);
  const order=await PaymentOrder.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!order)return res.sendStatus(404);
  if(!order.messageId)return res.status(409).json({message:'This payment request has not been confirmed as sent to WhatsApp'});
  const integration=await Integration.findOne({_id:order.integrationId,workspaceId:req.workspaceId}).lean();
  if(!integration)return res.status(409).json({message:'The connected Meta profile is unavailable'});
  try{
    const verified=await reconcileOrder(order,integration);
    res.json({order:verified});
  }catch(e){
    res.status(502).json({message:'Could not verify the payment with Meta: '+e.message});
  }
});

export default router;
