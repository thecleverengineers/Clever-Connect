import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Workspace, Integration } from '../models.js';
import { requireAuth } from '../middleware/auth.js';

const router=express.Router();
const sessionSecret=()=>process.env.AUTH_KEY||process.env.JWT_SECRET;
const cookieOptions=()=>({
  httpOnly:true,
  secure:process.env.NODE_ENV==='production',
  sameSite:process.env.NODE_ENV==='production'?'none':'lax',
  maxAge:7*24*60*60*1000,
  path:'/'
});

const setCookie=(res,user)=>{
  const secret=sessionSecret();
  if(!secret) throw new Error('Authentication key is not configured');
  const token=jwt.sign({sub:user._id.toString(),workspaceId:user.workspaceId.toString()},secret,{expiresIn:'7d'});
  res.cookie('cc_session',token,cookieOptions());
};

router.post('/register',async(req,res)=>{
  try{
    const name=String(req.body.name||'').trim();
    const email=String(req.body.email||'').trim().toLowerCase();
    const password=String(req.body.password||'');
    const workspaceName=String(req.body.workspaceName||'').trim();
    if(!name||!email||password.length<8) return res.status(400).json({message:'Name, email and password (8+ characters) are required'});
    if(await User.exists({email})) return res.status(409).json({message:'Email already registered'});
    const workspace=await Workspace.create({name:workspaceName||name+"'s workspace"});
    try{
      const user=await User.create({workspaceId:workspace._id,name,email,passwordHash:await bcrypt.hash(password,12)});
      await Integration.create({workspaceId:workspace._id,provider:'demo',enabled:true});
      setCookie(res,user);
      res.status(201).json({user:{id:user._id,name:user.name,email:user.email,role:user.role},workspace:{id:workspace._id,name:workspace.name}});
    }catch(err){
      await Workspace.deleteOne({_id:workspace._id});
      throw err;
    }
  }catch(e){
    res.status(500).json({message:'Unable to create account'});
  }
});

router.post('/login',async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const user=await User.findOne({email});
  if(!user||!await bcrypt.compare(String(req.body.password||''),user.passwordHash)) return res.status(401).json({message:'Invalid email or password'});
  setCookie(res,user);
  const workspace=await Workspace.findById(user.workspaceId).lean();
  res.json({user:{id:user._id,name:user.name,email:user.email,role:user.role},workspace:{id:workspace._id,name:workspace.name}});
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
  const w=await Workspace.findById(req.workspaceId).lean();
  if(!w) return res.status(401).json({message:'Workspace unavailable'});
  res.json({user:{id:req.user._id,name:req.user.name,email:req.user.email,role:req.user.role},workspace:{id:w._id,name:w.name}});
});

export default router;
