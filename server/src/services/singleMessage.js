// Normalized single-recipient send intent; never turn an unavailable template
// into a freeform message or infer Meta approval from local template text.
export function singleSendMode(body={}){
  const declared=body.sendMode;
  if(declared!==undefined&&declared!=='freeform'&&declared!=='template')
    throw new Error('Choose FreeForm Message or Meta Approved Template');
  const mode=declared|| (body.templateId?'template':'freeform');
  if(mode==='freeform'&&body.templateId)throw new Error('Switch to Meta Approved Template to send a template');
  if(mode==='template'&&!body.templateId)throw new Error('Choose a Meta-approved template');
  return mode;
}

export function resolveSingleRecipientText(text,{name='',phone='',email=''}={}){
  return String(text||'').replace(/{{\s*(name|phone|email)\s*}}/gi,(_,key)=>{
    const vals={name,phone,email};
    return String(vals[key.toLowerCase()]||'');
  });
}

export function singleTemplateValues(templateBody,rawValues,recipient){
  if(!Array.isArray(rawValues)||rawValues.length>20)throw new Error('Maximum 20 template parameters');
  const markers=[...String(templateBody||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(m=>Number(m[1]));
  const required=Math.max(0,...markers);
  if(required>20)throw new Error('Template requires too many parameters');
  if(rawValues.length!==required)throw new Error('Template requires '+required+' variable value(s)');
  const values=rawValues.map(v=>resolveSingleRecipientText(String(v??'').trim(),recipient));
  if(values.some(v=>!v.trim()||v.length>1024))
    throw new Error('Fill every template variable with a value up to 1024 characters');
  return values;
}

export function previewSingleTemplate(body,values=[]){
  return String(body||'').replace(/{{\s*(\d+)\s*}}/g,(_,n)=>values[Number(n)-1]||'{{'+n+'}}');
}
