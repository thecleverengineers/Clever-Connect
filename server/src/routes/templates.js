import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import {Template,Integration} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {decrypt} from '../utils/crypto.js';
import {getMetaConfig} from '../metaConfig.js';
import {refreshWorkspaceAccess,requireMetaSenderEntitlement} from '../plan.js';
import {
  normalizeTemplate,createMetaTemplatePayload,remoteTemplateFields,
  recommendTemplate,draftRecommendation
} from '../services/metaTemplateManager.js';

const r=express.Router();
r.use(requireAuth);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:1}});
const validId=id=>mongoose.isValidObjectId(id);
const cleanError=e=>String(e?.message||'Meta template request failed').slice(0,400);
async function requireAccess(req,res){
  const x=await refreshWorkspaceAccess(req.workspaceId);
  if(x?.access?.allowed)return true;
  res.status(402).json({message:'Active subscription or trial required'});
  return false;
}
async function metaConnection(req,id){
  if(!validId(id))return null;
  const x=await Integration.findOne({_id:id,workspaceId:req.workspaceId,provider:'meta',enabled:true}).lean();
  if(!x)return null;
  await requireMetaSenderEntitlement(req.workspaceId,x._id);
  return x;
}
async function graph(connection,path,{method='GET',body}={}){
  if(!connection.businessAccountId||!connection.accessTokenEncrypted)
    throw new Error('Meta WABA or token is missing from the WhatsApp connection');
  const response=await fetch('https://graph.facebook.com/'+(connection.graphVersion||'v23.0')+'/'+path,{
    method,headers:{Authorization:'Bearer '+decrypt(connection.accessTokenEncrypted),
      ...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(25000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data?.error?.error_user_msg||data?.error?.message||'Meta template request failed');
    error.providerCode=data?.error?.code;
    throw error;
  }
  return data;
}
const publicConnectionFields='name displayPhoneNumber phoneNumberId';
async function upsertRemote(req,connection,row){
  if(!row?.name||!row?.id||!row?.language)return null;
  const key={workspaceId:req.workspaceId,integrationId:connection._id,
    metaTemplateName:row.name,language:row.language};
  const fields=remoteTemplateFields(row);
  const matched=await Template.findOne(key);
  // A draft with the same name/language becomes the synced submitted record.
  const local=await Template.findOneAndUpdate(
    matched?{_id:matched._id,workspaceId:req.workspaceId}:key,
    {$set:{...fields,metaTemplateId:String(row.id)}},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
  return local;
}

r.get('/',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.integrationId&&validId(req.query.integrationId))q.integrationId=req.query.integrationId;
  res.json(await Template.find(q).sort({updatedAt:-1}).populate('integrationId',publicConnectionFields).lean());
});

r.get('/recommend',async(req,res)=>{
  try{
    const query=String(req.query.q||'').trim().slice(0,160);
    if(!query)return res.json({matches:[],suggestedDraft:null});
    const integrationId=String(req.query.integrationId||'');
    if(!validId(integrationId))return res.status(400).json({message:'Choose WhatsApp sender first'});
    const existing=await Template.find({workspaceId:req.workspaceId,integrationId,
      metaStatus:'APPROVED',category:{$ne:'AUTHENTICATION'}}).lean();
    const matches=recommendTemplate(existing,query).map(x=>({
      id:x._id,name:x.name,body:x.body,category:x.category,matchScore:x.matchScore
    }));
    res.json({matches,suggestedDraft:matches.length?null:draftRecommendation(query,'UTILITY')});
  }catch(e){res.status(400).json({message:cleanError(e)})}
});

r.post('/',async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    const d=normalizeTemplate(req.body);
    const id=req.body.integrationId;
    const integration=await metaConnection(req,id);
    if(!integration)return res.status(400).json({message:'Select a connected Meta WhatsApp number'});
    const row=await Template.create({
      ...d,workspaceId:req.workspaceId,integrationId:integration._id,
      metaStatus:'DRAFT',metaTemplateId:'',metaRejectedReason:''
    });
    res.status(201).json(row);
  }catch(e){res.status(e.code===11000?409:400).json({message:e.code===11000?'A template with this name and language already exists on the selected account':cleanError(e)})}
});

