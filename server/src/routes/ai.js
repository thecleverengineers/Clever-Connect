import express from 'express';
import {AIRecommendation,Workspace} from '../models.js';
import {requireAuth} from '../middleware/auth.js';
import {refreshWorkspaceAccess} from '../plan.js';
import {getOpenAIConfigPublic} from '../openaiConfig.js';
import {buildWorkspaceAIContext,openAIJSON} from '../services/ai.js';
import {cleanBusinessProfile} from '../business.js';

const r=express.Router();
r.use(requireAuth);

const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const num={type:'number'};
const bool={type:'boolean'};

const recommendationItem=obj({
  type:{type:'string',enum:['campaign','message','template']},
  title:str,
  reason:str,
  objective:str,
  audience:str,
  suggestedTime:str,
  message:str,
  templateCategory:{type:'string',enum:['MARKETING','UTILITY','AUTHENTICATION','NONE']},
  confidence:num,
  priority:{type:'string',enum:['high','medium','low']}
});
const recommendationSchema=obj({
  headline:str,
  summary:str,
  recommendations:{type:'array',items:recommendationItem,minItems:3,maxItems:8}
});
const campaignSchema=obj({
  campaignName:str,
  objective:str,
  audienceType:{type:'string',enum:['all','list','contacts']},
  audienceRecommendation:str,
  message:str,
  alternativeMessages:{type:'array',items:str,minItems:2,maxItems:4},
  cta:str,
  recommendedSendTime:str,
  templateRecommended:bool,
  templateCategory:{type:'string',enum:['MARKETING','UTILITY','AUTHENTICATION','NONE']},
  followUp:str,
  reasoningSummary:str
});
const messagesSchema=obj({
  purpose:str,
  messages:{type:'array',minItems:3,maxItems:5,items:obj({
    label:str,body:str,tone:str,cta:str
  })}
});
const templateSchema=obj({
  name:{type:'string',pattern:'^[a-z0-9_]+$'},
  category:{type:'string',enum:['MARKETING','UTILITY','AUTHENTICATION']},
  language:str,
  body:str,
  variables:{type:'array',items:obj({key:str,example:str})},
  reason:str
});
const analysisSchema=obj({
  summary:str,
  findings:{type:'array',items:str,minItems:2,maxItems:8},
  opportunities:{type:'array',items:str,minItems:2,maxItems:8},
  risks:{type:'array',items:str,minItems:1,maxItems:6},
  actions:{type:'array',items:str,minItems:3,maxItems:8}
});
const copilotSchema=obj({
  answer:str,
  actions:{type:'array',maxItems:5,items:obj({
    type:{type:'string',enum:['campaign','message','template','analysis','none']},
    label:str,
    instruction:str
  })}
});

async function requireAIWorkspace(req,res){
  const state=await refreshWorkspaceAccess(req.workspaceId);
  if(!state?.access?.allowed){
    res.status(402).json({message:'An active subscription or valid trial is required to use WA SANTA AI'});
    return null;
  }
  const cfg=await getOpenAIConfigPublic();
  if(!cfg.enabled){
    res.status(503).json({message:'WA SANTA AI is not configured by Super Admin'});
    return null;
  }
  return state.workspace;
}

async function saveOutput(req,kind,title,input,output,model,hours=168){
  return AIRecommendation.create({
    workspaceId:req.workspaceId,
    kind,title,input,output,model,
    createdBy:req.user._id,
    expiresAt:new Date(Date.now()+hours*60*60*1000)
  });
}
const safeText=(v,n=1000)=>String(v||'').trim().slice(0,n);

r.get('/status',async(req,res)=>{
  const [cfg,workspace]=await Promise.all([
    getOpenAIConfigPublic(),
    Workspace.findById(req.workspaceId).lean()
  ]);
  const business={
    businessType:workspace?.businessType||'',
    businessSubtype:workspace?.businessSubtype||'',
    primaryGoal:workspace?.primaryGoal||'',
    productsServices:workspace?.productsServices||'',
    targetCustomers:workspace?.targetCustomers||'',
    country:workspace?.country||'India',
    preferredLanguage:workspace?.preferredLanguage||'English',
    brandTone:workspace?.brandTone||'Professional'
  };
  res.json({
    enabled:cfg.enabled,
    models:{fast:cfg.fastModel,strategy:cfg.strategyModel},
    businessProfile:business,
    profileComplete:!!(business.businessType&&business.primaryGoal)
  });
});

r.put('/business-profile',async(req,res)=>{
  try{
    const profile=cleanBusinessProfile(req.body);
    const workspace=await Workspace.findByIdAndUpdate(
      req.workspaceId,
      {$set:{...profile,aiProfileUpdatedAt:new Date()}},
      {new:true,runValidators:true}
    ).lean();
    await AIRecommendation.deleteMany({workspaceId:req.workspaceId,kind:'recommendations'});
    res.json({ok:true,businessProfile:profile,workspaceId:workspace._id});
  }catch(e){res.status(400).json({message:e.message})}
});

