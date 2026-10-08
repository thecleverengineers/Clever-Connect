import express from 'express';
import {Integration} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {encrypt,decrypt,webhookVerifyToken} from '../utils/crypto.js';

const r=express.Router();
r.use(requireAuth);

r.get('/whatsapp',async(req,res)=>{
  const x=await Integration.findOne({workspaceId:req.workspaceId}).lean();
  res.json({
    provider:x?.provider||'demo',
    enabled:x?.enabled??true,
    phoneNumberId:x?.phoneNumberId||'',
    businessAccountId:x?.businessAccountId||'',
    graphVersion:x?.graphVersion||'v23.0',
    hasAccessToken:!!x?.accessTokenEncrypted,
    webhookVerifyToken:webhookVerifyToken()
  });
});

r.put('/whatsapp',async(req,res)=>{
  const provider=req.body.provider==='meta'?'meta':'demo';
  const update={
    provider,
    enabled:req.body.enabled!==false,
    phoneNumberId:String(req.body.phoneNumberId||'').trim(),
    businessAccountId:String(req.body.businessAccountId||'').trim(),
    graphVersion:/^v\d+\.\d+$/.test(String(req.body.graphVersion||''))?String(req.body.graphVersion):'v23.0'
  };
  if(req.body.accessToken) update.accessTokenEncrypted=encrypt(String(req.body.accessToken).trim());

  const existing=await Integration.findOne({workspaceId:req.workspaceId}).lean();
  if(provider==='meta'&&!update.phoneNumberId) return res.status(400).json({message:'Phone number ID is required for Meta Cloud API'});
  if(provider==='meta'&&!req.body.accessToken&&!existing?.accessTokenEncrypted) return res.status(400).json({message:'Access token is required for Meta Cloud API'});

  const x=await Integration.findOneAndUpdate(
    {workspaceId:req.workspaceId},
    {$set:update},
    {new:true,upsert:true,runValidators:true}
  );
  res.json({
    provider:x.provider,
    enabled:x.enabled,
    phoneNumberId:x.phoneNumberId,
    businessAccountId:x.businessAccountId,
    graphVersion:x.graphVersion,
    hasAccessToken:!!x.accessTokenEncrypted,
    webhookVerifyToken:webhookVerifyToken()
  });
});

r.post('/whatsapp/test',async(req,res)=>{
  const x=await Integration.findOne({workspaceId:req.workspaceId}).lean();
  if(!x||!x.enabled||x.provider==='demo') return res.json({ok:true,provider:'demo',message:'Demo provider is ready'});
  if(!x.phoneNumberId||!x.accessTokenEncrypted) return res.status(400).json({message:'Meta integration is incomplete'});
  try{
    const token=decrypt(x.accessTokenEncrypted);
    const version=x.graphVersion||'v23.0';
    const response=await fetch('https://graph.facebook.com/'+version+'/'+x.phoneNumberId+'?fields=id,display_phone_number,verified_name',{
      headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(12000)
    });
    const data=await response.json();
    if(!response.ok) return res.status(502).json({message:data?.error?.message||'Meta connection test failed'});
    res.json({ok:true,provider:'meta',displayPhoneNumber:data.display_phone_number||'',verifiedName:data.verified_name||''});
  }catch(e){
    res.status(502).json({message:e.name==='TimeoutError'?'Meta connection timed out':e.message});
  }
});

export default r;
