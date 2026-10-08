import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {User,Workspace,Integration} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {planLimitsForWorkspace,accessForWorkspace} from '../plan.js';
import {createOtp,hashOtp,normalizePhone,sendMetaOtp} from '../otp.js';

const r=express.Router();
r.use(requireAuth);

const publicUser=u=>({
  id:u._id,
  name:u.name,
  email:u.email,
  role:u.role,
  phone:u.phone||'',
  jobTitle:u.jobTitle||'',
  avatarData:u.avatarData||'',
  twoFactorEnabled:!!u.twoFactorEnabled,
  twoFactorPhone:u.twoFactorPhone||'',
  twoFactorIntegrationId:u.twoFactorIntegrationId||null
});

async function workspaceSummary(workspaceId){
  const w=await Workspace.findById(workspaceId).lean();
  if(!w) throw new Error('Workspace unavailable');
  const limits=await planLimitsForWorkspace(w);
  const [teamCount,metaConnections]=await Promise.all([
    User.countDocuments({workspaceId}),
    Integration.countDocuments({workspaceId,provider:'meta'})
  ]);
  return {
    id:w._id,name:w.name,plan:w.plan||'trial',
    subscriptionPlanId:w.subscriptionPlanId||null,
    subscriptionStatus:w.subscriptionStatus||'trialing',
    trialStartedAt:w.trialStartedAt||null,
    trialEndsAt:w.trialEndsAt||null,
    currentPeriodStart:w.currentPeriodStart||null,
    currentPeriodEnd:w.currentPeriodEnd||null,
    access:accessForWorkspace(w),
    limits,usage:{teamMembers:teamCount,metaConnections}
  };
}
const canManage=u=>['owner','admin'].includes(u.role);

r.get('/profile',async(req,res)=>{
  const u=await User.findById(req.user._id).lean();
  const workspace=await workspaceSummary(req.workspaceId);
  res.json({user:publicUser(u),workspace});
});

r.put('/profile',async(req,res)=>{
  const update={};
  if(req.body.name!==undefined){
    const name=String(req.body.name||'').trim();
    if(!name)return res.status(400).json({message:'Name is required'});
    update.name=name;
  }
  if(req.body.phone!==undefined){
    const phone=req.body.phone?normalizePhone(req.body.phone):'';
    if(req.body.phone&&!phone)return res.status(400).json({message:'Enter a valid phone number'});
    update.phone=phone;
  }
  if(req.body.jobTitle!==undefined) update.jobTitle=String(req.body.jobTitle||'').trim().slice(0,100);
  if(req.body.avatarData!==undefined){
    const avatar=String(req.body.avatarData||'');
    if(avatar&&(!avatar.startsWith('data:image/')||avatar.length>500000)) return res.status(400).json({message:'Profile image must be an image under 350 KB'});
    update.avatarData=avatar;
  }
  const u=await User.findOneAndUpdate({_id:req.user._id,workspaceId:req.workspaceId},{$set:update},{new:true,runValidators:true});
  res.json({user:publicUser(u),workspace:await workspaceSummary(req.workspaceId)});
});

r.get('/workspace',async(req,res)=>res.json(await workspaceSummary(req.workspaceId)));

r.put('/workspace',async(req,res)=>{
  if(!canManage(req.user))return res.status(403).json({message:'Only workspace owners or admins can edit the workspace'});
  const name=String(req.body.name||'').trim();
  if(!name)return res.status(400).json({message:'Workspace name is required'});
  await Workspace.updateOne({_id:req.workspaceId},{$set:{name}});
  res.json(await workspaceSummary(req.workspaceId));
});

r.get('/team',async(req,res)=>{
  const rows=await User.find({workspaceId:req.workspaceId}).sort({createdAt:1}).lean();
  res.json({members:rows.map(publicUser),workspace:await workspaceSummary(req.workspaceId)});
});