r.put('/:id',async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    if(!validId(req.params.id))return res.sendStatus(404);
    const x=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId});
    if(!x)return res.sendStatus(404);
    if(!['DRAFT','LOCAL','REJECTED'].includes(x.metaStatus))
      return res.status(409).json({message:'Only drafts or rejected templates can be edited. Create a new version for approved/pending templates.'});
    const d=normalizeTemplate(req.body);
    if(x.metaTemplateId&&
      (d.metaTemplateName!==x.metaTemplateName||d.language!==x.language||d.category!==x.category))
      return res.status(409).json({message:'A rejected Meta template cannot change its name, language or category. Create a new draft instead.'});
    const integrationId=String(x.integrationId||'');
    if(!await metaConnection(req,integrationId))return res.status(409).json({message:'WhatsApp sender is unavailable'});
    Object.assign(x,d);
    await x.save();
    res.json(x);
  }catch(e){res.status(e.code===11000?409:400).json({message:cleanError(e)})}
});

async function submit(req,res,resubmission=false){
  try{
    if(!await requireAccess(req,res))return;
    if(!validId(req.params.id))return res.sendStatus(404);
    const row=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId});
    if(!row)return res.sendStatus(404);
    if(resubmission?row.metaStatus!=='REJECTED'||!row.metaTemplateId:
      !['DRAFT','LOCAL'].includes(row.metaStatus)||!!row.metaTemplateId)
      return res.status(409).json({message:'This template cannot be submitted in its current Meta status'});
    const connection=await metaConnection(req,row.integrationId);
    if(!connection)return res.status(409).json({message:'Connected WhatsApp account is unavailable'});
    const payload=createMetaTemplatePayload(row.toObject());
    const remote=resubmission
      ?await graph(connection,row.metaTemplateId,{method:'POST',
        body:{category:payload.category,components:payload.components}})
      :await graph(connection,connection.businessAccountId+'/message_templates',{method:'POST',body:payload});
    row.metaTemplateName=payload.name;
    if(!resubmission)row.metaTemplateId=String(remote.id||'');
    row.metaStatus=String(remote.status||'PENDING').toUpperCase();
    row.metaRejectedReason='';
    row.metaLastSyncedAt=new Date();
    await row.save();
    res.json({template:row,status:row.metaStatus,metaResponse:{id:remote.id||row.metaTemplateId}});
  }catch(e){res.status(502).json({message:cleanError(e)})}
}
r.post('/:id/submit',(req,res)=>submit(req,res,false));
r.post('/:id/resubmit',(req,res)=>submit(req,res,true));

// Existing compatible endpoint retained for older clients, with safe draft
// creation and submission semantics (never mark local content APPROVED).
r.post('/meta/:integrationId',async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    const connection=await metaConnection(req,req.params.integrationId);
    if(!connection)return res.status(404).json({message:'Meta WhatsApp sender not connected'});
    const d=normalizeTemplate(req.body);
    const payload=createMetaTemplatePayload(d);
    const remote=await graph(connection,connection.businessAccountId+'/message_templates',{method:'POST',body:payload});
    const row=await Template.create({...d,workspaceId:req.workspaceId,integrationId:connection._id,
      metaStatus:String(remote.status||'PENDING').toUpperCase(),
      metaTemplateId:String(remote.id||''),metaLastSyncedAt:new Date()});
    res.status(201).json(row);
  }catch(e){res.status(502).json({message:cleanError(e)})}
});

