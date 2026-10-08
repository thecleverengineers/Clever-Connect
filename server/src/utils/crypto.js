import crypto from 'node:crypto';

export function appSecret(){
  const value=process.env.AUTH_KEY||process.env.JWT_SECRET||'';
  if(!value&&process.env.NODE_ENV==='production') throw new Error('AUTH_KEY or JWT_SECRET is required');
  return value||'dev-only';
}

function key(){
  const raw=process.env.CREDENTIAL_ENCRYPTION_KEY||'';
  if(/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw,'hex');
  return crypto.createHash('sha256').update(appSecret()).digest();
}

export function webhookVerifyToken(){
  if(process.env.META_WEBHOOK_VERIFY_TOKEN) return process.env.META_WEBHOOK_VERIFY_TOKEN;
  return crypto.createHash('sha256').update(appSecret()+'|clever-connect-meta-webhook').digest('hex').slice(0,40);
}

export function encrypt(value=''){
  if(!value) return '';
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return iv.toString('hex')+'.'+tag.toString('hex')+'.'+encrypted.toString('hex');
}

export function decrypt(payload=''){
  if(!payload) return '';
  const [ivHex,tagHex,dataHex]=payload.split('.');
  if(!ivHex||!tagHex||!dataHex) throw new Error('Stored integration credential is invalid');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(ivHex,'hex'));
  decipher.setAuthTag(Buffer.from(tagHex,'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex,'hex')),decipher.final()]).toString('utf8');
}