r.post('/team',async(req,res)=>{
  if(!canManage(req.user))return res.status(403).json({message:'Only workspace owners or admins can add team members'});
  const workspace=await Workspace.findById(req.workspaceId).lean();
  const limits=await planLimitsForWorkspace(workspace);
  const count=await User.countDocuments({workspaceId:req.workspaceId});
  if(count>=limits.teamMembers)return res.status(409).json({message:'Your current WA SANTA access allows '+limits.teamMembers+' team members'});
  const name=String(req.body.name||'').trim();
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.temporaryPassword||'');
  const role=['admin','member'].includes(req.body.role)?req.body.role:'member';
  if(!name||!email||password.length<8)return res.status(400).json({message:'Name, email and temporary password (8+ characters) are required'});
  if(await User.exists({email}))return res.status(409).json({message:'Email is already registered'});
  const u=await User.create({workspaceId:req.workspaceId,name,email,passwordHash:await bcrypt.hash(password,12),role});
  res.status(201).json(publicUser(u));
});

r.put('/team/:id',async(req,res)=>{
  if(!canManage(req.user))return res.status(403).json({message:'Only workspace owners or admins can update team roles'});
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const target=await User.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!target)return res.sendStatus(404);
  if(target.role==='owner')return res.status(409).json({message:'The workspace owner role cannot be changed here'});
  const role=['admin','member'].includes(req.body.role)?req.body.role:null;
  if(!role)return res.status(400).json({message:'Choose admin or member'});
  target.role=role;await target.save();
  res.json(publicUser(target));
});

r.delete('/team/:id',async(req,res)=>{
  if(!canManage(req.user))return res.status(403).json({message:'Only workspace owners or admins can remove team members'});
  if(String(req.params.id)===String(req.user._id))return res.status(409).json({message:'You cannot remove your own account'});
  const target=await User.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!target)return res.sendStatus(404);
  if(target.role==='owner')return res.status(409).json({message:'The workspace owner cannot be removed'});
  await target.deleteOne();
  res.json({ok:true});
});

r.post('/security/2fa/send-setup',async(req,res)=>{
  const phone=normalizePhone(req.body.phone);
  if(!phone)return res.status(400).json({message:'Enter a valid WhatsApp phone number'});
  if(!mongoose.isValidObjectId(req.body.integrationId))return res.status(400).json({message:'Choose a Meta WhatsApp connection'});
  const otp=createOtp();
  const u=await User.findById(req.user._id);
  u.twoFactorPhone=phone;
  u.twoFactorIntegrationId=req.body.integrationId;
  u.twoFactorOtpHash=hashOtp(otp);
  u.twoFactorOtpExpiresAt=new Date(Date.now()+5*60*1000);
  u.twoFactorOtpAttempts=0;
  await u.save();
  try{
    await sendMetaOtp({workspaceId:req.workspaceId,integrationId:req.body.integrationId,phone,otp});
    res.json({ok:true,expiresIn:300});
  }catch(e){
    u.twoFactorOtpHash='';u.twoFactorOtpExpiresAt=null;await u.save();
    res.status(502).json({message:e.message});
  }
});

r.post('/security/2fa/confirm',async(req,res)=>{
  const u=await User.findById(req.user._id);
  if(!u.twoFactorOtpHash||!u.twoFactorOtpExpiresAt||u.twoFactorOtpExpiresAt<new Date())return res.status(400).json({message:'OTP expired. Request a new code'});
  if(u.twoFactorOtpAttempts>=5)return res.status(429).json({message:'Too many attempts. Request a new OTP'});
  u.twoFactorOtpAttempts++;
  if(hashOtp(req.body.otp)!==u.twoFactorOtpHash){await u.save();return res.status(400).json({message:'Invalid OTP'})}
  u.twoFactorEnabled=true;
  u.twoFactorOtpHash='';
  u.twoFactorOtpExpiresAt=null;
  u.twoFactorOtpAttempts=0;
  await u.save();
  res.json({ok:true,user:publicUser(u)});
});

r.post('/security/2fa/disable',async(req,res)=>{
  const u=await User.findById(req.user._id);
  if(!await bcrypt.compare(String(req.body.currentPassword||''),u.passwordHash))return res.status(401).json({message:'Current password is incorrect'});
  u.twoFactorEnabled=false;
  u.twoFactorOtpHash='';
  u.twoFactorOtpExpiresAt=null;
  await u.save();
  res.json({ok:true,user:publicUser(u)});
});

export default r;
