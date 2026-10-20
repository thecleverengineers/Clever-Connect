import {SubscriptionPlan,Workspace,Integration} from './models.js';

export const TRIAL_LIMITS={metaConnections:1,teamMembers:3,monthlyMessages:1000};

export async function planLimitsForWorkspace(workspace){
  if(!workspace)return TRIAL_LIMITS;
  if(workspace.subscriptionPlanId){
    const p=await SubscriptionPlan.findOne({_id:workspace.subscriptionPlanId}).lean();
    if(p)return {metaConnections:p.metaConnections,teamMembers:p.teamMembers,monthlyMessages:p.monthlyMessages};
  }
  if(workspace.plan&&workspace.plan!=='trial'){
    const p=await SubscriptionPlan.findOne({slug:workspace.plan}).lean();
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

/**
 * Slots are assigned deterministically: oldest connected Meta profiles first.
 * Downgrading never deletes credentials or history. Disabled profiles still
 * occupy a slot until the tenant disconnects them.
 */
export function entitledMetaIds(profiles,maxConnections){
  const count=Math.max(0,Math.floor(Number(maxConnections)||0));
  return [...profiles].sort((a,b)=>{
    const timeA=Date.parse(a.createdAt||0)||0;
    const timeB=Date.parse(b.createdAt||0)||0;
    return timeA-timeB||String(a._id).localeCompare(String(b._id));
  }).slice(0,count).map(x=>String(x._id));
}

export async function metaEntitlements(workspace){
  const {metaConnections}=await planLimitsForWorkspace(workspace);
  const profiles=await Integration.find({workspaceId:workspace._id,provider:'meta'})
    .select('_id createdAt').lean();
  const allowedIds=entitledMetaIds(profiles,metaConnections);
  return {max:metaConnections,used:profiles.length,allowedIds};
}

export async function requireMetaSenderEntitlement(workspaceId,profileId){
  const workspace=await Workspace.findById(workspaceId).lean();
  if(!accessForWorkspace(workspace).allowed)throw new Error('An active subscription is required to send WhatsApp messages');
  const entitled=await metaEntitlements(workspace);
  if(!entitled.allowedIds.includes(String(profileId))){
    throw new Error('This WhatsApp number is beyond your subscription connection limit. Upgrade or disconnect another number.');
  }
  return entitled;
}
