import express from 'express';
import {Integration,Delivery} from '../models.js';
import {refreshCampaignTotals} from '../services/scheduler.js';
import {webhookVerifyToken} from '../utils/crypto.js';

const r=express.Router();

r.get('/',(req,res)=>{
  if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===webhookVerifyToken()){
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

r.post('/',async(req,res)=>{
  res.sendStatus(200);
  try{
    for(const entry of req.body.entry||[]){
      for(const change of entry.changes||[]){
        const phoneNumberId=change.value?.metadata?.phone_number_id;
        if(!phoneNumberId) continue;
        const integration=await Integration.findOne({phoneNumberId}).lean();
        if(!integration) continue;
        for(const s of change.value?.statuses||[]){
          const map={sent:'sent',delivered:'delivered',read:'read',failed:'failed'};
          const status=map[s.status];
          if(!status) continue;
          const set={status};
          if(status==='delivered') set.deliveredAt=new Date();
          if(status==='read') set.readAt=new Date();
          if(status==='failed') set.error=s.errors?.[0]?.title||s.errors?.[0]?.message||'Provider reported failure';
          const d=await Delivery.findOneAndUpdate(
            {workspaceId:integration.workspaceId,providerMessageId:s.id},
            {$set:set},
            {new:true}
          );
          if(d?.campaignId) await refreshCampaignTotals(d.campaignId);
        }
      }
    }
  }catch(e){
    console.error('Webhook processing error',e);
  }
});

export default r;
