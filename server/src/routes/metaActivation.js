import express from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {Integration,MetaActivationSession,Workspace} from '../models.js';
import {refreshWorkspaceAccess,metaEntitlements} from '../plan.js';
import {getMetaConfig} from '../metaConfig.js';
import {encrypt,decrypt} from '../utils/crypto.js';
import {cleanMetaId,validMetaPhoneList,validateActivationSelection,activationSessionExpired,assertSignupMatchesSelection,shouldRegisterDuringActivation} from '../services/metaActivation.js';
import {verifyExistingCloudApiNumber} from '../services/existingMetaNumber.js';

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
  const selectedId=String(req.body?.phoneNumberId||'').trim();
  if(mode==='existing'&&!selectedId)
   return res.status(400).json({message:'Select an existing Cloud API phone number before connecting'});
  assertSignupMatchesSelection({
   expectedWabaId:String(req.body?.expectedBusinessAccountId||'').trim(),
   authorizedWabaId:waba,
   expectedPhoneNumberId:String(req.body?.expectedPhoneNumberId||'').trim(),
   returnedPhoneNumberId:String(req.body?.metaReportedPhoneNumberId||'').trim()
  });
  const auth=await exchange(code);
  const found=[];let after='';
  for(let i=0;i<3;i++){
   const q=waba+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100'+
    (after?'&after='+encodeURIComponent(after):'');
   const page=await graph(auth.version,q,auth.token);
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
   phones.push({id:selectedId,displayPhoneNumber:verified.displayPhoneNumber,verifiedName:verified.verifiedName});
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
   numbers:phones.map(p=>({...p,availability:!mapped.has(p.id)?'available':
    mapped.get(p.id)===String(req.workspaceId)?'already_connected':'in_another_workspace'})),
   remainingSlots:limit.remaining,
   message:'Meta authorization succeeded. Select numbers to activate.'
  });
 }catch(e){
  return res.status(422).json({message:String(e.message||'Meta number discovery failed').slice(0,300)});
 }
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
  await graph(session.graphVersion,session.businessAccountId+'/subscribed_apps',token,'POST');
  const results=[];
  for(const phoneId of selected){
   try{
    if(await Integration.exists({provider:'meta',phoneNumberId:phoneId})){
     results.push({phoneNumberId:phoneId,ok:false,reason:'This number is already linked to a workspace'});
     continue;
    }
    const verified=await verifyExistingCloudApiNumber({
     phoneNumberId:phoneId,businessAccountId:session.businessAccountId,
     accessToken:token,graphVersion:session.graphVersion
    });
    let warning='',registrationPin='';
    if(shouldRegisterDuringActivation(session.mode)){
     registrationPin=String(crypto.randomInt(100000,1000000));
     try{
      await graph(session.graphVersion,phoneId+'/register',token,'POST',{
       messaging_product:'whatsapp',pin:registrationPin
      });
     }catch(e){warning=String(e.message||'Number registration failed').slice(0,240)}
    }
    const count=await Integration.countDocuments({workspaceId:req.workspaceId,provider:'meta'});
    const source=session.phones.find(p=>p.id===phoneId);
    let name=String(verified.verifiedName||source?.verifiedName||verified.displayPhoneNumber||phoneId).slice(0,72);
    if(await Integration.exists({workspaceId:req.workspaceId,name}))name=name.slice(0,60)+' · '+phoneId.slice(-6);
    const row=await Integration.create({
     workspaceId:req.workspaceId,name,provider:'meta',
     enabled:!warning,isDefault:count===0&&!warning,
     phoneNumberId:phoneId,displayPhoneNumber:verified.displayPhoneNumber||source?.displayPhoneNumber||'',
     businessAccountId:session.businessAccountId,businessPortfolioId:session.businessPortfolioId,
     accessTokenEncrypted:session.accessTokenEncrypted,
     registrationPinEncrypted:registrationPin?encrypt(registrationPin):'',
     graphVersion:session.graphVersion,connectMethod:'embedded',
     connectionStatus:warning?'error':'connected',
     connectedAt:new Date(),lastCheckedAt:new Date(),lastError:warning
    });
    results.push({phoneNumberId:phoneId,ok:!warning,
     connection:{id:String(row._id),name:row.name,displayPhoneNumber:row.displayPhoneNumber},
     ...(warning?{reason:'Saved but Meta registration needs attention: '+warning}:{})});
   }catch(e){
    results.push({phoneNumberId:phoneId,ok:false,reason:String(e.message||'Could not activate').slice(0,230)});
   }
  }
  const updated=await allowance(req.workspaceId);
  res.set('Cache-Control','no-store');
  return res.json({
   activated:results.filter(x=>x.ok).length,results,remainingSlots:updated.remaining,
   message:results.filter(x=>x.ok).length+' WhatsApp number(s) activated.'
  });
 }catch(e){
  return res.status(422).json({message:String(e.message||'Activation failed').slice(0,300)});
 }finally{
  if(lease)await Workspace.updateOne({_id:req.workspaceId,metaConnectLockToken:lease},
   {$unset:{metaConnectLockToken:1,metaConnectLockExpiresAt:1}}).catch(()=>{});
 }
});
export default router;
