import express from 'express';
import {Template} from '../models.js';
import {requireAuth} from '../middleware/auth.js';

const r=express.Router();
r.use(requireAuth);

const clean=body=>({
  name:String(body.name||'').trim(),
  body:String(body.body||'').trim(),
  metaTemplateName:String(body.metaTemplateName||'').trim(),
  language:String(body.language||'en_US').trim(),
  category:['MARKETING','UTILITY','AUTHENTICATION'].includes(body.category)?body.category:'MARKETING'
});

r.get('/',async(req,res)=>res.json(await Template.find({workspaceId:req.workspaceId}).sort({updatedAt:-1}).lean()));

r.post('/',async(req,res)=>{
  try{
    const data=clean(req.body);
    if(!data.name||!data.body) return res.status(400).json({message:'Template name and message body are required'});
    res.status(201).json(await Template.create({...data,workspaceId:req.workspaceId}));
  }catch(e){res.status(400).json({message:e.code===11000?'Template name already exists':e.message})}
});

r.put('/:id',async(req,res)=>{
  try{
    const data=clean(req.body);
    if(!data.name||!data.body) return res.status(400).json({message:'Template name and message body are required'});
    const x=await Template.findOneAndUpdate(
      {_id:req.params.id,workspaceId:req.workspaceId},
      {$set:data},
      {new:true,runValidators:true}
    );
    if(!x)return res.sendStatus(404);
    res.json(x);
  }catch(e){res.status(400).json({message:e.code===11000?'Template name already exists':e.message})}
});

r.delete('/:id',async(req,res)=>{
  await Template.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});

export default r;