r.get('/recommendations',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const refresh=req.query.refresh==='1';
    if(!refresh){
      const cached=await AIRecommendation.findOne({
        workspaceId:req.workspaceId,kind:'recommendations',
        createdAt:{$gte:new Date(Date.now()-4*60*60*1000)}
      }).sort({createdAt:-1}).lean();
      if(cached)return res.json({recommendations:cached.output,model:cached.model,cached:true,createdAt:cached.createdAt});
    }
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const result=await openAIJSON({
      modelKind:'strategy',
      name:'business_recommendations',
      schema:recommendationSchema,
      instructions:'Generate practical next-best actions based on this business profile and real aggregate workspace performance. Rank opportunities. Suggested times should be business-local suggestions, not guarantees.',
      input:{task:'Recommend campaigns, messages and Meta templates for this WhatsApp business workspace.',context}
    });
    const saved=await saveOutput(req,'recommendations',result.data.headline,{contextVersion:'aggregate-v1'},result.data,result.model,24);
    res.json({recommendations:result.data,model:result.model,cached:false,createdAt:saved.createdAt});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

r.post('/campaign',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const request={
      objective:safeText(req.body.objective,300),
      offer:safeText(req.body.offer,500),
      audienceHint:safeText(req.body.audienceHint,300),
      language:safeText(req.body.language||context.business.preferredLanguage,80),
      tone:safeText(req.body.tone||context.business.brandTone,80)
    };
    if(!request.objective)return res.status(400).json({message:'Campaign objective is required'});
    const result=await openAIJSON({
      modelKind:'strategy',name:'campaign_plan',schema:campaignSchema,
      instructions:'Build a complete but concise WhatsApp campaign draft. Audience recommendations must remain within opted-in non-suppressed contacts. Do not automatically send anything.',
      input:{task:'Create a campaign draft.',request,context}
    });
    await saveOutput(req,'campaign',result.data.campaignName,request,result.data,result.model);
    res.json({campaign:result.data,model:result.model});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

r.post('/messages',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const request={
      purpose:safeText(req.body.purpose,400),
      context:safeText(req.body.context,800),
      language:safeText(req.body.language||context.business.preferredLanguage,80),
      tone:safeText(req.body.tone||context.business.brandTone,80)
    };
    if(!request.purpose)return res.status(400).json({message:'Message purpose is required'});
    const result=await openAIJSON({
      modelKind:'fast',name:'message_variants',schema:messagesSchema,
      instructions:'Generate distinct WhatsApp message variants. Keep them natural, concise and appropriate for the business. Do not imply urgency or scarcity unless supplied by the user.',
      input:{task:'Generate WhatsApp message variants.',request,business:context.business}
    });
    await saveOutput(req,'messages',result.data.purpose,request,result.data,result.model);
    res.json({messages:result.data,model:result.model});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

r.post('/template',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const request={
      purpose:safeText(req.body.purpose,500),
      category:['MARKETING','UTILITY','AUTHENTICATION'].includes(req.body.category)?req.body.category:'UTILITY',
      language:safeText(req.body.language||'en_US',40)
    };
    if(!request.purpose)return res.status(400).json({message:'Template purpose is required'});
    const result=await openAIJSON({
      modelKind:'fast',name:'meta_template_draft',schema:templateSchema,
      instructions:'Draft a Meta WhatsApp template. Use lowercase underscore template names. For non-authentication templates, use positional variables {{1}}, {{2}} only where useful. Do not claim Meta approval.',
      input:{task:'Create a Meta WhatsApp template draft.',request,business:context.business}
    });
    await saveOutput(req,'template',result.data.name,request,result.data,result.model);
    res.json({template:result.data,model:result.model});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

r.post('/analysis',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const result=await openAIJSON({
      modelKind:'strategy',name:'performance_analysis',schema:analysisSchema,
      instructions:'Analyze only the supplied aggregate metrics. Distinguish observations from recommendations. If data is sparse, explicitly say so.',
      input:{task:'Analyze WhatsApp campaign performance and give prioritized improvements.',context}
    });
    await saveOutput(req,'analysis','Performance analysis',{period:'30d'},result.data,result.model,48);
    res.json({analysis:result.data,model:result.model});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

r.post('/copilot',async(req,res)=>{
  try{
    if(!await requireAIWorkspace(req,res))return;
    const message=safeText(req.body.message,1500);
    if(!message)return res.status(400).json({message:'Ask WA SANTA AI a question'});
    const history=(Array.isArray(req.body.history)?req.body.history:[]).slice(-6).map(x=>({
      role:x?.role==='assistant'?'assistant':'user',
      content:safeText(x?.content,1200)
    }));
    const context=await buildWorkspaceAIContext(req.workspaceId);
    const result=await openAIJSON({
      modelKind:'fast',name:'copilot_answer',schema:copilotSchema,
      instructions:'Answer the user as a practical WhatsApp business copilot. Offer actionable next steps but never execute sends. Keep the answer concise and grounded in the supplied aggregate workspace context.',
      input:{task:'Answer the workspace user.',message,history,context}
    });
    await saveOutput(req,'copilot','Copilot', {message},result.data,result.model,24);
    res.json({reply:result.data,model:result.model});
  }catch(e){res.status(e.statusCode||502).json({message:e.message})}
});

export default r;
