import express from 'express';
import mongoose from 'mongoose';
import {Contact} from '../models.js';
import {ChatAttribute} from '../chatModels.js';
import {encrypt} from '../utils/crypto.js';
import {validateAttributeKey,publicAttribute} from '../services/flowAttributes.js';

const r=express.Router();
const canConfigure=req=>['owner','admin'].includes(req.user?.role)||req.user?.isSuperAdmin;
const scopeOf=v=>['global','user'].includes(v)?v:null;
const cleanValue=v=>String(v??'').slice(0,2000);
const requireAdmin=(req,res)=>{if(canConfigure(req))return true;res.status(403).json({message:'Only owners and workspace admins can configure chatbot attributes'});return false};

r.get('/',async(req,res)=>{
  const scope=scopeOf(req.query.scope);
  if(!scope)return res.status(400).json({message:'Choose global or user attributes'});
  const docs=await ChatAttribute.find({workspaceId:req.workspaceId,scope}).select('+secretEncrypted').sort({createdAt:1}).lean();
  res.json({items:docs.map(publicAttribute),limit:50});
});

r.post('/',async(req,res)=>{
  if(!requireAdmin(req,res))return;
  const scope=scopeOf(req.body.scope);
  if(!scope)return res.status(400).json({message:'Choose global or user attributes'});
  try{
    const key=validateAttributeKey(req.body.key);
    const label=String(req.body.label||key).trim().slice(0,80);
    if(!label)return res.status(400).json({message:'Attribute label is required'});
    const count=await ChatAttribute.countDocuments({workspaceId:req.workspaceId,scope});
    if(count>=50)return res.status(409).json({message:'Maximum 50 '+scope+' attributes per workspace'});
    const isSecret=scope==='global'&&req.body.isSecret===true;
    const value=scope==='global'?cleanValue(req.body.value):'';
    const item=await ChatAttribute.create({
      workspaceId:req.workspaceId,scope,key,label,enabled:req.body.enabled!==false,
      isSecret,value:isSecret?'':value,secretEncrypted:isSecret?encrypt(value):''
    });
    const result=await ChatAttribute.findById(item._id).select('+secretEncrypted').lean();
    res.status(201).json(publicAttribute(result));
  }catch(e){res.status(e.code===11000?409:400).json({message:e.code===11000?'This attribute key already exists':e.message})}
});

r.put('/:id',async(req,res)=>{
  if(!requireAdmin(req,res))return;
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const item=await ChatAttribute.findOne({_id:req.params.id,workspaceId:req.workspaceId}).select('+secretEncrypted');
  if(!item)return res.sendStatus(404);
  if(req.body.key!==undefined&&req.body.key!==item.key)return res.status(400).json({message:'Attribute keys are immutable. Create a new attribute instead.'});
  if(req.body.scope!==undefined&&req.body.scope!==item.scope)return res.status(400).json({message:'Cannot change attribute scope'});
  const label=req.body.label!==undefined?String(req.body.label).trim().slice(0,80):item.label;
  if(!label)return res.status(400).json({message:'Attribute label is required'});
  item.label=label;
  if(req.body.enabled!==undefined)item.enabled=req.body.enabled===true;
  if(item.scope==='global'){
    const secret=req.body.isSecret===undefined?item.isSecret:req.body.isSecret===true;
    if(item.isSecret&&!secret&&req.body.value===undefined)
      return res.status(400).json({message:'Provide a replacement public value before changing a secret attribute'});
    const value=req.body.value===undefined?undefined:cleanValue(req.body.value);
    if(secret){
      if(value!==undefined)item.secretEncrypted=encrypt(value);
      item.value='';
    }else{
      if(value!==undefined)item.value=value;
      item.secretEncrypted='';
    }
    item.isSecret=secret;
  }
  await item.save();
  res.json(publicAttribute(item.toObject()));
});

r.delete('/:id',async(req,res)=>{
  if(!requireAdmin(req,res))return;
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const result=await ChatAttribute.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!result.deletedCount)return res.sendStatus(404);
  res.json({ok:true});
});

// Per-contact custom values are stored in the existing Contact.custom map,
// never in global attributes or another workspace's contact records.
r.get('/user-values/:contactId',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.contactId))return res.sendStatus(404);
  const contact=await Contact.findOne({_id:req.params.contactId,workspaceId:req.workspaceId}).select('_id name phone custom').lean();
  if(!contact)return res.sendStatus(404);
  const attrs=await ChatAttribute.find({workspaceId:req.workspaceId,scope:'user',enabled:true}).select('key').lean();
  const vals=contact.custom||{};
  const values=Object.fromEntries(attrs.map(a=>[a.key,String(vals instanceof Map?vals.get(a.key)||'':vals[a.key]||'')]));
  res.json({contact:{id:contact._id,name:contact.name,phone:contact.phone},values});
});

r.put('/user-values/:contactId',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.contactId))return res.sendStatus(404);
  const values=req.body.values;
  if(!values||typeof values!=='object'||Array.isArray(values))return res.status(400).json({message:'Send values as an object'});
  const keys=Object.keys(values);
  if(keys.length>50)return res.status(400).json({message:'Maximum 50 values'});
  const attrs=await ChatAttribute.find({workspaceId:req.workspaceId,scope:'user',enabled:true,key:{$in:keys}}).select('key').lean();
  if(attrs.length!==keys.length)return res.status(400).json({message:'One or more attributes are unavailable'});
  const contact=await Contact.findOne({_id:req.params.contactId,workspaceId:req.workspaceId});
  if(!contact)return res.sendStatus(404);
  for(const key of keys){
    const raw=String(values[key]??'');
    if(raw.length>2000)return res.status(400).json({message:key+' exceeds 2,000 characters'});
    if(raw)contact.custom.set(key,raw);
    else contact.custom.delete(key);
  }
  await contact.save();
  res.json({ok:true});
});

export default r;
