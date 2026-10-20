// Shared validation and safe text personalization for chatbot attributes.
export const RESERVED_FLOW_ATTRIBUTES=['customer_name','customer_mobile','customer_email','catalog'];
export function validateAttributeKey(value){
  const key=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9_]{1,47}$/.test(key))throw new Error('Attribute key must be 2–48 lowercase letters, digits or underscores, starting with a letter');
  if(RESERVED_FLOW_ATTRIBUTES.includes(key))throw new Error('This attribute name is reserved for a built-in customer field');
  return key;
}
export function publicAttribute(a){
  return {
    _id:a._id,scope:a.scope,key:a.key,label:a.label,enabled:a.enabled!==false,
    isSecret:!!a.isSecret,hasValue:!!(a.isSecret?a.secretEncrypted:a.value),
    value:a.isSecret?'':String(a.value||''),createdAt:a.createdAt,updatedAt:a.updatedAt
  };
}
export function renderFlowText(template,{contact={},globals=[],values={}}={}){
  const builtins=Object.assign(Object.create(null),{
    customer_name:String(contact.name||''),
    customer_mobile:String(contact.phone||''),
    customer_email:String(contact.email||''),
    catalog:''
  });
  for(const a of globals){
    if(a.scope==='global'&&a.enabled!==false&&!a.isSecret){
      builtins[String(a.key)]=String(a.value||'');
    }
  }
  for(const [key,value]of Object.entries(values||{})){
    if(/^[a-z][a-z0-9_]{1,47}$/.test(key)&&!Object.prototype.hasOwnProperty.call(builtins,key)){
      builtins[key]=String(value??'');
    }
  }
  // Never expand arbitrary paths or hidden secret values.
  return String(template||'').replace(/{{\s*([a-z][a-z0-9_]{1,47})\s*}}/gi,(_,key)=>builtins[key.toLowerCase()]??'').slice(0,1024);
}
