import express from 'express';
import mongoose from 'mongoose';
import {SubscriptionPlan,SubscriptionRequest,Workspace,User} from '../models.js';
import {requireAuth,requireSuperAdmin} from '../middleware/auth.js';
import {accessForWorkspace} from '../plan.js';
import {getMetaConfig,getMetaConfigPublic,saveMetaConfig,clearMetaAppSecret} from '../metaConfig.js';

const r=express.Router();
r.use(requireAuth,requireSuperAdmin);

const cleanPlan=b=>({
  name:String(b.name||'').trim(),
  slug:String(b.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,''),
  description:String(b.description||'').trim(),
  priceMonthly:Number(b.priceMonthly),
  currency:String(b.currency||'INR').trim().toUpperCase(),
  active:b.active!==false,
  sortOrder:Number(b.sortOrder)||0,
  metaConnections:Math.max(0,Number(b.metaConnections)||0),
  teamMembers:Math.max(1,Number(b.teamMembers)||1),
  monthlyMessages:Math.max(0,Number(b.monthlyMessages)||0),
  features:Array.isArray(b.features)?b.features.map(x=>String(x).trim()).filter(Boolean).slice(0,30):String(b.features||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,30)
});

r.get('/overview',async(req,res)=>{
  const [plans,workspaces,requests]=await Promise.all([
    SubscriptionPlan.find().sort({sortOrder:1,priceMonthly:1}).lean(),
    Workspace.find().sort({createdAt:-1}).limit(250).lean(),
    SubscriptionRequest.find({status:'pending'}).populate('planId','name slug priceMonthly currency').populate('requestedBy','name email').populate('workspaceId','name plan subscriptionStatus trialEndsAt currentPeriodEnd').sort({createdAt:-1}).lean()
  ]);
  const workspaceIds=workspaces.map(x=>x._id);
  const owners=await User.find({workspaceId:{$in:workspaceIds},role:'owner'}).select('workspaceId name email').lean();
  const ownerMap=new Map(owners.map(x=>[String(x.workspaceId),x]));
  res.json({
    plans,
    pendingRequests:requests,
    workspaces:workspaces.map(w=>({
      ...w,
      access:accessForWorkspace(w),
      owner:ownerMap.get(String(w._id))||null
    }))
  });
});


r.get('/meta-settings',async(req,res)=>{
  const cfg=await getMetaConfigPublic();
  res.json(cfg);
});

r.put('/meta-settings',async(req,res)=>{
  const appId=String(req.body.appId||'').trim();
  const configId=String(req.body.configId||'').trim();
  const graphVersion=String(req.body.graphVersion||'v23.0').trim();
  if(!appId||!configId)return res.status(400).json({message:'Meta App ID and Embedded Signup Config ID are required'});
  if(!/^v\d+\.\d+$/.test(graphVersion))return res.status(400).json({message:'Graph version must look like v23.0'});
  const existing=await getMetaConfig();
  const appSecret=String(req.body.appSecret||'').trim();
  if(!appSecret&&!existing.appSecret)return res.status(400).json({message:'Meta App Secret is required the first time'});
  await saveMetaConfig({
    appId,
    configId,
    graphVersion,
    appSecret,
    updatedBy:req.user._id
  });
  res.json(await getMetaConfigPublic());
});

r.post('/meta-settings/clear-secret',async(req,res)=>{
  await clearMetaAppSecret(req.user._id);
  res.json(await getMetaConfigPublic());
});

