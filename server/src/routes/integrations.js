import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {Integration,Workspace,User} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {encrypt,decrypt,webhookVerifyToken} from '../utils/crypto.js';
import {refreshWorkspaceAccess,metaEntitlements,requireMetaSenderEntitlement} from '../plan.js';
import {getMetaConfig,getMetaConfigPublic} from '../metaConfig.js';
import {verifyMessagingPermissionDebug} from '../services/metaTokenDiagnostics.js';
import {verifyExistingCloudApiNumber} from '../services/existingMetaNumber.js';
import {discoverMetaPortfolios} from '../services/metaPortfolioDiscovery.js';
import {summarizeMetaProfiles} from '../services/metaProfiles.js';

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
  webhookStatus:x.webhookStatus||'unknown',
  lastWebhookCheckedAt:x.lastWebhookCheckedAt||null,
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
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||'Meta credentials cannot access this WhatsApp number');
  // Optional read-only Graph introspection for Meta app-owned tokens. A
  // successful phone GET alone does not prove messaging authorization.
  let permissionCheck='unavailable';
  const config=await getMetaConfig();
  if(config.appId&&config.appSecret){
    try{
      const url='https://graph.facebook.com/'+config.graphVersion+
        '/debug_token?input_token='+encodeURIComponent(token);
      const debugResponse=await fetch(url,{
        headers:{Authorization:'Bearer '+config.appId+'|'+config.appSecret},
        signal:AbortSignal.timeout(12000)
      });
      if(debugResponse.ok){
        const debug=await debugResponse.json().catch(()=>({}));
        const verdict=verifyMessagingPermissionDebug(debug.data,config.appId);
        if(verdict.checked)permissionCheck=verdict.messagingPermission?'granted':'not_confirmed';
      }
    }catch(e){
      if(/expired|invalid|lacks whatsapp_business_messaging/i.test(e.message||''))throw e;
      // Third-party provider tokens may not be inspectable by this Meta app.
    }
  }
  return {ok:true,provider:'meta',displayPhoneNumber:data.display_phone_number||'',
    verifiedName:data.verified_name||'',messagingPermission:permissionCheck};
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

// Legacy endpoint is retired to prevent automatically registering an arbitrary
// first number without the user's explicit activation selection.
r.post('/embedded-signup/complete',(req,res)=>res.status(409).json({
  code:'META_SELECTION_REQUIRED',
  message:'Refresh Clever Connect and choose which Meta phone numbers to activate after authorization.'
}));

