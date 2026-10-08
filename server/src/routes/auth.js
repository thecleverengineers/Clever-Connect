import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Workspace, Integration } from '../models.js';
import { requireAuth } from '../middleware/auth.js';

const router=express.Router();
const cookie=(res,user)=>{
  const token=jwt.sign({sub:user._id.toString(),workspaceId:user.workspaceId.toString()},(process.env.AUTH_KEY||process.env.JWT_SECRET),{expiresIn:'7d'});
  res.cookie('cc_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*24*60*60*1000,path:'/'});
};
router.post('/register',async(req,res)=>{
  const {name,email,password,workspaceName}=req.body;
  if(!name||!email||!password||password.length<8) return res.status(400).json({message:'Name, email and password (8+ characters) are required'});
  if(await User.exists({email:String(email).toLowerCase()})) return res.status(409).json({message:'Email already registered'});
  const workspace=await Workspace.create({name:workspaceName?.trim()||`${name}'s workspace`});
  const user=await User.create({workspaceId:workspace._id,name,email:String(email).toLowerCase(),passwordHash:await bcrypt.hash(password,12)});
  await Integration.create({workspaceId:workspace._id,provider:'demo',enabled:true}); cookie(res,user);
  res.status(201).json({user:{id:user._id,name:user.name,email:user.email,role:user.role},workspace:{id:workspace._id,name:workspace.name}});
});
router.post('/login',async(req,res)=>{
  const email=String(req.body.email||'').toLowerCase(); const user=await User.findOne({email});
  if(!user||!await bcrypt.compare(req.body.password||'',user.passwordHash)) return res.status(401).json({message:'Invalid email or password'});
  cookie(res,user); const workspace=await Workspace.findById(user.workspaceId).lean();
  res.json({user:{id:user._id,name:user.name,email:user.email,role:user.role},workspace:{id:workspace._id,name:workspace.name}});
});
router.post('/logout',(req,res)=>{res.clearCookie('cc_session',{path:'/'});res.json({ok:true});});
router.get('/me',requireAuth,async(req,res)=>{const w=await Workspace.findById(req.workspaceId).lean();res.json({user:{id:req.user._id,name:req.user.name,email:req.user.email,role:req.user.role},workspace:{id:w._id,name:w.name}})});
export default router;
