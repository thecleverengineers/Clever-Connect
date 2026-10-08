import express from 'express';
import mongoose from 'mongoose';
import {Integration,Workspace,User} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {encrypt,decrypt,webhookVerifyToken} from '../utils/crypto.js';
import {planLimitsForWorkspace,refreshWorkspaceAccess} from '../plan.js';

const r=express.Router();
r.use(requireAuth);

const view=x=>({
  id:x._id,
  name:x.name||'WhatsApp',
  provider:x.provider||'demo',
  enabled:x.enabled??true,
  isDefault:!!x.isDefault,
  phoneNumberId:x.phoneNumberId||'',
  displayPhoneNumber:x.displayPhoneNumber||'',
  businessAccountId:x.businessAccountId||'',
  graphVersion:x.graphVersion||'v23.0',
  otpTemplateName:x.otpTemplateName||'',
  otpTemplateLanguage:x.otpTemplateLanguage||'en_US',
  hasAccessToken:!!x.accessTokenEncrypted,
  connectionStatus:x.connectionStatus||'connected',
  connectedAt:x.connectedAt||null,
  lastCheckedAt:x.lastCheckedAt||null,
  lastError:x.lastError||'',
  webhookVerifyToken:webhookVerifyToken()
});

async function limits(workspaceId){
  const refreshed=await refreshWorkspaceAccess(workspaceId);
  const w=refreshed?.workspace?.toObject?.()||refreshed?.workspace||await Workspace.findById(workspaceId).lean();
  const max=(await planLimitsForWorkspace(w)).metaConnections;
  const used=await Integration.countDocuments({workspaceId,provider:'meta'});
  return {
    plan:w?.plan||'trial',
    max,
    used,
    access:{
      allowed:!!refreshed?.access?.allowed,
      state:refreshed?.access?.state||w?.subscriptionStatus||'expired',
      endsAt:refreshed?.access?.endsAt||null
    }
  };
}
async function requireMessagingAccess(workspaceId,res){
  const usage=await limits(workspaceId);
  if(!usage.access.allowed){
    res.status(402).json({message:'An active subscription or valid trial is required to manage Meta WhatsApp connections'});
    return null;
  }
  return usage;
}

async function testConnection(x){
  if(!x||!x.enabled||x.provider==='demo') return {ok:true,provider:'demo',message:'Demo provider is ready'};
  if(!x.phoneNumberId||!x.accessTokenEncrypted) throw new Error('Meta integration is incomplete');
  const token=decrypt(x.accessTokenEncrypted);
  const version=x.graphVersion||'v23.0';
  const response=await fetch('https://graph.facebook.com/'+version+'/'+x.phoneNumberId+'?fields=id,display_phone_number,verified_name',{
    headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(12000)
  });
  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message||'Meta connection test failed');
  return {ok:true,provider:'meta',displayPhoneNumber:data.display_phone_number||'',verifiedName:data.verified_name||''};
}

r.get('/whatsapp-connections',async(req,res)=>{
  const [rows,usage]=await Promise.all([
    Integration.find({workspaceId:req.workspaceId}).sort({isDefault:-1,createdAt:1}).lean(),
    limits(req.workspaceId)
  ]);
  res.json({connections:rows.map(view),subscription:usage});
});

r.post('/whatsapp-connections',async(req,res)=>{
  try{
    const usage=await requireMessagingAccess(req.workspaceId,res);
    if(!usage)return;
    if(usage.used>=usage.max)return res.status(409).json({message:'Your '+usage.plan+' plan allows '+usage.max+' Meta WhatsApp connection(s)'});
    const name=String(req.body.name||'WhatsApp connection').trim();
    const phoneNumberId=String(req.body.phoneNumberId||'').trim();
    const accessToken=String(req.body.accessToken||'').trim();
    if(!name||!phoneNumberId||!accessToken)return res.status(400).json({message:'Connection name, Phone Number ID and access token are required'});
    if(await Integration.exists({workspaceId:req.workspaceId,name}))return res.status(409).json({message:'A connection with this name already exists'});
    const row=await Integration.create({
      workspaceId:req.workspaceId,
      name,
      provider:'meta',
      enabled:true,
      isDefault:false,
      phoneNumberId,
      businessAccountId:String(req.body.businessAccountId||'').trim(),
      accessTokenEncrypted:encrypt(accessToken),
      graphVersion:/^v\d+\.\d+$/.test(String(req.body.graphVersion||''))?String(req.body.graphVersion):'v23.0',
      otpTemplateName:String(req.body.otpTemplateName||'').trim(),
      otpTemplateLanguage:String(req.body.otpTemplateLanguage||'en_US').trim(),
      connectionStatus:'connected',
      connectedAt:new Date()
    });
    try{
      const result=await testConnection(row.toObject());
      row.connectionStatus='connected';
      row.lastCheckedAt=new Date();
      row.lastError='';
      if(result.displayPhoneNumber)row.displayPhoneNumber=result.displayPhoneNumber;
      await row.save();
      return res.status(201).json({connection:view(row),test:result});
    }catch(e){
      row.connectionStatus='error';
      row.lastCheckedAt=new Date();
      row.lastError=String(e.message||'Connection test failed').slice(0,500);
      await row.save();
      return res.status(201).json({connection:view(row),test:{ok:false,message:row.lastError},warning:'Connection saved. Fix credentials and test again; it will remain saved until disconnected.'});
    }
  }catch(e){
    if(e?.code===11000){
      if(e?.keyPattern?.workspaceId&&e?.keyPattern?.name)return res.status(409).json({message:'A connection with this name already exists'});
      if(e?.keyPattern?.phoneNumberId)return res.status(409).json({message:'This Meta Phone Number ID is already connected'});
      return res.status(409).json({message:'This Meta WhatsApp profile is already connected'});
    }
    console.error('Meta connection create error',e);
    return res.status(500).json({message:'Unable to save Meta WhatsApp profile. Please retry.'});
  }
});