// Explicitly authorized existing-number connection: Meta issues the access
// token during Embedded Signup and we exchange the code only on the server.
// This NEVER returns credentials to the browser and NEVER calls /register.
// It cannot bypass Meta's eligibility rules for BSP-owned numbers.
r.post('/embedded-signup/link-existing',async(req,res)=>{
  let lease=null;
  try{
    const usage=await requireMessagingAccess(req.workspaceId,res);
    if(!usage)return;
    const code=String(req.body?.code||'').trim();
    const wabaId=String(req.body?.wabaId||'').trim();
    const phoneNumberId=String(req.body?.phoneNumberId||'').trim();
    const profileId=String(req.body?.profileId||'').trim();
    const businessPortfolioId=String(req.body?.businessPortfolioId||'').trim();
    if(!code||code.length>4096||!/^[0-9]{5,30}$/.test(wabaId)||
       !/^[0-9]{5,30}$/.test(phoneNumberId))
      return res.status(400).json({message:'Meta authorization must identify an existing WABA and Phone Number ID'});
    if(profileId&&!mongoose.isValidObjectId(profileId))
      return res.status(400).json({message:'Invalid sender connection'});
    let prior=null;
    if(profileId){
      prior=await Integration.findOne({
        _id:profileId,workspaceId:req.workspaceId,provider:'meta',enabled:true
      });
      if(!prior)return res.status(404).json({message:'WhatsApp connection not found'});
      await requireMetaSenderEntitlement(req.workspaceId,prior._id);
      if(prior.phoneNumberId!==phoneNumberId||prior.businessAccountId!==wabaId)
        return res.status(409).json({message:'Meta authorized a different number or WABA. Existing sender credentials were not changed.'});
    }else{
      if(usage.used>=usage.max)return res.status(409).json({message:'Your subscription WhatsApp number limit has been reached'});
      lease=await acquireConnectionLease(req.workspaceId);
      if(!lease)return res.status(409).json({message:'Another connection is being added. Please retry shortly.'});
      const fresh=await limits(req.workspaceId);
      if(fresh.used>=fresh.max)return res.status(409).json({message:'Your plan WhatsApp number limit was reached'});
      if(await Integration.exists({provider:'meta',phoneNumberId}))
        return res.status(409).json({message:'This WhatsApp number is already connected. Open its existing account settings to reauthorize.'});
    }
    // One-use code, issued after a user explicitly approves Meta's login
    // window. Never use the read-only Facebook profile discovery token here.
    const {token,graphVersion}=await exchangeEmbeddedCode(code);
    const verified=await verifyExistingCloudApiNumber({
      phoneNumberId,businessAccountId:wabaId,accessToken:token,graphVersion
    });
    // Verify the actual sender credential before replacing or storing it.
    const encrypted=encrypt(token);
    const health=await testConnection({
      enabled:true,provider:'meta',phoneNumberId,
      accessTokenEncrypted:encrypted,graphVersion
    });
    if(profileId){
      // Important: update only the selected workspace record after verification.
      // Old encrypted token remains untouched when Meta authorization fails.
      prior.accessTokenEncrypted=encrypted;
      prior.connectMethod='embedded';
      prior.graphVersion=graphVersion;
      prior.connectionStatus='connected';
      prior.lastError='';
      prior.lastCheckedAt=new Date();
      prior.displayPhoneNumber=verified.displayPhoneNumber||health.displayPhoneNumber||prior.displayPhoneNumber;
      if(businessPortfolioId)prior.businessPortfolioId=businessPortfolioId;
      await prior.save();
      return res.json({
        connection:view(prior),message:'Meta authorization refreshed. Your existing sender token was replaced securely.',
        messagingPermission:health.messagingPermission||'unavailable'
      });
    }
    const count=await Integration.countDocuments({workspaceId:req.workspaceId,provider:'meta'});
    const row=await Integration.create({
      workspaceId:req.workspaceId,
      name:String(verified.verifiedName||verified.displayPhoneNumber||'Meta WhatsApp').trim().slice(0,100),
      provider:'meta',enabled:true,isDefault:count===0,
      phoneNumberId,businessAccountId:wabaId,businessPortfolioId,
      displayPhoneNumber:verified.displayPhoneNumber||health.displayPhoneNumber||'',
      accessTokenEncrypted:encrypted,
      graphVersion,connectMethod:'embedded',
      connectionStatus:'connected',connectedAt:new Date(),lastCheckedAt:new Date(),lastError:''
    });
    return res.status(201).json({
      connection:view(row),message:'Existing Meta Cloud API number linked with an authorized token. No registration or migration was performed.',
      messagingPermission:health.messagingPermission||'unavailable'
    });
  }catch(e){
    if(e?.code===11000)return res.status(409).json({message:'This WhatsApp number is already connected'});
    return res.status(422).json({
      message:'Meta could not authorize this existing number. '+String(e?.message||'Check WABA permissions and your Meta account').slice(0,260)+
        ' Meta may require a provider-approved migration or eligible Embedded Signup; Clever Connect cannot fetch a third-party token.'
    });
  }finally{
    await releaseConnectionLease(req.workspaceId,lease);
  }
});

