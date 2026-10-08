import {ChatConversation,ChatMessage,ChatFlow} from '../chatModels.js';
import {Contact,Delivery} from '../models.js';
import {sendWhatsApp} from './whatsapp.js';

export const digits=v=>String(v||'').replace(/\D/g,'');
export function inboundText(message){
  return String(message.text?.body||message.interactive?.button_reply?.title||
    message.interactive?.list_reply?.title||message.button?.text||
    message.image?.caption||message.document?.caption||'').slice(0,4096);
}
export function inboundValue(message){
  return String(message.interactive?.button_reply?.id||message.interactive?.list_reply?.id||
    message.button?.payload||inboundText(message)).trim();
}
export async function conversationFor(integration,phone){
  const normalized=digits(phone);
  if(!/^\d{8,15}$/.test(normalized))throw new Error('Invalid chat participant');
  let row=await ChatConversation.findOne({workspaceId:integration.workspaceId,integrationId:integration._id,phone:normalized});
  if(row)return row;
  const contact=await Contact.findOne({workspaceId:integration.workspaceId,phone:'+'+normalized}).select('_id').lean();
  return ChatConversation.findOneAndUpdate(
    {workspaceId:integration.workspaceId,integrationId:integration._id,phone:normalized},
    {$setOnInsert:{contactId:contact?._id||null}},
    {upsert:true,new:true,setDefaultsOnInsert:true}
  );
}
export async function recordOutbound({integration,phone,text,providerMessageId,status='submitted',source='agent',campaignId=null,deliveryId=null}){
  const convo=await conversationFor(integration,phone);
  let message=null;
  if(providerMessageId){
    message=await ChatMessage.findOneAndUpdate(
      {integrationId:integration._id,providerMessageId},
      {$setOnInsert:{
        workspaceId:integration.workspaceId,conversationId:convo._id,integrationId:integration._id,
        phone:digits(phone),direction:'out',source,campaignId,deliveryId,
        type:'text',text:String(text||'').slice(0,4096),status
      }},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
  }
  await ChatConversation.updateOne({_id:convo._id},
    {$set:{lastMessageAt:new Date(),lastPreview:String(text||'').slice(0,180)}});
  return message;
}
export async function recordInbound(integration,inbound){
  const phone=digits(inbound.from);
  const providerMessageId=String(inbound.id||'');
  if(!providerMessageId||!/^\d{8,15}$/.test(phone))return null;
  const existing=await ChatMessage.findOne({integrationId:integration._id,providerMessageId}).lean();
  if(existing)return {fresh:false,message:existing};
  const convo=await conversationFor(integration,phone);
  const text=inboundText(inbound);
  const value=inboundValue(inbound);
  const timestamp=Number(inbound.timestamp)*1000;
  const at=Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp):new Date();
  let row;
  try{
    row=await ChatMessage.create({
      workspaceId:integration.workspaceId,conversationId:convo._id,integrationId:integration._id,
      phone,direction:'in',type:['text','image','video','document','audio','interactive'].includes(inbound.type)?inbound.type:'unknown',
      text:text||('['+String(inbound.type||'message')+']'),source:'customer',providerMessageId,replyToId:String(inbound.context?.id||''),
      metaTimestamp:at,status:'received'
    });
  }catch(e){
    if(e.code===11000)return {fresh:false,message:await ChatMessage.findOne({integrationId:integration._id,providerMessageId}).lean()};
    throw e;
  }
  if(row.replyToId){
    // Attribute replies to a campaign only when Meta supplies an explicit
    // reply context referencing the provider ID of our actual campaign message.
    const referenced=await ChatMessage.findOne({
      integrationId:integration._id,providerMessageId:row.replyToId,
      workspaceId:integration.workspaceId,campaignId:{$ne:null}
    }).lean();
    if(referenced?.campaignId){
      row.campaignId=referenced.campaignId;
      await row.save();
      if(referenced.deliveryId)await Delivery.updateOne(
        {_id:referenced.deliveryId,workspaceId:integration.workspaceId},
        {$set:{repliedAt:at}}
      );
    }
  }
  const contact=await Contact.findOne({workspaceId:integration.workspaceId,phone:'+'+phone}).select('_id').lean();
  await ChatConversation.updateOne({_id:convo._id},{$set:{
    lastMessageAt:at,lastInboundAt:at,lastPreview:row.text,
    ...(contact?{contactId:contact._id}:{})
  },$inc:{unreadCount:1}});
  return {fresh:true,message:row,conversation:convo,value};
}
function matchFlow(flow,value){
  if(flow.triggerType==='any')return true;
  if(!flow.triggerText)return false;
  const v=String(value||'').toLowerCase().trim();
  const match=flow.triggerText.toLowerCase().trim();
  return flow.triggerType==='exact'?v===match:v.includes(match);
}
export function validateFlow(body){
  const name=String(body.name||'').trim();
  const triggerType=['contains','exact','any'].includes(body.triggerType)?body.triggerType:'contains';
  const triggerText=String(body.triggerText||'').trim().slice(0,100);
  if(!name||name.length>100)throw new Error('Enter a flow name (up to 100 characters)');
  if(triggerType!=='any'&&!triggerText)throw new Error('Enter the trigger keyword');
  const input=body.nodes;
  if(!Array.isArray(input)||input.length<1||input.length>50)throw new Error('Use 1–50 flow steps');
  const nodes=input.map((n,i)=>{
    const id=String(n.id||'').trim();
    const type=String(n.type||'');
    const text=String(n.text||'').trim();
    const nextId=String(n.nextId||'').trim();
    if(!/^[a-zA-Z0-9_-]{1,40}$/.test(id))throw new Error('Invalid node ID at step '+(i+1));
    if(!['message','buttons','handoff','end'].includes(type))throw new Error('Unsupported node type');
    if(['message','buttons'].includes(type)&&(!text||text.length>1024))throw new Error('Messages must have 1–1024 characters');
    const choices=type==='buttons'?(n.choices||[]).map((c,index)=>{
      const id=String(c.id||'').trim(),label=String(c.label||'').trim(),nextId=String(c.nextId||'').trim();
      if(!/^[a-zA-Z0-9_-]{1,40}$/.test(id)||!label||label.length>20)throw new Error('Invalid button '+(index+1));
      return {id,label,nextId};
    }):[];
    if(type==='buttons'&&(choices.length<1||choices.length>3))throw new Error('Buttons nodes allow 1–3 replies');
    if(new Set(choices.map(x=>x.id)).size!==choices.length)throw new Error('Button IDs must be unique');
    return {id,type,text,nextId,choices};
  });
  const ids=new Set(nodes.map(n=>n.id));
  if(ids.size!==nodes.length)throw new Error('Node IDs must be unique');
  const startNodeId=String(body.startNodeId||nodes[0].id);
  if(!ids.has(startNodeId))throw new Error('Start node does not exist');
  for(const n of nodes){
    if(n.nextId&&!ids.has(n.nextId))throw new Error('Missing next step '+n.nextId);
    for(const c of n.choices)if(c.nextId&&!ids.has(c.nextId))throw new Error('Missing button target '+c.nextId);
  }
  return {name,triggerType,triggerText,startNodeId,nodes,priority:Math.max(-100,Math.min(100,Number(body.priority)||0)),enabled:body.enabled===true};
}

