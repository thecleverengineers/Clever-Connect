// Meta template components are declarative. Approval and actual sendability
// belong to Meta, never to local CRM draft/recommendation logic.
const categories=new Set(['MARKETING','UTILITY','AUTHENTICATION']);
const formats=new Set(['NONE','TEXT','IMAGE','VIDEO','DOCUMENT']);
const types=new Set(['QUICK_REPLY','URL','PHONE_NUMBER']);
const safeStr=(v,max=1024)=>String(v??'').trim().slice(0,max);
export function normalizeTemplate(input={}){
  const category=safeStr(input.category,32).toUpperCase()||'MARKETING';
  if(!categories.has(category))throw new Error('Unsupported template category');
  const headerFormat=safeStr(input.headerFormat,32).toUpperCase()||'NONE';
  if(!formats.has(headerFormat))throw new Error('Unsupported header type');
  const name=safeStr(input.name,120);
  const metaTemplateName=safeStr(input.metaTemplateName||name,512).toLowerCase()
    .replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');
  if(!name||!metaTemplateName)throw new Error('Template name is required');
  const body=safeStr(input.body,1024);
  if(!body&&category!=='AUTHENTICATION')throw new Error('Message body is required');
  const language=safeStr(input.language||'en_US',24);
  if(!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language))throw new Error('Choose a valid Meta language code');
  const headerText=safeStr(input.headerText,60);
  const footerText=safeStr(input.footerText,60);
  const headerHandle=safeStr(input.headerHandle,2048);
  const headerMediaUrl=safeStr(input.headerMediaUrl,2048);
  if(headerMediaUrl){
    let url;try{url=new URL(headerMediaUrl)}catch{}
    if(url?.protocol!=='https:'||url.username||url.password)
      throw new Error('Media sending URL must be a public HTTPS URL');
  }
  const rawButtons=Array.isArray(input.buttons)?input.buttons:[];
  if(rawButtons.length>10)throw new Error('Meta supports up to 10 template buttons');
  const buttons=rawButtons.map((x,i)=>{
    const type=safeStr(x.type,24).toUpperCase();
    const text=safeStr(x.text,25);
    if(!types.has(type))throw new Error('Unsupported template button type');
    if(!text)throw new Error('Button '+(i+1)+' requires text');
    const url=safeStr(x.url,2048),phoneNumber=safeStr(x.phoneNumber,25);
    if(type==='QUICK_REPLY'&&text.length>25)throw new Error('Quick reply label is too long');
    if(type==='URL'&&(!/^https:\/\//i.test(url)||!url.startsWith('https://')))throw new Error('URL buttons require HTTPS destination');
    if(type==='PHONE_NUMBER'&&!/^\+?[0-9 +()-]{8,25}$/.test(phoneNumber))throw new Error('Invalid call button number');
    return {type,text,url:type==='URL'?url:'',phoneNumber:type==='PHONE_NUMBER'?phoneNumber:''};
  });
  if(buttons.filter(b=>b.type==='URL').length>2||buttons.filter(b=>b.type==='PHONE_NUMBER').length>1)
    throw new Error('Too many URL or call buttons');
  const bodyExamples=Array.isArray(input.bodyExamples)?input.bodyExamples.map(x=>safeStr(x,120))
    :typeof input.bodyExamples==='string'?input.bodyExamples.split(',').map(x=>safeStr(x,120)):[];
  if(category==='AUTHENTICATION'&&(headerFormat!=='NONE'||buttons.length||footerText))
    throw new Error('Authentication uses the standard Meta OTP format without custom header or buttons');
  return {name,metaTemplateName,category,language,body:category==='AUTHENTICATION'?'Authentication OTP':body,
    headerFormat,headerText,footerText,headerHandle,headerMediaUrl,buttons,bodyExamples};
}
export function bodySample(body,examples){
  const numbers=[...String(body||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(x=>Number(x[1]));
  if(!numbers.length)return undefined;
  const max=Math.max(...numbers);
  if(max>20||max<1||numbers.some(n=>!Number.isSafeInteger(n))||
    new Set(numbers).size!==max)throw new Error('Use contiguous variables {{1}}, {{2}} up to {{20}}');
  if(examples.length<max||examples.slice(0,max).some(x=>!String(x||'').trim()))
    throw new Error('Provide a sample value for every body variable');
  return {body_text:[examples.slice(0,max)]};
}
export function createMetaTemplatePayload(data){
  const d=normalizeTemplate(data);
  if(d.category==='AUTHENTICATION')return {
    name:d.metaTemplateName,language:d.language,category:d.category,components:[
      {type:'BODY',add_security_recommendation:true},
      {type:'FOOTER',code_expiration_minutes:10},
      {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy Code'}]}
    ]
  };
  const components=[];
  if(d.headerFormat==='TEXT'){
    if(!d.headerText)throw new Error('Text header cannot be empty');
    if(/{{\s*\d+\s*}}/.test(d.headerText))throw new Error('Header variables are not yet supported');
    components.push({type:'HEADER',format:'TEXT',text:d.headerText});
  }else if(['IMAGE','VIDEO','DOCUMENT'].includes(d.headerFormat)){
    if(!d.headerHandle)throw new Error('Upload a Meta sample media file for the '+d.headerFormat+' header');
    if(!d.headerMediaUrl)throw new Error('Provide a public HTTPS media URL to send the approved media template');
    components.push({type:'HEADER',format:d.headerFormat,example:{header_handle:[d.headerHandle]}});
  }
  const body={type:'BODY',text:d.body};
  const sample=bodySample(d.body,d.bodyExamples);
  if(sample)body.example=sample;
  components.push(body);
  if(d.footerText)components.push({type:'FOOTER',text:d.footerText});
  if(d.buttons.length)components.push({type:'BUTTONS',buttons:d.buttons.map(b=>{
    if(b.type==='URL')return {type:'URL',text:b.text,url:b.url};
    if(b.type==='PHONE_NUMBER')return {type:'PHONE_NUMBER',text:b.text,phone_number:b.phoneNumber};
    return {type:'QUICK_REPLY',text:b.text};
  })});
  return {name:d.metaTemplateName,language:d.language,category:d.category,components};
}
export function remoteTemplateFields(row={}){
  const components=Array.isArray(row.components)?row.components:[];
  const body=components.find(c=>c.type==='BODY');
  const header=components.find(c=>c.type==='HEADER');
  const footer=components.find(c=>c.type==='FOOTER');
  const buttonComp=components.find(c=>c.type==='BUTTONS');
  const status=safeStr(row.status||'UNKNOWN',60).toUpperCase();
  return {
    name:safeStr(row.name||'Meta template'),metaTemplateName:safeStr(row.name),
    body:safeStr(body?.text||'Authentication OTP',1024),
    language:safeStr(row.language||'en_US',24),
    category:safeStr(row.category||'MARKETING',32).toUpperCase(),
    headerFormat:safeStr(header?.format||'NONE',24).toUpperCase(),
    headerText:safeStr(header?.text,60),footerText:safeStr(footer?.text,60),
    buttons:(buttonComp?.buttons||[]).filter(b=>types.has(b.type)).map(b=>({
      type:b.type,text:safeStr(b.text,25),url:safeStr(b.url,2048),
      phoneNumber:safeStr(b.phone_number,25)
    })),
    metaStatus:status,
    metaRejectedReason:safeStr(row.rejected_reason||row.rejection_reason||row.status_reason||'',500),
    metaQualityScore:safeStr(row.quality_score?.score||row.quality_score,80),
    metaLastSyncedAt:new Date()
  };
}
export function isTemplateUsable(template,connection){
  return template?.metaStatus==='APPROVED'&&!!template.metaTemplateId&&
    !!template.metaTemplateName&&!!connection&&
    connection.provider==='meta'&&connection.enabled===true&&
    connection.planAllowed!==false&&
    (connection.connectionStatus===undefined||connection.connectionStatus==='connected')&&
    String(template.integrationId?._id||template.integrationId)===String(connection._id||connection.id)&&
    !['AUTHENTICATION'].includes(template.category)&&
    (!['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat)||!!template.headerMediaUrl);
}
export function recommendTemplate(templates=[],query=''){
  const tokens=[...new Set(String(query).toLowerCase().match(/[a-z0-9]{3,}/g)||[])].slice(0,15);
  if(!tokens.length)return [];
  return templates.filter(x=>x.metaStatus==='APPROVED').map(x=>{
    const corpus=(x.name+' '+x.body+' '+x.category).toLowerCase();
    return {...x,matchScore:tokens.filter(t=>corpus.includes(t)).length};
  }).filter(x=>x.matchScore>0).sort((a,b)=>b.matchScore-a.matchScore).slice(0,5);
}
export function draftRecommendation(query='',category='UTILITY'){
  const purpose=safeStr(query,160);
  if(!purpose)throw new Error('Describe the message you need');
  const name='suggested_'+purpose.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,35);
  return {name,metaTemplateName:name,category:categories.has(category)?category:'UTILITY',
    language:'en_US',body:'Hello {{1}}, '+purpose.replace(/[.!?]+$/,'')+'.',
    bodyExamples:['Alex'],headerFormat:'NONE',buttons:[],footerText:'',isSuggestedDraft:true};
}
