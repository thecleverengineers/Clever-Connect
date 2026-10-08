import crypto from 'node:crypto';
import {decrypt} from '../utils/crypto.js';
import {PaymentOrder} from '../paymentModels.js';

export const normalizedPhone=phone=>String(phone||'').replace(/\D/g,'');
export const safeReference=()=>('WS'+crypto.randomBytes(12).toString('hex')).slice(0,35);

export function buildOrderDetails({to,referenceId,title,amountPaise,configurationName}){
  if(!/^\d{8,15}$/.test(to))throw new Error('Invalid WhatsApp recipient number');
  if(!/^[A-Za-z0-9_-]{1,35}$/.test(referenceId))throw new Error('Invalid order reference');
  if(!Number.isSafeInteger(amountPaise)||amountPaise<100||amountPaise>100000000)throw new Error('Amount must be between ₹1 and ₹10,00,000');
  if(!configurationName||configurationName.length>60)throw new Error('A Razorpay configuration name is required');
  const name=String(title||'').trim().slice(0,120);
  if(!name)throw new Error('Order title is required');
  return {
    messaging_product:'whatsapp',recipient_type:'individual',to,type:'interactive',
    interactive:{
      type:'order_details',
      body:{text:'Please review and pay for '+name+'.'},
      action:{name:'review_and_pay',parameters:{
        reference_id:referenceId,type:'digital-goods',currency:'INR',
        total_amount:{value:amountPaise,offset:100},
        payment_settings:[{type:'payment_gateway',payment_gateway:{type:'razorpay',configuration_name:configurationName}}],
        order:{status:'pending',items:[{retailer_id:referenceId,name,amount:{value:amountPaise,offset:100},quantity:1}],subtotal:{value:amountPaise,offset:100}}
      }}
    }
  };
}

async function metaCall(integration,path,options={}){
  if(integration.provider!=='meta'||!integration.enabled||!integration.phoneNumberId||!integration.accessTokenEncrypted)throw new Error('This WhatsApp profile is not ready for payments');
  const token=decrypt(integration.accessTokenEncrypted);
  const version=/^v\d+\.\d+$/.test(integration.graphVersion||'')?integration.graphVersion:'v23.0';
  const response=await fetch('https://graph.facebook.com/'+version+'/'+integration.phoneNumberId+path,{
    method:options.method||'GET',
    headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})},
    body:options.body?JSON.stringify(options.body):undefined,
    signal:AbortSignal.timeout(15000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error?.message||'Meta payment request failed');
  return payload;
}

export async function sendOrderDetails(integration,order){
  const message=buildOrderDetails({
    to:normalizedPhone(order.phone),referenceId:order.referenceId,title:order.title,
    amountPaise:order.amountPaise,configurationName:order.configurationName
  });
  const result=await metaCall(integration,'/messages',{method:'POST',body:message});
  if(!result.messages?.[0]?.id)throw new Error('Meta returned no WhatsApp message ID');
  return result.messages[0].id;
}

// Always verify against Meta's payment lookup: webhook notification alone is never proof of payment.
export async function reconcileOrder(order,integration){
  if(!order||!integration||String(order.integrationId)!==String(integration._id))throw new Error('Order or Meta profile mismatch');
  const path='/payments/'+encodeURIComponent(order.configurationName)+'/'+encodeURIComponent(order.referenceId);
  const result=await metaCall(integration,path);
  const now=new Date();
  const reference=String(result.reference_id||'');
  const amount=result.amount;
  const moneyOk=amount&&Number(amount.value)===order.amountPaise&&Number(amount.offset)===100;
  if(reference!==order.referenceId||result.currency!=='INR'||!moneyOk){
    await PaymentOrder.updateOne({_id:order._id,workspaceId:order.workspaceId},{$set:{
      status:'verification_pending',lastCheckedAt:now,lastError:'Payment lookup did not match reference, currency and amount'
    }});
    throw new Error('Payment verification mismatch; manual review required');
  }
  const remoteStatus=String(result.status||'').toLowerCase();
  const allowed=['new','pending','captured','failed','canceled'];
  if(!allowed.includes(remoteStatus))throw new Error('Unknown Meta payment status');
  const status=remoteStatus==='new'?'pending':remoteStatus;
  const update={status,lastCheckedAt:now,lastError:''};
  if(status==='captured'){
    update.capturedAt=order.capturedAt||now;
    update.paymentId=String(result.id||result.transaction_id||'').slice(0,128);
  }
  // A delayed pending/failed lookup must never undo an already captured payment.
  const filter={_id:order._id,workspaceId:order.workspaceId};
  if(status!=='captured')filter.status={$ne:'captured'};
  return await PaymentOrder.findOneAndUpdate(filter,{$set:update},{new:true})
    ||await PaymentOrder.findOne({_id:order._id,workspaceId:order.workspaceId});
}