r.put('/whatsapp-connections/:id',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const row=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!row)return res.sendStatus(404);
  if(row.provider==='demo')return res.status(409).json({message:'The demo provider cannot be converted into Meta. Add a new Meta connection instead'});
  if(req.body.name!==undefined)row.name=String(req.body.name||'').trim();
  if(req.body.phoneNumberId!==undefined)row.phoneNumberId=String(req.body.phoneNumberId||'').trim();
  if(req.body.businessAccountId!==undefined)row.businessAccountId=String(req.body.businessAccountId||'').trim();
  if(req.body.graphVersion!==undefined&&/^v\d+\.\d+$/.test(String(req.body.graphVersion)))row.graphVersion=String(req.body.graphVersion);
  if(req.body.otpTemplateName!==undefined)row.otpTemplateName=String(req.body.otpTemplateName||'').trim();
  if(req.body.otpTemplateLanguage!==undefined)row.otpTemplateLanguage=String(req.body.otpTemplateLanguage||'en_US').trim();
  if(req.body.accessToken)row.accessTokenEncrypted=encrypt(String(req.body.accessToken).trim());
  if(req.body.enabled!==undefined){
    row.enabled=!!req.body.enabled;
    row.connectionStatus=row.enabled?(row.connectionStatus==='disabled'?'connected':row.connectionStatus):'disabled';
  }
  await row.save();
  res.json(view(row));
});

r.post('/whatsapp-connections/:id/test',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  const x=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId}).lean();
  if(!x)return res.sendStatus(404);
  try{
    const result=await testConnection(x);
    await Integration.updateOne({_id:x._id},{$set:{
      displayPhoneNumber:result.displayPhoneNumber||x.displayPhoneNumber||'',
      connectionStatus:'connected',
      lastCheckedAt:new Date(),
      lastError:''
    }});
    res.json(result);
  }catch(e){
    await Integration.updateOne({_id:x._id},{$set:{
      connectionStatus:'error',
      lastCheckedAt:new Date(),
      lastError:String(e.message||'Connection test failed').slice(0,500)
    }});
    res.status(502).json({message:e.message,connectionPreserved:true});
  }
});

r.post('/whatsapp-connections/:id/default',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  const x=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId,enabled:true});
  if(!x)return res.status(404).json({message:'Connection not found or disabled'});
  await Integration.updateMany({workspaceId:req.workspaceId},{$set:{isDefault:false}});
  x.isDefault=true;await x.save();
  res.json(view(x));
});

r.delete('/whatsapp-connections/:id',async(req,res)=>{
  const x=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!x)return res.sendStatus(404);
  if(x.provider==='demo')return res.status(409).json({message:'The built-in demo provider cannot be deleted'});
  const inUse=await User.countDocuments({workspaceId:req.workspaceId,twoFactorIntegrationId:x._id,twoFactorEnabled:true});
  if(inUse)return res.status(409).json({message:'This connection is used by WhatsApp 2FA. Disable or move 2FA first'});
  await x.deleteOne();
  if(x.isDefault){
    const fallback=await Integration.findOne({workspaceId:req.workspaceId,enabled:true}).sort({provider:-1,createdAt:1});
    if(fallback){fallback.isDefault=true;await fallback.save()}
  }
  res.json({ok:true});
});

/* Backward-compatible single-provider settings */
r.get('/whatsapp',async(req,res)=>{
  const x=await Integration.findOne({workspaceId:req.workspaceId,isDefault:true}).lean()
    ||await Integration.findOne({workspaceId:req.workspaceId}).lean();
  res.json(view(x||{}));
});

r.put('/whatsapp',async(req,res)=>{
  let x=await Integration.findOne({workspaceId:req.workspaceId,isDefault:true});
  if(!x)x=await Integration.findOne({workspaceId:req.workspaceId});
  if(!x)x=new Integration({workspaceId:req.workspaceId,name:'Demo provider',provider:'demo',isDefault:true});
  const provider=req.body.provider==='meta'?'meta':'demo';
  x.provider=provider;
  x.enabled=req.body.enabled!==false;
  if(req.body.phoneNumberId!==undefined)x.phoneNumberId=String(req.body.phoneNumberId||'').trim();
  if(req.body.businessAccountId!==undefined)x.businessAccountId=String(req.body.businessAccountId||'').trim();
  if(req.body.graphVersion!==undefined&&/^v\d+\.\d+$/.test(String(req.body.graphVersion)))x.graphVersion=String(req.body.graphVersion);
  if(req.body.accessToken)x.accessTokenEncrypted=encrypt(String(req.body.accessToken).trim());
  if(provider==='meta'&&!x.phoneNumberId)return res.status(400).json({message:'Phone number ID is required for Meta Cloud API'});
  if(provider==='meta'&&!x.accessTokenEncrypted)return res.status(400).json({message:'Access token is required for Meta Cloud API'});
  await x.save();
  res.json(view(x));
});

r.post('/whatsapp/test',async(req,res)=>{
  const x=await Integration.findOne({workspaceId:req.workspaceId,isDefault:true}).lean()
    ||await Integration.findOne({workspaceId:req.workspaceId}).lean();
  try{res.json(await testConnection(x))}catch(e){res.status(502).json({message:e.message})}
});

export default r;
