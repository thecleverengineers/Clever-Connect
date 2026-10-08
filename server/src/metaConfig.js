import {SystemSetting} from './models.js';
import {encrypt,decrypt} from './utils/crypto.js';

const KEY='meta_embedded_signup';

export async function getMetaConfig(){
  const row=await SystemSetting.findOne({key:KEY}).lean();
  const appId=String(row?.metaAppId||process.env.META_APP_ID||'').trim();
  const configId=String(row?.metaEmbeddedSignupConfigId||process.env.META_EMBEDDED_SIGNUP_CONFIG_ID||'').trim();
  const graphVersion=String(row?.metaGraphVersion||process.env.META_GRAPH_VERSION||'v23.0').trim();
  let appSecret='';
  if(row?.metaAppSecretEncrypted){
    try{appSecret=decrypt(row.metaAppSecretEncrypted)}catch{}
  }
  if(!appSecret)appSecret=String(process.env.META_APP_SECRET||'').trim();
  return {
    appId,configId,appSecret,graphVersion,
    enabled:!!(appId&&configId&&appSecret),
    missing:[
      !appId?'META_APP_ID':'',
      !configId?'META_EMBEDDED_SIGNUP_CONFIG_ID':'',
      !appSecret?'META_APP_SECRET':''
    ].filter(Boolean),
    source:row?'admin':'environment'
  };
}

export async function getMetaConfigPublic(){
  const x=await getMetaConfig();
  return {
    enabled:x.enabled,
    appId:x.appId,
    configId:x.configId,
    graphVersion:x.graphVersion,
    hasAppSecret:!!x.appSecret,
    missing:x.missing,
    source:x.source
  };
}

export async function saveMetaConfig({appId,appSecret,configId,graphVersion,updatedBy}){
  const update={
    metaAppId:String(appId||'').trim(),
    metaEmbeddedSignupConfigId:String(configId||'').trim(),
    metaGraphVersion:/^v\d+\.\d+$/.test(String(graphVersion||''))?String(graphVersion):'v23.0',
    updatedBy:updatedBy||null
  };
  if(appSecret)update.metaAppSecretEncrypted=encrypt(String(appSecret).trim());
  const row=await SystemSetting.findOneAndUpdate(
    {key:KEY},
    {$set:update,$setOnInsert:{key:KEY}},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
  return row;
}

export async function clearMetaAppSecret(updatedBy){
  await SystemSetting.findOneAndUpdate(
    {key:KEY},
    {$set:{metaAppSecretEncrypted:'',updatedBy:updatedBy||null}},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
}
