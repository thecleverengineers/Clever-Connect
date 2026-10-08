import express from 'express';
import mongoose from 'mongoose';
import {Integration} from '../models.js';
import {ChatFlow} from '../chatModels.js';
import {validateFlow} from '../services/liveChat.js';

const r=express.Router();
r.get('/',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.integrationId&&mongoose.isValidObjectId(req.query.integrationId))q.integrationId=req.query.integrationId;
  res.json(await ChatFlow.find(q).sort({createdAt:-1}).lean());
});
async function write(req,res,flow=null){
  try{
    if(!['owner','admin'].includes(req.user.role)&&!req.user.isSuperAdmin){
      return res.status(403).json({message:'Only workspace owners/admins can configure chatbots'});
    }
    const normalized=validateFlow(req.body);
    const integrationId=String(req.body.integrationId||flow?.integrationId||'');
    if(!mongoose.isValidObjectId(integrationId))return res.status(400).json({message:'Choose a Meta WhatsApp profile'});
    const i=await Integration.findOne({_id:integrationId,workspaceId:req.workspaceId,provider:'meta',enabled:true}).select('_id').lean();
    if(!i)return res.status(404).json({message:'Connected Meta WhatsApp profile not found'});
    if(flow){
      Object.assign(flow,{...normalized,integrationId:i._id});
      await flow.save();
      return res.json(flow);
    }
    res.status(201).json(await ChatFlow.create({...normalized,integrationId:i._id,workspaceId:req.workspaceId}));
  }catch(e){res.status(400).json({message:e.message})}
}
r.post('/',async(req,res)=>write(req,res));
r.put('/:id',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const flow=await ChatFlow.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!flow)return res.sendStatus(404);
  await write(req,res,flow);
});
r.delete('/:id',async(req,res)=>{
  if(!['owner','admin'].includes(req.user.role)&&!req.user.isSuperAdmin)return res.sendStatus(403);
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  await ChatFlow.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});
export default r;
