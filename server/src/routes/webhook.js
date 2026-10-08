import express from 'express';
import crypto from 'node:crypto';
import {Integration,Delivery} from '../models.js';
import {PaymentOrder,InboundWindow} from '../paymentModels.js';
import {reconcileOrder,normalizedPhone} from '../services/paymentCheckout.js';
import {refreshCampaignTotals} from '../services/scheduler.js';
import {webhookVerifyToken} from '../utils/crypto.js';
import {getMetaConfig} from '../metaConfig.js';
import {recordInbound,processInboundFlow} from '../services/liveChat.js';
import {ChatMessage} from '../chatModels.js';

const r=express.Router();

r.get('/',(req,res)=>{
  if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===webhookVerifyToken()){
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

async function verifySignature(req){
  const secret=(await getMetaConfig()).appSecret;
  const received=String(req.get('x-hub-signature-256')||'');
  if(!secret||!req.rawBody||!/^sha256=[a-f0-9]{64}$/i.test(received))return false;
  const expected='sha256='+crypto.createHmac('sha256',secret).update(req.rawBody).digest('hex');
  const a=Buffer.from(expected),b=Buffer.from(received.toLowerCase());
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

r.post('/',async(req,res)=>{
  if(!await verifySignature(req))return res.status(403).json({message:'Invalid Meta webhook signature'});
  res.sendStatus(200);
  try{
    for(const entry of req.body.entry||[]){
      for(const change of entry.changes||[]){
        const phoneNumberId=change.value?.metadata?.phone_number_id;
        if(!phoneNumberId)continue;
        const integration=await Integration.findOne({phoneNumberId,provider:'meta'}).lean();
        if(!integration)continue;
        // Incoming signed customer messages are the only authority for 24h freeform windows.
        for(const message of change.value?.messages||[]){
          const phone=normalizedPhone(message.from);
          const ms=Number(message.timestamp)*1000;
          if(!/^[0-9]{8,15}$/.test(phone)||!Number.isFinite(ms)||ms>Date.now()+60000||ms<Date.now()-48*3600000)continue;
          await InboundWindow.updateOne(
            {workspaceId:integration.workspaceId,integrationId:integration._id,phone},
            {$max:{lastInboundAt:new Date(ms)}},
            {upsert:true}
          );
          try{
            const received=await recordInbound(integration,message);
            if(received?.fresh&&received.conversation){
              try{await processInboundFlow(integration,message,received.conversation,received.value)}
              catch(e){console.error('Chatbot flow execution failed',e)}
            }
          }catch(e){console.error('Incoming chat persistence failed',e)}
        }
        for(const s of change.value?.statuses||[]){
          if(s.type==='payment'||s.payment?.reference_id){
            const ref=String(s.payment?.reference_id||'');
            const order=await PaymentOrder.findOne({
              workspaceId:integration.workspaceId,integrationId:integration._id,referenceId:ref
            });
            if(order&&order.messageId){
              try{await reconcileOrder(order,integration)}
              catch(e){console.error('WA SANTA payment lookup failed',order.referenceId,e.message)}
            }
            continue;
          }
          const map={sent:'sent',delivered:'delivered',read:'read',failed:'failed'};
          const status=map[s.status];
          if(!status)continue;
          const set={status};
          if(status==='delivered')set.deliveredAt=new Date();
          if(status==='read')set.readAt=new Date();
          if(status==='failed')set.error=s.errors?.[0]?.title||s.errors?.[0]?.message||'Provider reported failure';
          const d=await Delivery.findOneAndUpdate(
            {workspaceId:integration.workspaceId,providerMessageId:s.id},
            {$set:set},{new:true}
          );
          await ChatMessage.updateOne({integrationId:integration._id,providerMessageId:s.id},
            {$set:{status,error:status==='failed'?set.error||'Delivery failed':''}}).catch(console.error);
          if(d?.campaignId)await refreshCampaignTotals(d.campaignId);
        }
      }
    }
  }catch(e){console.error('Meta webhook processing error',e)}
});
export default r;
