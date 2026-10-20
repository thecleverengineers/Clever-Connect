// Never confuse a customer's Clever Connect login with authentication of a
// separate WhatsApp Cloud API sender. Meta may reject expired credentials,
// missing asset access or missing whatsapp_business_messaging permission.
const AUTH_CODES=new Set(['10','190','200','131005']);
const AUTH_SUBCODES=new Set(['458','459','460','463','464','467']);
const AUTH_TEXT=/authentication error|oauth(?:exception)?|access token (?:expired|invalid)|(?:missing|insufficient|denied) permission|not authorized|permission denied|does not have the permission/i;

export function classifyMetaSendError({httpStatus=0,error={}}={}){
  const code=String(error?.code??'');
  const subcode=String(error?.error_subcode??'');
  const raw=String(error?.message||error?.error_user_msg||'');
  const authFailure=AUTH_CODES.has(code)||AUTH_SUBCODES.has(subcode)||
    ([401,403].includes(Number(httpStatus))&&AUTH_TEXT.test(raw))||
    AUTH_TEXT.test(raw);
  if(authFailure){
    return {
      code:'META_SENDER_AUTH_REQUIRED',
      message:'Meta rejected the WhatsApp sender credentials or permissions. Open WhatsApp Manager → Numbers, edit this sender’s access token, then run Test / Sync. The token must authorize this Phone Number ID and include whatsapp_business_messaging permission.',
      metaCode:code,
      senderAuthFailure:true
    };
  }
  return {
    code:'META_SEND_REJECTED',
    message:raw||'Meta rejected the WhatsApp message.',
    metaCode:code,
    senderAuthFailure:false
  };
}
