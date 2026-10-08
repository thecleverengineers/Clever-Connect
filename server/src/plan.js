import {SubscriptionPlan,Workspace} from './models.js';

export const TRIAL_LIMITS={metaConnections:1,teamMembers:3,monthlyMessages:1000};

export async function planLimitsForWorkspace(workspace){
  if(!workspace)return TRIAL_LIMITS;
  if(workspace.subscriptionPlanId){
    const p=await SubscriptionPlan.findOne({_id:workspace.subscriptionPlanId,active:true}).lean();
    if(p)return {metaConnections:p.metaConnections,teamMembers:p.teamMembers,monthlyMessages:p.monthlyMessages};
  }
  if(workspace.plan&&workspace.plan!=='trial'){
    const p=await SubscriptionPlan.findOne({slug:workspace.plan,active:true}).lean();
    if(p)return {metaConnections:p.metaConnections,teamMembers:p.teamMembers,monthlyMessages:p.monthlyMessages};
  }
  return TRIAL_LIMITS;
}

export function accessForWorkspace(workspace){
  const now=Date.now();
  if(!workspace)return {allowed:false,state:'expired',reason:'Workspace unavailable'};
  if(workspace.subscriptionStatus==='active'){
    if(!workspace.currentPeriodEnd||new Date(workspace.currentPeriodEnd).getTime()>now){
      return {allowed:true,state:'active',endsAt:workspace.currentPeriodEnd||null};
    }
    return {allowed:false,state:'expired',endsAt:workspace.currentPeriodEnd,reason:'Subscription expired'};
  }
  if(workspace.subscriptionStatus==='trialing'){
    const end=workspace.trialEndsAt?new Date(workspace.trialEndsAt).getTime():0;
    if(end>now){
      const ms=end-now;
      return {allowed:true,state:'trialing',endsAt:workspace.trialEndsAt,daysRemaining:Math.max(1,Math.ceil(ms/86400000))};
    }
    return {allowed:false,state:'expired',endsAt:workspace.trialEndsAt,daysRemaining:0,reason:'7-day trial expired'};
  }
  return {allowed:false,state:workspace.subscriptionStatus||'expired',reason:'Subscription required'};
}

export async function refreshWorkspaceAccess(workspaceId){
  const workspace=await Workspace.findById(workspaceId);
  if(!workspace)return null;
  const access=accessForWorkspace(workspace);
  if(!access.allowed&&workspace.subscriptionStatus==='trialing'&&workspace.trialEndsAt&&workspace.trialEndsAt<=new Date()){
    workspace.subscriptionStatus='expired';
    await workspace.save();
    access.state='expired';
  }
  if(!access.allowed&&workspace.subscriptionStatus==='active'&&workspace.currentPeriodEnd&&workspace.currentPeriodEnd<=new Date()){
    workspace.subscriptionStatus='expired';
    await workspace.save();
    access.state='expired';
  }
  return {workspace,access};
}