async function sendNode(integration,convo,flow,node){
  if(!node)return;
  if(node.type==='handoff'){
    convo.botPaused=true;convo.activeFlowId=null;convo.awaitingNodeId='';
    await convo.save();return;
  }
  if(node.type==='end'){
    convo.activeFlowId=null;convo.awaitingNodeId='';await convo.save();return;
  }
  const buttons=node.type==='buttons'?node.choices.map(c=>({id:c.id,title:c.label})):null;
  const result=await sendWhatsApp({
    workspaceId:integration.workspaceId,phone:convo.phone,text:node.text,integrationId:integration._id,
    buttons
  });
  await recordOutbound({integration,phone:convo.phone,text:node.text,
    providerMessageId:result.id,status:result.status,source:'chatbot'});
  convo.activeFlowId=flow._id;
  convo.awaitingNodeId=node.id;
  await convo.save();
}
export async function processInboundFlow(integration,inbound,convo,value){
  if(convo.botPaused)return;
  let flow=null,node=null;
  if(convo.activeFlowId&&convo.awaitingNodeId){
    flow=await ChatFlow.findOne({_id:convo.activeFlowId,workspaceId:integration.workspaceId,integrationId:integration._id,enabled:true});
    const previous=flow?.nodes.find(x=>x.id===convo.awaitingNodeId);
    if(previous){
      const selected=previous.choices?.find(c=>c.id===value||c.label.toLowerCase()===String(value).toLowerCase());
      const nextId=selected?.nextId||(!previous.choices?.length?previous.nextId:'');
      node=flow.nodes.find(x=>x.id===nextId);
      if(!node&&previous.choices?.length)return;
    }
  }
  if(!node){
    const flows=await ChatFlow.find({workspaceId:integration.workspaceId,integrationId:integration._id,enabled:true}).sort({priority:-1,createdAt:1});
    flow=flows.find(x=>matchFlow(x,value));
    node=flow?.nodes.find(x=>x.id===flow.startNodeId);
  }
  if(!flow||!node)return;
  await sendNode(integration,convo,flow,node);
}
