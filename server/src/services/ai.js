import {Workspace,Contact,Campaign,Delivery,Template,ContactList,Integration} from '../models.js';
import {getOpenAIConfig} from '../openaiConfig.js';

const BASE_INSTRUCTIONS=`
You are WA SANTA AI, a WhatsApp business messaging strategist.
Your job is to create useful, concise, high-quality campaign, message and Meta template recommendations for the workspace.
Never recommend spam, purchased lists, consent bypasses, misleading claims, harassment, discriminatory targeting, or ways to evade WhatsApp/Meta rules.
Only recommend messaging opted-in, non-suppressed contacts.
Never claim a campaign was sent or approved. The human user must review and explicitly send/schedule anything.
Do not invent performance facts. Use only the workspace context provided.
Do not include customer names, phone numbers, emails, or other personal data.
For Meta templates, use neutral wording suitable for review and positional variables such as {{1}}, {{2}}.
`;

function extractText(data){
  if(typeof data?.output_text==='string')return data.output_text;
  for(const item of data?.output||[]){
    for(const part of item?.content||[]){
      if(part?.type==='output_text'&&typeof part.text==='string')return part.text;
    }
  }
  return '';
}

export async function openAIJSON({modelKind='fast',instructions='',input,schema,name='wa_santa_output',maxOutputTokens=2500}){
  const cfg=await getOpenAIConfig();
  if(!cfg.enabled||!cfg.apiKey)throw Object.assign(new Error('OpenAI AI is not configured by Super Admin'),{statusCode:503});
  const model=modelKind==='strategy'?cfg.strategyModel:cfg.fastModel;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:'Bearer '+cfg.apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      instructions:BASE_INSTRUCTIONS+'\n'+String(instructions||''),
      input:typeof input==='string'?input:JSON.stringify(input),
      max_output_tokens:maxOutputTokens,
      text:{format:{type:'json_schema',name,schema,strict:true}}
    }),
    signal:AbortSignal.timeout(45000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=data?.error?.message||'OpenAI request failed';
    throw Object.assign(new Error(message),{statusCode:response.status===401?502:response.status});
  }
  const text=extractText(data);
  if(!text)throw new Error('OpenAI returned no structured output');
  try{
    return {data:JSON.parse(text),model,usage:data.usage||null,responseId:data.id||''};
  }catch{
    throw new Error('OpenAI returned invalid structured output');
  }
}

export async function buildWorkspaceAIContext(workspaceId){
  const since=new Date(Date.now()-30*24*60*60*1000);
  const [workspace,totalContacts,optedIn,pending,suppressed,lists,templates,metaConnections,recentCampaigns,deliveryCounts]=await Promise.all([
    Workspace.findById(workspaceId).lean(),
    Contact.countDocuments({workspaceId}),
    Contact.countDocuments({workspaceId,consentStatus:'opted_in',suppressed:false}),
    Contact.countDocuments({workspaceId,consentStatus:'pending',suppressed:false}),
    Contact.countDocuments({workspaceId,$or:[{suppressed:true},{consentStatus:'opted_out'}]}),
    ContactList.countDocuments({workspaceId}),
    Template.countDocuments({workspaceId}),
    Integration.countDocuments({workspaceId,provider:'meta'}),
    Campaign.find({workspaceId}).sort({createdAt:-1}).limit(10).select('name status audienceType scheduledAt completedAt totals createdAt').lean(),
    Delivery.aggregate([
      {$match:{workspaceId:workspace._id,createdAt:{$gte:since}}},
      {$group:{_id:'$status',count:{$sum:1}}}
    ])
  ]);
  if(!workspace)throw new Error('Workspace unavailable');
  const deliveries=Object.fromEntries(deliveryCounts.map(x=>[x._id,x.count]));
  const submitted=(deliveries.submitted||0)+(deliveries.sent||0)+(deliveries.delivered||0)+(deliveries.read||0)+(deliveries.failed||0);
  const delivered=(deliveries.delivered||0)+(deliveries.read||0);
  return {
    business:{
      name:workspace.name,
      type:workspace.businessType||'Other',
      subtype:workspace.businessSubtype||'',
      primaryGoal:workspace.primaryGoal||'Generate leads',
      productsServices:workspace.productsServices||'',
      targetCustomers:workspace.targetCustomers||'',
      country:workspace.country||'India',
      preferredLanguage:workspace.preferredLanguage||'English',
      brandTone:workspace.brandTone||'Professional'
    },
    audience:{
      totalContacts,optedIn,pending,suppressed,lists
    },
    assets:{templates,metaConnections},
    performance30d:{
      submitted,
      delivered,
      read:deliveries.read||0,
      failed:deliveries.failed||0,
      deliveryRate:submitted?Math.round(delivered/submitted*1000)/10:0,
      readRate:delivered?Math.round((deliveries.read||0)/delivered*1000)/10:0
    },
    recentCampaigns:recentCampaigns.map(x=>({
      name:x.name,status:x.status,audienceType:x.audienceType,
      scheduledAt:x.scheduledAt||null,completedAt:x.completedAt||null,
      totals:x.totals||{}
    }))
  };
}
