import jwt from 'jsonwebtoken';
import { User } from '../models.js';

export async function requireAuth(req,res,next){
  try{
    const token=req.cookies.cc_session;
    if(!token) return res.status(401).json({message:'Authentication required'});
    const payload=jwt.verify(token,(process.env.AUTH_KEY||process.env.JWT_SECRET));
    const user=await User.findById(payload.sub).lean();
    if(!user) return res.status(401).json({message:'Session expired'});
    req.user=user; req.workspaceId=user.workspaceId; next();
  }catch{ return res.status(401).json({message:'Session expired'}); }
}
