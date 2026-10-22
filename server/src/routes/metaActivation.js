import express from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {Integration,MetaActivationSession,Workspace} from '../models.js';
import {refreshWorkspaceAccess,metaEntitlements} from '../plan.js';
import {getMetaConfig} from '../metaConfig.js';
import {encrypt,decrypt} from '../utils/crypto.js';
import {cleanMetaId,validMetaPhoneList,validateActivationSelection,activationSessionExpired,assertSignupMatchesSelection,shouldRegisterDuringActivation} from '../services/metaActivation.js';
import {verifyExistingCloudApiNumber} from '../services/existingMetaNumber.js';
import {getMetaConfig as configuredMetaApp} from '../metaConfig.js';
import {inspectMetaTokenWithGraph,metaNumberRegistrationAction,onboardingResultMessage} from '../services/metaConnectHealth.js';

const router=express.Router();

async function allowance(workspaceId){
 const access=await refreshWorkspaceAccess(workspaceId);
 if(!access?.access?.allowed)throw new Error('An active subscription is required');
 const w=access.workspace.toObject();
 const cap=await metaEntitlements(w);
 return {max:cap.max,used:cap.used,remaining:Math.max(0,cap.max-cap.used)};
}
async function graph(version,path,token,method='GET',body){
 const resp=await fetch('https://graph.facebook.com/'+version+'/'+path,{
  method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)
 });
 const data=await resp.json().catch(()=>({}));
 if(!resp.ok)throw new Error(data?.error?.message||'Meta request failed');
 return data;
}
async function exchange(code){
 const c=await getMetaConfig();
 if(!c.enabled)throw new Error('Facebook Embedded Signup is not configured');
 const p=new URLSearchParams({client_id:c.appId,client_secret:c.appSecret,code});
 const response=await fetch('https://graph.facebook.com/'+c.graphVersion+'/oauth/access_token?'+p,{
  signal:AbortSignal.timeout(15000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.access_token)throw new Error(data?.error?.message||'Meta authorization code exchange failed');
 return {token:data.access_token,version:c.graphVersion};
}

router.post('/prepare',async(req,res)=>{
 try{
  const limit=await allowance(req.workspaceId);
  if(!limit.remaining)return res.status(409).json({message:'Subscription connection limit reached'});
  const code=String(req.body?.code||'').trim();
  if(!code||code.length>4096)return res.status(400).json({message:'Meta authorization code missing'});
  const waba=cleanMetaId(req.body?.wabaId,'WABA ID');
  const portfolio=String(req.body?.businessPortfolioId||'').trim();
  const mode=req.body?.existingCloud===true?'existing':req.body?.coexistence===true?'coexistence':'new';
  if(portfolio&&!/^[0-9]{5,30}$/.test(portfolio))
   return res.status(400).json({message:'Invalid Meta Business Portfolio ID'});
  // One-click Meta login can legitimately return a WABA with no specific
  // chosen phone yet. Only a user who explicitly selects a number in the
  // optional browser must be locked to that ID.
  const selectedId=String(req.body?.phoneNumberId||'').trim();
  if(selectedId)cleanMetaId(selectedId,'Phone Number ID');
  assertSignupMatchesSelection({
   expectedWabaId:String(req.body?.expectedBusinessAccountId||'').trim(),
   authorizedWabaId:waba,
   expectedPhoneNumberId:String(req.body?.expectedPhoneNumberId||'').trim(),
   returnedPhoneNumberId:String(req.body?.metaReportedPhoneNumberId||'').trim()
  });
  const auth=await exchange(code);
  const cfg=await configuredMetaApp();
  // Reject tokens for the wrong app, expired tokens and missing messaging
  // permissions before saving any temporary activation session.
  await inspectMetaTokenWithGraph({
   token:auth.token,appId:cfg.appId,appSecret:cfg.appSecret,graphVersion:auth.version
  });
  const found=[];let after='';
  for(let i=0;i<3;i++){
   const q=waba+'/phone_numbers?fields=id,display_phone_number,verified_name,status&limit=100'+
    (after?'&after='+encodeURIComponent(after):'');
   // Older WABAs and newly migrated WAAC/PMA accounts may not expose
   // registration status on the same Graph version. Fall back gracefully
   // while still verifying every selected phone at activation time.
   let page;
   try{page=await graph(auth.version,q,auth.token)}
   catch(e){
    if(!/status|field|parameter/i.test(e.message||''))throw e;
    page=await graph(auth.version,q.replace(',status&','&'),auth.token);
   }
   found.push(...(page.data||[]));
   const next=page.paging?.cursors?.after;
   if(!next||next===after||found.length>=250)break;
   after=next;
  }
  const phones=validMetaPhoneList(found);
  if(selectedId&&!phones.some(p=>p.id===selectedId)){
   const verified=await verifyExistingCloudApiNumber({
    phoneNumberId:selectedId,businessAccountId:waba,accessToken:auth.token,graphVersion:auth.version
   });
   phones.push({id:selectedId,displayPhoneNumber:verified.displayPhoneNumber,verifiedName:verified.verifiedName,status:''});
  }
  if(!phones.length)return res.status(409).json({message:'Meta granted access to this WABA, but no accessible phone numbers are available yet'});
  const existing=await Integration.find({provider:'meta',phoneNumberId:{$in:phones.map(p=>p.id)}})
   .select('workspaceId phoneNumberId').lean();
  const mapped=new Map(existing.map(x=>[x.phoneNumberId,x.workspaceId.toString()]));
  const session=await MetaActivationSession.create({
   workspaceId:req.workspaceId,initiatedBy:req.user._id,
   businessAccountId:waba,businessPortfolioId:portfolio,
   graphVersion:auth.version,mode,accessTokenEncrypted:encrypt(auth.token),
   phones,expiresAt:new Date(Date.now()+600000)
  });
  res.set('Cache-Control','no-store');
  return res.json({
   sessionId:String(session._id),expiresAt:session.expiresAt,
   wabaId:waba,mode,
   numbers:phones.map(p=>({...p,availability:!mapped.has(p.id)?'available':
    mapped.get(p.id)===String(req.workspaceId)?'already_connected':'in_another_workspace'})),
   remainingSlots:limit.remaining,
   message:'Meta authorization succeeded. Select numbers to activate.'
  });
 }catch(e){
  return res.status(422).json({message:String(e.message||'Meta number discovery failed').slice(0,300)});
 }
});

// Recover an unfinished 10-minute authorization after refreshing the browser.
// Tokens are never included in the response or returned to the frontend.
router.get('/pending',async(req,res)=>{
 try{
  const limit=await allowance(req.workspaceId);
  const session=await MetaActivationSession.findOne({
   workspaceId:req.workspaceId,initiatedBy:req.user._id,
   expiresAt:{$gt:new Date()}
  }).select('-accessTokenEncrypted').sort({createdAt:-1}).lean();
  res.set('Cache-Control','no-store');
  if(!session)return res.json({session:null});
  const existing=await Integration.find({
   provider:'meta',phoneNumberId:{$in:session.phones.map(p=>p.id)}
  }).select('workspaceId phoneNumberId').lean();
  const mapped=new Map(existing.map(i=>[i.phoneNumberId,String(i.workspaceId)]));
  return res.json({
   session:{
    sessionId:String(session._id),
    expiresAt:session.expiresAt,
    wabaId:session.businessAccountId,mode:session.mode,
    numbers:session.phones.map(p=>({...p,availability:
     !mapped.has(p.id)?'available':mapped.get(p.id)===String(req.workspaceId)?
     'already_connected':'in_another_workspace'})),
    remainingSlots:limit.remaining
   }
  });
 }catch(e){
  return res.status(409).json({message:String(e.message||'Unable to read Meta signup state').slice(0,180)});
 }
});

// Only the initiating workspace user can dismiss an unfinished authorization;
// deleting a session NEVER deletes an activated WhatsApp sender.
router.delete('/pending/:id',async(req,res)=>{
 if(!mongoose.isValidObjectId(req.params.id))
  return res.status(400).json({message:'Invalid activation session'});
 await MetaActivationSession.deleteOne({
  _id:req.params.id,workspaceId:req.workspaceId,initiatedBy:req.user._id
 });
 res.set('Cache-Control','no-store');
 return res.json({ok:true});
});

router.post('/activate',async(req,res)=>{
 let lease=null;
 try{
  const id=String(req.body?.sessionId||'');
  if(!mongoose.isValidObjectId(id))return res.status(400).json({message:'Invalid Meta authorization session'});
  const session=await MetaActivationSession.findOne({
   _id:id,workspaceId:req.workspaceId,initiatedBy:req.user._id
  }).select('+accessTokenEncrypted').lean();
  if(activationSessionExpired(session))return res.status(410).json({message:'Meta authorization expired. Sign in again.'});
  const cap=await allowance(req.workspaceId);
  const selected=validateActivationSelection(req.body?.phoneNumberIds,session.phones,cap.remaining);
  const lockToken=crypto.randomUUID(),now=new Date();
  const locked=await Workspace.findOneAndUpdate({
   _id:req.workspaceId,$or:[
    {metaConnectLockExpiresAt:{$exists:false}},
    {metaConnectLockExpiresAt:null},
    {metaConnectLockExpiresAt:{$lte:now}}
   ]
  },{$set:{metaConnectLockToken:lockToken,metaConnectLockExpiresAt:new Date(Date.now()+180000)}});
  if(!locked)return res.status(409).json({message:'A connection is being activated. Try again.'});
  lease=lockToken;
  const latest=await allowance(req.workspaceId);
  if(selected.length>latest.remaining)return res.status(409).json({message:'Subscription slots changed. Select fewer numbers.'});
  const token=decrypt(session.accessTokenEncrypted);
  const results=[];
  let subscribed=null; // Reuse one WABA webhook subscription attempt.
  for(const phoneId of selected){
   let row=null;
   try{
    const already=await Integration.findOne({provider:'meta',phoneNumberId:phoneId})
      .select('workspaceId name').lean();
    if(already){
     results.push({
      phoneNumberId:phoneId,ok:false,alreadyConnected:true,
      reason:String(already.workspaceId)===String(req.workspaceId)
       ?'Already saved in this workspace. Open its existing connection to reauthorize.'
       :'Already assigned to another Clever Connect workspace. Ask the owner before connecting.'
     });
     continue;
    }
    // WABA membership and access are revalidated immediately before any
    // provisioning side effect, even if this phone was visible at prepare time.
    const verified=await verifyExistingCloudApiNumber({
     phoneNumberId:phoneId,businessAccountId:session.businessAccountId,
     accessToken:token,graphVersion:session.graphVersion
    });
    const source=session.phones.find(p=>p.id===phoneId);
    const action=metaNumberRegistrationAction(session.mode,source?.status);
    const pin=action==='register'?String(crypto.randomInt(100000,1000000)):'';
    const count=await Integration.countDocuments({workspaceId:req.workspaceId,provider:'meta'});
    let name=String(verified.verifiedName||source?.verifiedName||verified.displayPhoneNumber||phoneId).slice(0,72);
    if(await Integration.exists({workspaceId:req.workspaceId,name}))
      name=name.slice(0,60)+' · '+phoneId.slice(-6);

    // Persist the integration (including registration PIN) BEFORE making an
    // irreversible Meta registration call. A worker crash won't lose the
    // PIN or silently deregister a number from another provider.
    row=await Integration.create({
     workspaceId:req.workspaceId,name,provider:'meta',
     enabled:true,isDefault:count===0,
     phoneNumberId:phoneId,
     displayPhoneNumber:verified.displayPhoneNumber||source?.displayPhoneNumber||'',
     businessAccountId:session.businessAccountId,
     businessPortfolioId:session.businessPortfolioId,
     accessTokenEncrypted:session.accessTokenEncrypted,
     registrationPinEncrypted:pin?encrypt(pin):'',
     graphVersion:session.graphVersion,connectMethod:'embedded',
     connectionStatus:'error',webhookStatus:'unknown',
     connectedAt:new Date(),lastCheckedAt:new Date(),
     lastError:'Finalizing Meta sender authorization'
    });

    if(action==='register'){
     // Only a NEW, not-yet-connected number may be registered here.
     // Never call /register for existing Cloud API/Coexistence numbers.
     await graph(session.graphVersion,phoneId+'/register',token,'POST',{
      messaging_product:'whatsapp',pin
     });
    }

    let webhookWarning='';
    if(subscribed===null){
     try{
      await graph(session.graphVersion,session.businessAccountId+'/subscribed_apps',token,'POST');
      subscribed={ok:true};
     }catch(e){
      subscribed={ok:false,reason:String(e.message||'Meta webhook subscription failed').slice(0,230)};
     }
    }
    if(!subscribed.ok)webhookWarning='Webhook subscription needs attention: '+subscribed.reason;
    await Integration.updateOne({_id:row._id,workspaceId:req.workspaceId},{
     $set:{
      connectionStatus:'connected',
      webhookStatus:subscribed.ok?'subscribed':'needs_attention',
      lastWebhookCheckedAt:new Date(),
      lastCheckedAt:new Date(),
      lastError:webhookWarning
     }
    });
    results.push({
     phoneNumberId:phoneId,ok:true,
     connection:{id:String(row._id),name:row.name,displayPhoneNumber:row.displayPhoneNumber},
     ...(webhookWarning?{warning:webhookWarning}:{})
    });
   }catch(e){
    // No automatic disconnection. Preserve a partially provisioned number
    // and allow the account owner to repair credentials/status in the UI.
    const reason=String(e.message||'Meta could not activate this number').slice(0,250);
    if(row){
     await Integration.updateOne({_id:row._id,workspaceId:req.workspaceId},
      {$set:{connectionStatus:'error',lastCheckedAt:new Date(),lastError:reason}})
      .catch(err=>console.error('Failed to preserve Meta activation error:',err));
    }
    results.push({
     phoneNumberId:phoneId,ok:false,reason,
     ...(row?{connection:{id:String(row._id),name:row.name,displayPhoneNumber:row.displayPhoneNumber}}:{})
    });
   }
  }
  const updated=await allowance(req.workspaceId);
  res.set('Cache-Control','no-store');
  return res.json({
   activated:results.filter(x=>x.ok).length,results,remainingSlots:updated.remaining,
   message:onboardingResultMessage({
    selected:selected.length,activated:results.filter(x=>x.ok).length,
    attention:results.filter(x=>!x.ok||x.warning).length
   }),
   routingNotice:session.mode==='existing'
    ?'No external provider or conversation routing was changed. If this number is shared across partners under Meta’s current account model, review Conversation Routing in Meta Business Suite to choose which partner handles inbound conversations.'
    :''
  });
 }catch(e){
  return res.status(422).json({message:String(e.message||'Activation failed').slice(0,300)});
 }finally{
  if(lease)await Workspace.updateOne({_id:req.workspaceId,metaConnectLockToken:lease},
   {$unset:{metaConnectLockToken:1,metaConnectLockExpiresAt:1}}).catch(()=>{});
 }
});
export default router;