r.post('/meta/:integrationId/upload-header',upload.single('file'),async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    const connection=await metaConnection(req,req.params.integrationId);
    if(!connection)return res.status(404).json({message:'Meta WhatsApp number unavailable'});
    const file=req.file;
    const allowed=new Set(['image/jpeg','image/png','video/mp4','application/pdf']);
    if(!file||!allowed.has(file.mimetype))
      return res.status(400).json({message:'Use JPG, PNG, MP4 or PDF media file up to 15 MB'});
    const config=await getMetaConfig();
    if(!config?.appId||!/^[0-9]+$/.test(config.appId))throw new Error('Meta App ID is not configured by Super Admin');
    const token=decrypt(connection.accessTokenEncrypted);
    const version=connection.graphVersion||'v23.0';
    const name=String(file.originalname||'sample').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,90);
    const query=new URLSearchParams({file_name:name,file_length:String(file.size),file_type:file.mimetype});
    const init=await fetch('https://graph.facebook.com/'+version+'/'+config.appId+'/uploads?'+query,{
      method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)
    });
    const session=await init.json().catch(()=>({}));
    if(!init.ok||!session.id)throw new Error(session.error?.message||'Meta refused sample media upload');
    const put=await fetch('https://graph.facebook.com/'+version+'/'+session.id,{
      method:'POST',headers:{Authorization:'Bearer '+token,'file_offset':'0',
        'Content-Type':'application/octet-stream'},body:file.buffer,
      signal:AbortSignal.timeout(45000)
    });
    const uploaded=await put.json().catch(()=>({}));
    if(!put.ok||!uploaded.h)throw new Error(uploaded.error?.message||'Meta did not provide the media sample handle');
    res.json({headerHandle:String(uploaded.h),format:file.mimetype.startsWith('image/')?'IMAGE':file.mimetype==='video/mp4'?'VIDEO':'DOCUMENT',fileName:name});
  }catch(e){res.status(502).json({message:cleanError(e)})}
});

// Supports all pages. Do not trust paging.next URLs; send only Meta-supplied
// opaque cursor to the fixed Graph origin and WABA ID.
r.post('/meta/:integrationId/sync',async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    const connection=await metaConnection(req,req.params.integrationId);
    if(!connection)return res.status(404).json({message:'Meta WhatsApp account unavailable'});
    let after='',total=0;const synced=[];
    for(let page=0;page<30;page++){
      const path=connection.businessAccountId+
        '/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=100'+
        (after?'&after='+encodeURIComponent(after):'');
      const data=await graph(connection,path);
      for(const remote of data.data||[]){
        const x=await upsertRemote(req,connection,remote);
        if(x){total++;synced.push(x._id)}
      }
      const next=String(data.paging?.cursors?.after||'');
      if(!next||next===after)break;
      after=next;
      if(page===29)throw new Error('Meta account has more templates than could be synced in one request; contact support');
    }
    res.json({synced:total,templateIds:synced});
  }catch(e){res.status(502).json({message:cleanError(e)})}
});

r.delete('/meta/:id',async(req,res)=>{
  try{
    if(!await requireAccess(req,res))return;
    if(!validId(req.params.id))return res.sendStatus(404);
    const row=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
    if(!row)return res.sendStatus(404);
    if(!row.integrationId||!row.metaTemplateName||!row.metaTemplateId)
      return res.status(409).json({message:'This is a local draft'});
    const connection=await metaConnection(req,row.integrationId);
    if(!connection)return res.status(404).json({message:'Connected Meta sender unavailable'});
    const suffix='?name='+encodeURIComponent(row.metaTemplateName)+'&hsm_id='+encodeURIComponent(row.metaTemplateId);
    await graph(connection,connection.businessAccountId+'/message_templates'+suffix,{method:'DELETE'});
    await Template.deleteOne({_id:row._id,workspaceId:req.workspaceId});
    res.json({ok:true});
  }catch(e){res.status(502).json({message:cleanError(e)})}
});

r.delete('/:id',async(req,res)=>{
  if(!validId(req.params.id))return res.sendStatus(404);
  const row=await Template.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
  if(!row)return res.sendStatus(404);
  if(row.metaTemplateId)return res.status(409).json({message:'Delete this submitted template from Meta'});
  await Template.deleteOne({_id:row._id,workspaceId:req.workspaceId});
  res.json({ok:true});
});
export default r;