r.get('/whatsapp-connections',async(req,res)=>{
  const [rows,usage]=await Promise.all([
    Integration.find({workspaceId:req.workspaceId}).sort({isDefault:-1,createdAt:1}).lean(),
    limits(req.workspaceId)
  ]);
  const connections=rows.map(x=>({
    ...view(x),planAllowed:x.provider!=='meta'||usage.allowedIds.includes(String(x._id))
  }));
  res.json({
    connections,subscription:usage,
    metaProfiles:summarizeMetaProfiles(connections)
  });
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
  const tokenChanged=!!String(req.body.accessToken||'').trim();
  const credentialsChanged=tokenChanged||
    req.body.phoneNumberId!==undefined&&row.isModified('phoneNumberId')||
    req.body.graphVersion!==undefined&&row.isModified('graphVersion');
  if(tokenChanged)row.accessTokenEncrypted=encrypt(String(req.body.accessToken).trim());
  if(req.body.enabled!==undefined)row.enabled=!!req.body.enabled;
  if(credentialsChanged&&row.enabled){
    try{
      // Validate newly entered credentials BEFORE saving. If Meta rejects
      // them, preserve the previously stored token and sender metadata.
      const health=await testConnection(row.toObject());
      row.connectionStatus='connected';
      row.lastCheckedAt=new Date();
      row.lastError='';
      row.displayPhoneNumber=health.displayPhoneNumber||row.displayPhoneNumber;
    }catch(e){
      return res.status(422).json({
        code:'META_SENDER_AUTH_REQUIRED',
        message:'Meta rejected the replacement sender credentials. Nothing was changed. '+String(e.message||'Check the Phone Number ID and system-user token').slice(0,250)
      });
    }
  }else if(!row.enabled)row.connectionStatus='disabled';
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
    res.status(409).json({
      code:'META_SENDER_AUTH_REQUIRED',
      message:'Meta WhatsApp connection needs attention: '+String(e.message||'Check token and permissions').slice(0,260)+
        '. Renew the token under WhatsApp Manager → Numbers → Edit and run Test / Sync.',
      connectionPreserved:true
    });
  }
});

// Reconnect the Clever Connect Meta app to the WABA's webhook
// independently of sender credentials. This does not remove any other app,
// revoke another partner's token or change Meta conversation routing.
r.post('/whatsapp-connections/:id/webhook/sync',async(req,res)=>{
  if(!await requireMessagingAccess(req.workspaceId,res))return;
  if(!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({message:'Invalid WhatsApp connection'});
  const connection=await Integration.findOne({
    _id:req.params.id,workspaceId:req.workspaceId,provider:'meta'
  }).lean();
  if(!connection)return res.sendStatus(404);
  if(!connection.enabled)return res.status(409).json({message:'Enable this connection before subscribing to webhooks'});
  try{
    await requireMetaSenderEntitlement(req.workspaceId,connection._id);
    if(!/^[0-9]{5,30}$/.test(connection.businessAccountId||''))
      return res.status(409).json({message:'This connection has no valid Meta WABA ID. Reauthorize with Facebook.'});
    const token=decrypt(connection.accessTokenEncrypted);
    const version=connection.graphVersion||'v23.0';
    await metaRequest(version,connection.businessAccountId+'/subscribed_apps',token,{method:'POST'});
    const when=new Date();
    await Integration.updateOne({_id:connection._id,workspaceId:req.workspaceId},{
      $set:{webhookStatus:'subscribed',lastWebhookCheckedAt:when,
        lastError:connection.connectionStatus==='connected'?'':connection.lastError||''}
    });
    return res.json({ok:true,webhookStatus:'subscribed',
      message:'Meta WABA subscribed to Clever Connect webhooks. Verify the callback URL and messages field in Meta App settings to receive events.'});
  }catch(e){
    await Integration.updateOne({_id:connection._id,workspaceId:req.workspaceId},
      {$set:{webhookStatus:'needs_attention',lastWebhookCheckedAt:new Date(),
        lastError:String(e.message||'Webhook setup failed').slice(0,300)}}
    ).catch(()=>{});
    return res.status(409).json({
      code:'META_WEBHOOK_SUBSCRIPTION_FAILED',
      message:'Meta webhook subscription could not be completed: '+String(e.message||'Check Meta WABA permissions').slice(0,180)+
      '. This saved sender has not been disconnected.'
    });
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
