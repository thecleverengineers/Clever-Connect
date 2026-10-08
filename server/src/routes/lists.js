import express from 'express';
import { ContactList,Contact } from '../models.js';
import {requireAuth} from '../middleware/auth.js';

const r=express.Router();
r.use(requireAuth);

r.get('/',async(req,res)=>{
  const rows=await ContactList.aggregate([
    {$match:{workspaceId:req.workspaceId}},
    {$lookup:{from:'contacts',let:{id:'$_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$workspaceId',req.workspaceId]},{$in:['$$id','$lists']}]}}}],as:'contacts'}},
    {$addFields:{contactCount:{$size:'$contacts'}}},
    {$project:{contacts:0}},
    {$sort:{updatedAt:-1}}
  ]);
  res.json(rows);
});

r.post('/',async(req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!name) return res.status(400).json({message:'List name is required'});
  try{
    res.status(201).json(await ContactList.create({workspaceId:req.workspaceId,name,description:String(req.body.description||'').trim()}));
  }catch(e){res.status(409).json({message:'List name already exists'})}
});

r.put('/:id',async(req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!name) return res.status(400).json({message:'List name is required'});
  try{
    const row=await ContactList.findOneAndUpdate(
      {_id:req.params.id,workspaceId:req.workspaceId},
      {$set:{name,description:String(req.body.description||'').trim()}},
      {new:true,runValidators:true}
    );
    if(!row) return res.sendStatus(404);
    res.json(row);
  }catch(e){res.status(409).json({message:'List name already exists'})}
});

r.delete('/:id',async(req,res)=>{
  await Contact.updateMany({workspaceId:req.workspaceId,lists:req.params.id},{$pull:{lists:req.params.id}});
  await ContactList.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});

export default r;
