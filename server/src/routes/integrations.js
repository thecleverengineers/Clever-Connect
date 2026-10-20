import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {Integration,Workspace,User} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {encrypt,decrypt,webhookVerifyToken} from '../utils/crypto.js';
import {refreshWorkspaceAccess,metaEntitlements,requireMetaSenderEntitlement} from '../plan.js';
import {getMetaConfig,getMetaConfigPublic} from '../metaConfig.js';
import {verifyExistingCloudApiNumber} from '../services/existingMetaNumber.js';
import {discoverMetaPortfolios} from '../services/metaPortfolioDiscovery.js';

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
  businessPortfolioId:x.businessPortfolioId||'',
  connectMethod:x.connectMethod||'manual',
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
  const {max,used,allowedIds}=await metaEntitlements(w);
  return {
    plan:w?.plan||'trial',
    max,
    used,
    allowedIds,
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


/* Serialize Meta connection provisioning per workspace. The lease prevents
   simultaneous Embedded Signup and manual adds from exceeding a plan limit. */
async function acquireConnectionLease(workspaceId){
  const token=crypto.randomUUID();
  const now=new Date();
  const row=await Workspace.findOneAndUpdate({
    _id:workspaceId,
    $or:[{metaConnectLockExpiresAt:{$exists:false}},{metaConnectLockExpiresAt:null},{metaConnectLockExpiresAt:{$lte:now}}]
  },{$set:{metaConnectLockToken:token,metaConnectLockExpiresAt:new Date(Date.now()+180000)}},{new:true});
  return row?token:null;
}
async function releaseConnectionLease(workspaceId,token){
  if(token)await Workspace.updateOne({_id:workspaceId,metaConnectLockToken:token},
    {$unset:{metaConnectLockToken:1,metaConnectLockExpiresAt:1}}).catch(e=>console.error('Meta connection lease release failed',e));
}


async function metaRequest(version,path,token,{method='GET',body}={}){
  const response=await fetch('https://graph.facebook.com/'+version+'/'+path,{
    method,
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||'Meta request failed');
  return data;
}
async function exchangeEmbeddedCode(code){
  const cfg=await getMetaConfig();
  if(!cfg.enabled)throw new Error('Facebook Embedded Signup is not configured by Super Admin');
  const params=new URLSearchParams({
    client_id:cfg.appId,
    client_secret:cfg.appSecret,
    code:String(code||'')
  });
  const response=await fetch('https://graph.facebook.com/'+cfg.graphVersion+'/oauth/access_token?'+params.toString(),{
    signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw new Error(data?.error?.message||'Unable to exchange Facebook authorization code');
  return {token:data.access_token,graphVersion:cfg.graphVersion};
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


// Discover assets only after the customer signs into Facebook and explicitly
// grants access. The temporary user token is never saved or returned.
r.post('/meta-portfolios/discover',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  const token=String(req.body?.accessToken||'').trim();
  if(!token||token.length>3500)return res.status(400).json({message:'Meta account authorization is required'});
  const config=await getMetaConfig();
  if(!config.enabled)return res.status(409).json({message:'Meta Facebook Login is not configured'});
  try{
    const results=await discoverMetaPortfolios({
      accessToken:token,appId:config.appId,appSecret:config.appSecret,graphVersion:config.graphVersion
    });
    res.set('Cache-Control','no-store');
    return res.json(results);
  }catch(e){
    return res.status(422).json({message:String(e.message||'Could not list Meta assets').slice(0,260)});
  }
});

r.post('/embedded-signup/diagnostic',async(req,res)=>{
  const status=String(req.body.status||'').slice(0,80);
  const event=String(req.body.event||'').slice(0,120);
  const detail=String(req.body.detail||'').slice(0,300);
  console.warn('Embedded Signup client diagnostic',{
    workspaceId:String(req.workspaceId),
    userId:String(req.user?._id||''),
    status,event,detail
  });
  res.json({ok:true});
});

r.get('/embedded-signup/config',async(req,res)=>{
  const [cfg,usage]=await Promise.all([getMetaConfigPublic(),limits(req.workspaceId)]);
  // This value is exactly what /api/webhooks/meta validates on GET.
  // The webhook must be configured before the first number can connect,
  // so expose it to authenticated workspace members without requiring
  // an existing Integration record.
  res.set('Cache-Control','no-store');
  res.json({...cfg,subscription:usage,webhookVerifyToken:webhookVerifyToken()});
});

r.post('/embedded-signup/complete',async(req,res)=>{
  let row=null;
  let lease=null;
  try{
    const usage=await requireMessagingAccess(req.workspaceId,res);
    if(!usage)return;
    if(usage.used>=usage.max)return res.status(409).json({message:'Your '+usage.plan+' plan allows '+usage.max+' Meta WhatsApp connection(s)'});
    lease=await acquireConnectionLease(req.workspaceId);
    if(!lease)return res.status(409).json({message:'Another WhatsApp connection is being added. Please wait and retry.'});
    const fresh=await limits(req.workspaceId);
    if(fresh.used>=fresh.max)return res.status(409).json({message:'Your plan WhatsApp connection limit was reached'});

    const code=String(req.body.code||'').trim();
    const wabaId=String(req.body.wabaId||'').trim();
    let phoneNumberId=String(req.body.phoneNumberId||'').trim();
    const businessPortfolioId=String(req.body.businessPortfolioId||'').trim();
    const coexistence=req.body.coexistence===true;
    if(!code||!wabaId)return res.status(400).json({message:'Facebook signup did not return the required WhatsApp Business Account details'});

    const {token,graphVersion}=await exchangeEmbeddedCode(code);
    if(!phoneNumberId){
      const phones=await metaRequest(
        graphVersion,
        wabaId+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100',
        token,
        {method:'GET'}
      );
      const items=phones.data||[];
      if(items.length===1)phoneNumberId=String(items[0].id||'');
      else if(items.length>1)return res.status(409).json({message:'Meta returned multiple phone numbers but did not identify the selected number. Retry Embedded Signup and select one number.'});
    }
    if(!phoneNumberId)return res.status(400).json({message:'No WhatsApp phone number was returned by Meta'});

    if(await Integration.exists({provider:'meta',phoneNumberId})){
      return res.status(409).json({message:'This WhatsApp phone number is already connected'});
    }

    const phone=await metaRequest(graphVersion,phoneNumberId+'?fields=id,display_phone_number,verified_name',token,{method:'GET'});
    await metaRequest(graphVersion,wabaId+'/subscribed_apps',token,{method:'POST'});

    const pin=String(crypto.randomInt(100000,1000000));
    let registrationStatus=coexistence?'coexistence':'registered';
    let registrationWarning='';
    if(!coexistence){
      try{
        await metaRequest(graphVersion,phoneNumberId+'/register',token,{
          method:'POST',
          body:{messaging_product:'whatsapp',pin}
        });
      }catch(e){
        registrationStatus='needs_attention';
        registrationWarning=e.message;
      }
    }

    const count=await Integration.countDocuments({workspaceId:req.workspaceId,provider:'meta'});
    row=await Integration.create({
      workspaceId:req.workspaceId,
      name:String(req.body.name||phone.verified_name||phone.display_phone_number||'Meta WhatsApp').trim(),
      provider:'meta',
      enabled:true,
      isDefault:count===0,
      phoneNumberId,
      displayPhoneNumber:phone.display_phone_number||'',
      businessAccountId:wabaId,
      businessPortfolioId,
      accessTokenEncrypted:encrypt(token),
      registrationPinEncrypted:coexistence?'':encrypt(pin),
      connectMethod:'embedded',
      graphVersion,
      connectionStatus:registrationStatus==='needs_attention'?'error':'connected',
      connectedAt:new Date(),
      lastCheckedAt:new Date(),
      lastError:registrationWarning
    });

    res.status(201).json({
      connection:view(row),
      registrationStatus,
      warning:registrationWarning||'',
      message:registrationStatus==='registered'
        ? 'Facebook signup completed and WhatsApp phone registered.'
        : registrationStatus==='coexistence'
          ? 'Facebook signup completed using WhatsApp Business App coexistence.'
          : 'Facebook signup completed and saved. Phone registration needs attention.'
    });
  }catch(e){
    if(row?._id)await Integration.deleteOne({_id:row._id}).catch(()=>{});
    if(e?.code===11000)return res.status(409).json({message:'This Meta WhatsApp profile is already connected'});
    console.error('Embedded Signup completion error',e);
    res.status(502).json({message:e.message||'Unable to complete Facebook Embedded Signup'});
  }finally{
    await releaseConnectionLease(req.workspaceId,lease);
  }
});

r.get('/whatsapp-connections',async(req,res)=>{
  const [rows,usage]=await Promise.all([
    Integration.find({workspaceId:req.workspaceId}).sort({isDefault:-1,createdAt:1}).lean(),
    limits(req.workspaceId)
  ]);
  res.json({connections:rows.map(x=>({...view(x),planAllowed:x.provider!=='meta'||usage.allowedIds.includes(String(x._id))})),subscription:usage});
});

r.post('/whatsapp-connections',async(req,res)=>{
  let lease=null;
  try{
    const usage=await requireMessagingAccess(req.workspaceId,res);
    if(!usage)return;
    if(usage.used>=usage.max)return res.status(409).json({message:'Your '+usage.plan+' plan allows '+usage.max+' Meta WhatsApp connection(s)'});
    lease=await acquireConnectionLease(req.workspaceId);
    if(!lease)return res.status(409).json({message:'Another WhatsApp connection is being added. Please wait and retry.'});
    const fresh=await limits(req.workspaceId);
    if(fresh.used>=fresh.max)return res.status(409).json({message:'Your plan WhatsApp connection limit was reached'});
    const name=String(req.body.name||'WhatsApp connection').trim();
    const phoneNumberId=String(req.body.phoneNumberId||'').trim();
    const accessToken=String(req.body.accessToken||'').trim();
    if(!name||!phoneNumberId||!accessToken)return res.status(400).json({message:'Connection name, Phone Number ID and access token are required'});
    const wabaId=String(req.body.businessAccountId||'').trim();
    const existingCloud=req.body.connectionIntent==='existing_cloud_api';
    const version=/^v\d+\.\d+$/.test(String(req.body.graphVersion||''))?String(req.body.graphVersion):'v23.0';
    let verified=null;
    if(existingCloud){
      try{verified=await verifyExistingCloudApiNumber({
        phoneNumberId,businessAccountId:wabaId,accessToken,graphVersion:version
      })}catch(e){return res.status(422).json({message:'Unable to link existing Cloud API number: '+e.message})}
    }
    if(await Integration.exists({provider:'meta',phoneNumberId}))
      return res.status(409).json({message:'This Meta WhatsApp phone number is already connected to your workspace'});
    if(await Integration.exists({workspaceId:req.workspaceId,name}))return res.status(409).json({message:'A connection with this name already exists'});
    const row=await Integration.create({
      workspaceId:req.workspaceId,
      name,
      provider:'meta',
      enabled:true,
      isDefault:false,
      phoneNumberId,
      businessAccountId:wabaId,
      displayPhoneNumber:verified?.displayPhoneNumber||'',
      accessTokenEncrypted:encrypt(accessToken),
      graphVersion:version,
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
  }finally{
    await releaseConnectionLease(req.workspaceId,lease);
  }
});

r.put('/whatsapp-connections/:id',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const row=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!row)return res.sendStatus(404);
  if(row.provider==='demo')return res.status(409).json({message:'The demo provider cannot be converted into Meta. Add a new Meta connection instead'});
  if(req.body.name!==undefined)row.name=String(req.body.name||'').trim();
  if(req.body.phoneNumberId!==undefined){
    const nextId=String(req.body.phoneNumberId||'').trim();
    if(!nextId)return res.status(400).json({message:'Phone Number ID cannot be empty'});
    const duplicate=await Integration.exists({provider:'meta',phoneNumberId:nextId,_id:{$ne:row._id}});
    if(duplicate)return res.status(409).json({message:'This Meta number is already connected'});
    row.phoneNumberId=nextId;
  }
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
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const x=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId,provider:'meta'}).lean();
  if(!x)return res.sendStatus(404);
  if(!x.enabled)return res.status(409).json({message:'Enable this WhatsApp number before syncing its Meta connection details'});
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
  if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(404);
  const x=await Integration.findOne({_id:req.params.id,workspaceId:req.workspaceId,provider:'meta',enabled:true});
  if(!x)return res.status(404).json({message:'Meta connection not found or disabled'});
  try{await requireMetaSenderEntitlement(req.workspaceId,x._id)}
  catch(e){return res.status(409).json({message:e.message})}
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
  if(provider==='meta'){
    const usage=await requireMessagingAccess(req.workspaceId,res);
    if(!usage)return;
    if(x.provider!=='meta')return res.status(409).json({message:'Use Connect manually or Facebook Embedded Signup to add WhatsApp numbers. The legacy settings endpoint cannot create connections.'});
    if(x.provider==='meta'&&!usage.allowedIds.includes(String(x._id)))return res.status(409).json({message:'This WhatsApp number exceeds your plan limit'});
  }
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
