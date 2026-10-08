import {SystemSetting} from './models.js';
import {encrypt,decrypt} from './utils/crypto.js';

const KEY='openai_ai';

export async function getOpenAIConfig(){
  const row=await SystemSetting.findOne({key:KEY}).lean();
  let apiKey='';
  if(row?.openaiApiKeyEncrypted){
    try{apiKey=decrypt(row.openaiApiKeyEncrypted)}catch{}
  }
  if(!apiKey)apiKey=String(process.env.OPENAI_API_KEY||'').trim();
  const fastModel=String(row?.openaiFastModel||process.env.OPENAI_FAST_MODEL||'gpt-6-luna').trim();
  const strategyModel=String(row?.openaiStrategyModel||process.env.OPENAI_STRATEGY_MODEL||'gpt-6-sol').trim();
  const enabled=row?row.openaiEnabled!==false:!!apiKey;
  return {apiKey,fastModel,strategyModel,enabled:!!(enabled&&apiKey),source:row?'admin':'environment'};
}

export async function getOpenAIConfigPublic(){
  const x=await getOpenAIConfig();
  return {
    enabled:x.enabled,
    hasApiKey:!!x.apiKey,
    fastModel:x.fastModel,
    strategyModel:x.strategyModel,
    source:x.source
  };
}

export async function saveOpenAIConfig({apiKey,fastModel,strategyModel,enabled,updatedBy}){
  const existing=await SystemSetting.findOne({key:KEY});
  const update={
    openaiFastModel:String(fastModel||'gpt-6-luna').trim(),
    openaiStrategyModel:String(strategyModel||'gpt-6-sol').trim(),
    openaiEnabled:enabled!==false,
    updatedBy:updatedBy||null
  };
  if(apiKey)update.openaiApiKeyEncrypted=encrypt(String(apiKey).trim());
  const row=await SystemSetting.findOneAndUpdate(
    {key:KEY},
    {$set:update,$setOnInsert:{key:KEY}},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
  if(!apiKey&&!existing?.openaiApiKeyEncrypted&&!process.env.OPENAI_API_KEY)throw new Error('OpenAI API key is required the first time');
  return row;
}

export async function clearOpenAIKey(updatedBy){
  await SystemSetting.findOneAndUpdate(
    {key:KEY},
    {$set:{openaiApiKeyEncrypted:'',openaiEnabled:false,updatedBy:updatedBy||null}},
    {new:true,upsert:true,setDefaultsOnInsert:true}
  );
}