r.post('/meta-settings/test',async(req,res)=>{
  try{
    const cfg=await getMetaConfig();
    if(!cfg.appId||!cfg.appSecret)return res.status(400).json({message:'Save Meta App ID and App Secret first'});
    const params=new URLSearchParams({
      client_id:cfg.appId,
      client_secret:cfg.appSecret,
      grant_type:'client_credentials'
    });
    const response=await fetch('https://graph.facebook.com/'+cfg.graphVersion+'/oauth/access_token?'+params.toString(),{
      signal:AbortSignal.timeout(12000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.access_token)return res.status(502).json({message:data?.error?.message||'Meta rejected the App ID/App Secret'});
    res.json({
      ok:true,
      appCredentialsValid:true,
      configIdSaved:!!cfg.configId,
      message:cfg.configId
        ? 'Meta App credentials are valid. Embedded Signup Config ID is saved; complete validation occurs when opening Continue with Facebook.'
        : 'Meta App credentials are valid. Add an Embedded Signup Config ID.'
    });
  }catch(e){
    res.status(502).json({message:e.name==='TimeoutError'?'Meta credential test timed out':e.message});
  }
});

r.post('/plans',async(req,res)=>{
  const data=cleanPlan(req.body);
  if(!data.name||!data.slug||!Number.isFinite(data.priceMonthly)||data.priceMonthly<0)return res.status(400).json({message:'Plan name, slug and valid monthly price are required'});
  try{res.status(201).json(await SubscriptionPlan.create(data))}
  catch(e){res.status(409).json({message:e.code===11000?'Plan slug already exists':e.message})}
});

r.put('/plans/:id',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const data=cleanPlan(req.body);
  if(!data.name||!data.slug||!Number.isFinite(data.priceMonthly)||data.priceMonthly<0)return res.status(400).json({message:'Plan name, slug and valid monthly price are required'});
  try{
    const x=await SubscriptionPlan.findByIdAndUpdate(req.params.id,{$set:data},{new:true,runValidators:true});
    if(!x)return res.sendStatus(404);
    res.json(x);
  }catch(e){res.status(409).json({message:e.code===11000?'Plan slug already exists':e.message})}
});

r.delete('/plans/:id',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const inUse=await Workspace.countDocuments({subscriptionPlanId:req.params.id,subscriptionStatus:'active'});
  if(inUse)return res.status(409).json({message:'This plan is assigned to active subscriptions. Disable it instead of deleting it'});
  await SubscriptionPlan.deleteOne({_id:req.params.id});
  res.json({ok:true});
});

r.post('/requests/:id/approve',async(req,res)=>{
  const request=await SubscriptionRequest.findOne({_id:req.params.id,status:'pending'}).populate('planId');
  if(!request)return res.status(404).json({message:'Pending request not found'});
  const now=new Date();
  const months=Math.max(1,Math.min(24,Number(req.body.months)||1));
  const end=new Date(now);
  end.setMonth(end.getMonth()+months);
  await Workspace.updateOne({_id:request.workspaceId},{$set:{
    plan:request.planId.slug,
    subscriptionPlanId:request.planId._id,
    subscriptionStatus:'active',
    currentPeriodStart:now,
    currentPeriodEnd:end
  }});
  request.status='approved';
  request.approvedBy=req.user._id;
  request.approvedAt=now;
  request.adminNote=String(req.body.adminNote||'').trim();
  await request.save();
  await SubscriptionRequest.updateMany({_id:{$ne:request._id},workspaceId:request.workspaceId,status:'pending'},{$set:{status:'cancelled'}});
  res.json({ok:true,request});
});

r.post('/requests/:id/reject',async(req,res)=>{
  const request=await SubscriptionRequest.findOneAndUpdate(
    {_id:req.params.id,status:'pending'},
    {$set:{status:'rejected',approvedBy:req.user._id,approvedAt:new Date(),adminNote:String(req.body.adminNote||'').trim()}},
    {new:true}
  );
  if(!request)return res.status(404).json({message:'Pending request not found'});
  res.json({ok:true,request});
});

r.put('/workspaces/:id/subscription',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const status=['trialing','active','past_due','cancelled','expired'].includes(req.body.subscriptionStatus)?req.body.subscriptionStatus:null;
  if(!status)return res.status(400).json({message:'Valid subscription status is required'});
  const update={subscriptionStatus:status};
  if(req.body.planId){
    const plan=await SubscriptionPlan.findById(req.body.planId);
    if(!plan)return res.status(404).json({message:'Plan not found'});
    update.plan=plan.slug;
    update.subscriptionPlanId=plan._id;
  }
  if(status==='active'){
    const now=new Date();
    const months=Math.max(1,Math.min(24,Number(req.body.months)||1));
    const end=new Date(now);end.setMonth(end.getMonth()+months);
    update.currentPeriodStart=now;update.currentPeriodEnd=end;
  }
  if(status==='trialing'){
    const now=new Date();update.plan='trial';update.subscriptionPlanId=null;update.trialStartedAt=now;update.trialEndsAt=new Date(now.getTime()+7*86400000);update.currentPeriodStart=null;update.currentPeriodEnd=null;
  }
  const w=await Workspace.findByIdAndUpdate(req.params.id,{$set:update},{new:true});
  if(!w)return res.sendStatus(404);
  res.json(w);
});

export default r;
