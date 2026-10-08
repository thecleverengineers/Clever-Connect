import express from 'express';
import mongoose from 'mongoose';
import {Template,Integration} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {decrypt} from '../utils/crypto.js';
import {refreshWorkspaceAccess} from '../plan.js';

const r=express.Router();
r.use(requireAuth);

const clean=body=>({
  name:String(body.name||'').trim(),
  body:String(body.body||'').trim(),
  metaTemplateName:String(body.metaTemplateName||'').trim(),
  language:String(body.language||'en_US').trim(),
  category:['MARKETING','UTILITY','AUTHENTICATION'].includes(body.category)?body.category:'MARKETING'
});

async function requireAccess(workspaceId,res){
  const x=await refreshWorkspaceAccess(workspaceId);
  if(!x?.access?.allowed){
    res.status(402).json({message:'An active subscription or valid trial is required to manage Meta templates'});
    return null;
  }
  return x;
}

async function metaConnection(workspaceId,id){
  if(!mongoose.isValidObjectId(id))return null;
  return Integration.findOne({_id:id,workspaceId,provider:'meta'}).lean();
}

function metaName(v=''){
  return String(v).trim().toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,512);
}
function bodyExamples(body,examples){
  const matches=[...String(body).matchAll(/{{(\d+)}}/g)].map(x=>Number(x[1]));
  if(!matches.length)return null;
  const max=Math.max(...matches);
  const values=(Array.isArray(examples)?examples:String(examples||'').split(',')).map(x=>String(x).trim()).filter(Boolean);
  if(values.length<max)throw new Error('Add example values for every Meta template variable');
  return {body_text:[values.slice(0,max)]};
}
function metaPayload(data,examples){
  const name=metaName(data.metaTemplateName||data.name);
  if(!name)throw new Error('Meta template name is required');
  if(data.category==='AUTHENTICATION'){
    return {
      name,language:data.language,category:'AUTHENTICATION',
      components:[
        {type:'BODY',add_security_recommendation:true},
        {type:'FOOTER',code_expiration_minutes:10},
        {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy Code'}]}
      ]
    };
  }
  const body={type:'BODY',text:data.body};
  const example=bodyExamples(data.body,examples);
  if(example)body.example=example;
  return {name,language:data.language,category:data.category,components:[body]};
}

async function graph(connection,path,{method='GET',body}={}){
  if(!connection.businessAccountId)throw new Error('WhatsApp Business Account ID is required for Meta template management');
  if(!connection.accessTokenEncrypted)throw new Error('Meta access token is missing');
  const token=decrypt(connection.accessTokenEncrypted);
  const version=connection.graphVersion||'v23.0';
  const response=await fetch('https://graph.facebook.com/'+version+'/'+path,{
    method,
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||'Meta template request failed');
  return data;
}

async function upsertRemote(workspaceId,integrationId,row){
  const bodyComp=(row.components||[]).find(x=>x.type==='BODY');
  const local=await Template.findOneAndUpdate(
    {workspaceId,integrationId,metaTemplateId:String(row.id||'')},
    {$set:{
      name:row.name||'meta_template',
      body:bodyComp?.text||row.name||'Meta template',
      metaTemplateName:row.name||'',
      metaTemplateId:String(row.id||''),
      metaStatus:String(row.status||'UNKNOWN').toUpperCase(),
      metaRejectedReason:row.rejected_reason||'',
      metaQualityScore:row.quality_score?.score||row.quality_score||'',
      metaLastSyncedAt:new Date(),
      language:row.language||'en_US',
      category:String(row.category||'MARKETING').toUpperCase()
    }},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
  return local;
}

r.get('/',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.integrationId&&mongoose.isValidObjectId(req.query.integrationId))q.integrationId=req.query.integrationId;
  res.json(await Template.find(q).sort({updatedAt:-1}).populate('integrationId','name displayPhoneNumber phoneNumberId').lean());
});

r.post('/',async(req,res)=>{
  try{
    const data=clean(req.body);
    if(!data.name||!data.body)return res.status(400).json({message:'Template name and message body are required'});
    const integrationId=mongoose.isValidObjectId(req.body.integrationId)?req.body.integrationId:null;
    res.status(201).json(await Template.create({...data,workspaceId:req.workspaceId,integrationId,metaStatus:'LOCAL'}));
  }catch(e){res.status(400).json({message:e.code===11000?'Template already exists for this Meta profile':e.message})}
});

r.post('/meta/:integrationId',async(req,res)=>{
  try{
    if(!await requireAccess(req.workspaceId,res))return;
    const connection=await metaConnection(req.workspaceId,req.params.integrationId);
    if(!connection)return res.status(404).json({message:'Meta WhatsApp profile not found'});
    const data=clean(req.body);
    if(!data.name||(!data.body&&data.category!=='AUTHENTICATION'))return res.status(400).json({message:'Template name and body are required'});
    const payload=metaPayload(data,req.body.bodyExamples);
    const remote=await graph(connection,connection.businessAccountId+'/message_templates',{method:'POST',body:payload});
    const row=await Template.create({
      workspaceId:req.workspaceId,
      integrationId:connection._id,
      name:data.name,
      body:data.category==='AUTHENTICATION'?'Authentication OTP':data.body,
      metaTemplateName:payload.name,
      metaTemplateId:String(remote.id||''),
      metaStatus:String(remote.status||'PENDING').toUpperCase(),
      metaLastSyncedAt:new Date(),
      language:data.language,
      category:data.category
    });
    res.status(201).json(await row.populate('integrationId','name displayPhoneNumber phoneNumberId'));
  }catch(e){res.status(502).json({message:e.code===11000?'This Meta template already exists for the selected profile':e.message})}
});

r.post('/meta/:integrationId/sync',async(req,res)=>{
  try{
    if(!await requireAccess(req.workspaceId,res))return;
    const connection=await metaConnection(req.workspaceId,req.params.integrationId);
    if(!connection)return res.status(404).json({message:'Meta WhatsApp profile not found'});
    const data=await graph(connection,connection.businessAccountId+'/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=250');
    const synced=[];
    for(const row of data.data||[])synced.push(await upsertRemote(req.workspaceId,connection._id,row));
    res.json({synced:synced.length,templates:await Template.find({workspaceId:req.workspaceId,integrationId:connection._id}).populate('integrationId','name displayPhoneNumber phoneNumberId').lean()});
  }catch(e){res.status(502).json({message:e.message})}
});

r.delete('/meta/:id',async(req,res)=>{
  try{
    if(!await requireAccess(req.workspaceId,res))return;
    const row=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
    if(!row)return res.sendStatus(404);
    if(!row.integrationId||!row.metaTemplateName)return res.status(409).json({message:'This is not a Meta-linked template'});
    const connection=await metaConnection(req.workspaceId,row.integrationId);
    if(!connection)return res.status(404).json({message:'Connected Meta profile not found'});
    const suffix='?name='+encodeURIComponent(row.metaTemplateName)+(row.metaTemplateId?'&hsm_id='+encodeURIComponent(row.metaTemplateId):'');
    await graph(connection,connection.businessAccountId+'/message_templates'+suffix,{method:'DELETE'});
    await Template.deleteOne({_id:row._id});
    res.json({ok:true});
  }catch(e){res.status(502).json({message:e.message})}
});

r.put('/:id',async(req,res)=>{
  try{
    const data=clean(req.body);
    if(!data.name||!data.body)return res.status(400).json({message:'Template name and message body are required'});
    const x=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId});
    if(!x)return res.sendStatus(404);
    if(x.metaTemplateId)return res.status(409).json({message:'Meta-submitted templates must be managed through the selected Meta profile and synced from Meta'});
    Object.assign(x,data);await x.save();res.json(x);
  }catch(e){res.status(400).json({message:e.code===11000?'Template already exists for this Meta profile':e.message})}
});

r.delete('/:id',async(req,res)=>{
  const row=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
  if(!row)return res.sendStatus(404);
  if(row.metaTemplateId)return res.status(409).json({message:'Use Delete from Meta for a submitted Meta template'});
  await Template.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});

export default r;
