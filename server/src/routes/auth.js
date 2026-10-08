import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Workspace, Integration } from '../models.js';
import { requireAuth,isSuperAdmin } from '../middleware/auth.js';
import {createOtp,hashOtp,sendMetaOtp} from '../otp.js';
import {refreshWorkspaceAccess,planLimitsForWorkspace} from '../plan.js';

const router=express.Router();
const sessionSecret=()=>process.env.AUTH_KEY||process.env.JWT_SECRET;
const cookieOptions=()=>({
  httpOnly:true,
  secure:process.env.NODE_ENV==='production',
  sameSite:process.env.NODE_ENV==='production'?'none':'lax',
  maxAge:7*24*60*60*1000,
  path:'/'
});
const publicUser=user=>({
  id:user._id,name:user.name,email:user.email,role:user.role,
  phone:user.phone||'',jobTitle:user.jobTitle||'',avatarData:user.avatarData||'',
  twoFactorEnabled:!!user.twoFactorEnabled,isSuperAdmin:isSuperAdmin(user)
});
const sessionResponse=async user=>{
  const state=await refreshWorkspaceAccess(user.workspaceId);
  if(!state?.workspace)throw new Error('Workspace unavailable');
  const workspace=state.workspace;
  return {
    user:publicUser(user),
    workspace:{
      id:workspace._id,name:workspace.name,plan:workspace.plan||'trial',
      subscriptionStatus:workspace.subscriptionStatus||'trialing',
      trialStartedAt:workspace.trialStartedAt||workspace.createdAt,
      trialEndsAt:workspace.trialEndsAt||null,
      currentPeriodStart:workspace.currentPeriodStart||null,
      currentPeriodEnd:workspace.currentPeriodEnd||null,
      access:state.access,
      limits:await planLimitsForWorkspace(workspace)
    }
  };
};
const setCookie=(res,user)=>{
  const secret=sessionSecret();
  if(!secret) throw new Error('Authentication key is not configured');
  const token=jwt.sign({sub:user._id.toString(),workspaceId:user.workspaceId.toString(),type:'session'},secret,{expiresIn:'7d'});
  res.cookie('cc_session',token,cookieOptions());
};
const emailIsConfiguredSuperAdmin=email=>{
  const allowed=String(process.env.SUPER_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email||'').toLowerCase());
};

router.post('/register',async(req,res)=>{
  try{
    const name=String(req.body.name||'').trim();
    const email=String(req.body.email||'').trim().toLowerCase();
    const password=String(req.body.password||'');
    const workspaceName=String(req.body.workspaceName||'').trim();
    if(!name||!email||password.length<8) return res.status(400).json({message:'Name, email and password (8+ characters) are required'});
    if(await User.exists({email})) return res.status(409).json({message:'Email already registered'});
    const now=new Date();
    const workspace=await Workspace.create({
      name:workspaceName||name+"'s workspace",
      plan:'trial',
      subscriptionStatus:'trialing',
      trialStartedAt:now,
      trialEndsAt:new Date(now.getTime()+7*24*60*60*1000)
    });
    try{
      const user=await User.create({
        workspaceId:workspace._id,name,email,
        passwordHash:await bcrypt.hash(password,12),
        role:'owner',
        isSuperAdmin:emailIsConfiguredSuperAdmin(email)
      });
      await Integration.create({workspaceId:workspace._id,name:'Demo provider',provider:'demo',enabled:true,isDefault:true});
      setCookie(res,user);
      res.status(201).json(await sessionResponse(user));
    }catch(err){
      await Workspace.deleteOne({_id:workspace._id});
      throw err;
    }
  }catch(e){
    console.error(e);
    res.status(500).json({message:'Unable to create account'});
  }
});

router.post('/login',async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const user=await User.findOne({email});
  if(!user||!await bcrypt.compare(String(req.body.password||''),user.passwordHash)) return res.status(401).json({message:'Invalid email or password'});

  if(emailIsConfiguredSuperAdmin(user.email)&&!user.isSuperAdmin){
    user.isSuperAdmin=true;
    await user.save();
  }

  if(user.twoFactorEnabled){
    if(!user.twoFactorPhone||!user.twoFactorIntegrationId) return res.status(409).json({message:'2FA is enabled but its WhatsApp connection is unavailable. Contact your workspace admin'});
    const otp=createOtp();
    user.twoFactorOtpHash=hashOtp(otp);
    user.twoFactorOtpExpiresAt=new Date(Date.now()+5*60*1000);
    user.twoFactorOtpAttempts=0;
    await user.save();
    try{
      await sendMetaOtp({
        workspaceId:user.workspaceId,
        integrationId:user.twoFactorIntegrationId,
        phone:user.twoFactorPhone,
        otp
      });
    }catch(e){
      return res.status(502).json({message:'Unable to send WhatsApp OTP: '+e.message});
    }
    const challengeToken=jwt.sign(
      {sub:user._id.toString(),workspaceId:user.workspaceId.toString(),type:'2fa'},
      sessionSecret(),
      {expiresIn:'5m'}
    );
    return res.json({twoFactorRequired:true,challengeToken,maskedPhone:user.twoFactorPhone.replace(/.(?=.{4})/g,'•')});
  }

  setCookie(res,user);
  res.json(await sessionResponse(user));
});

router.post('/2fa/verify',async(req,res)=>{
  try{
    const payload=jwt.verify(String(req.body.challengeToken||''),sessionSecret());
    if(payload.type!=='2fa')throw new Error('Invalid challenge');
    const user=await User.findOne({_id:payload.sub,workspaceId:payload.workspaceId});
    if(!user)return res.status(401).json({message:'Account unavailable'});
    if(!user.twoFactorOtpHash||!user.twoFactorOtpExpiresAt||user.twoFactorOtpExpiresAt<new Date())return res.status(400).json({message:'OTP expired. Sign in again to request a new code'});
    if(user.twoFactorOtpAttempts>=5)return res.status(429).json({message:'Too many OTP attempts. Sign in again'});
    user.twoFactorOtpAttempts++;
    if(hashOtp(req.body.otp)!==user.twoFactorOtpHash){await user.save();return res.status(400).json({message:'Invalid OTP'})}
    user.twoFactorOtpHash='';
    user.twoFactorOtpExpiresAt=null;
    user.twoFactorOtpAttempts=0;
    await user.save();
    setCookie(res,user);
    res.json(await sessionResponse(user));
  }catch(e){
    res.status(401).json({message:'2FA challenge expired. Sign in again'});
  }
});

router.post('/logout',(req,res)=>{
  const opts=cookieOptions();
  delete opts.maxAge;
  res.clearCookie('cc_session',opts);
  res.json({ok:true});
});

router.post('/password',requireAuth,async(req,res)=>{
  const current=String(req.body.currentPassword||'');
  const next=String(req.body.newPassword||'');
  if(next.length<8) return res.status(400).json({message:'New password must be at least 8 characters'});
  const user=await User.findById(req.user._id);
  if(!user||!await bcrypt.compare(current,user.passwordHash)) return res.status(401).json({message:'Current password is incorrect'});
  user.passwordHash=await bcrypt.hash(next,12);
  await user.save();
  setCookie(res,user);
  res.json({ok:true});
});

router.get('/me',requireAuth,async(req,res)=>{
  const user=await User.findById(req.user._id);
  if(!user)return res.status(401).json({message:'Account unavailable'});
  res.json(await sessionResponse(user));
});

export default router;
