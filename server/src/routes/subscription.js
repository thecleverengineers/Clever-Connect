import express from 'express';
import {SubscriptionPlan,SubscriptionRequest,Workspace} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {accessForWorkspace,planLimitsForWorkspace,refreshWorkspaceAccess} from '../plan.js';

const r=express.Router();
r.use(requireAuth);

r.get('/',async(req,res)=>{
  const state=await refreshWorkspaceAccess(req.workspaceId);
  if(!state?.workspace)return res.status(404).json({message:'Workspace unavailable'});
  const [plans,request,limits]=await Promise.all([
    SubscriptionPlan.find({active:true}).sort({sortOrder:1,priceMonthly:1}).lean(),
    SubscriptionRequest.findOne({workspaceId:req.workspaceId,status:'pending'}).populate('planId').sort({createdAt:-1}).lean(),
    planLimitsForWorkspace(state.workspace)
  ]);
  res.json({
    workspace:{
      id:state.workspace._id,
      plan:state.workspace.plan,
      subscriptionPlanId:state.workspace.subscriptionPlanId,
      subscriptionStatus:state.workspace.subscriptionStatus,
      trialStartedAt:state.workspace.trialStartedAt,
      trialEndsAt:state.workspace.trialEndsAt,
      currentPeriodStart:state.workspace.currentPeriodStart,
      currentPeriodEnd:state.workspace.currentPeriodEnd
    },
    access:accessForWorkspace(state.workspace),
    limits,
    plans,
    pendingRequest:request||null
  });
});

r.post('/request',async(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return res.status(403).json({message:'Only workspace owners or admins can request a subscription'});
  const plan=await SubscriptionPlan.findOne({_id:req.body.planId,active:true});
  if(!plan)return res.status(404).json({message:'Subscription plan is not available'});
  await SubscriptionRequest.updateMany({workspaceId:req.workspaceId,status:'pending'},{$set:{status:'cancelled'}});
  const request=await SubscriptionRequest.create({
    workspaceId:req.workspaceId,
    planId:plan._id,
    requestedBy:req.user._id
  });
  res.status(201).json(await request.populate('planId'));
});

r.post('/request/cancel',async(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return res.status(403).json({message:'Only workspace owners or admins can cancel a subscription request'});
  const x=await SubscriptionRequest.findOneAndUpdate(
    {workspaceId:req.workspaceId,status:'pending'},
    {$set:{status:'cancelled'}},
    {new:true}
  );
  res.json({ok:true,request:x||null});
});

export default r;
