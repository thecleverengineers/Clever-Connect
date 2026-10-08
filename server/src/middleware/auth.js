import jwt from 'jsonwebtoken';
import { User } from '../models.js';
import {refreshWorkspaceAccess} from '../plan.js';

export async function requireAuth(req,res,next){
  try{
    const token=req.cookies.cc_session;
    if(!token) return res.status(401).json({message:'Authentication required'});
    const payload=jwt.verify(token,(process.env.AUTH_KEY||process.env.JWT_SECRET));
    if(payload.type&&payload.type!=='session') return res.status(401).json({message:'Session expired'});
    const user=await User.findById(payload.sub).lean();
    if(!user) return res.status(401).json({message:'Session expired'});
    req.user=user;
    req.workspaceId=user.workspaceId;
    next();
  }catch{
    return res.status(401).json({message:'Session expired'});
  }
}

export async function requireSubscription(req,res,next){
  try{
    const result=await refreshWorkspaceAccess(req.workspaceId);
    if(!result?.workspace)return res.status(404).json({message:'Workspace unavailable'});
    req.workspace=result.workspace;
    req.subscriptionAccess=result.access;
    if(!result.access.allowed){
      return res.status(402).json({
        code:'SUBSCRIPTION_REQUIRED',
        message:result.access.reason||'Subscription required',
        access:result.access
      });
    }
    next();
  }catch(e){
    next(e);
  }
}

export function isSuperAdmin(user){
  if(user?.isSuperAdmin)return true;
  const allowed=String(process.env.SUPER_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(user?.email||'').toLowerCase());
}

export function requireSuperAdmin(req,res,next){
  if(!isSuperAdmin(req.user))return res.status(403).json({message:'Super Admin access required'});
  next();
}
