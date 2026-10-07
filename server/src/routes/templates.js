import express from 'express'; import {Template} from '../models.js'; import {requireAuth} from '../middleware/auth.js';
const r=express.Router();r.use(requireAuth);
r.get('/',async(req,res)=>res.json(await Template.find({workspaceId:req.workspaceId}).sort({updatedAt:-1}).lean()));
r.post('/',async(req,res)=>{try{res.status(201).json(await Template.create({...req.body,workspaceId:req.workspaceId}))}catch(e){res.status(400).json({message:e.code===11000?'Template name already exists':e.message})}});
r.put('/:id',async(req,res)=>{const x=await Template.findOneAndUpdate({_id:req.params.id,workspaceId:req.workspaceId},{$set:req.body},{new:true,runValidators:true});if(!x)return res.sendStatus(404);res.json(x)});
r.delete('/:id',async(req,res)=>{await Template.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});res.json({ok:true})});export default r;
