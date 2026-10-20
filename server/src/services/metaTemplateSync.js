// Meta's stable template identity for a WABA is (name, language), not the
// remote numeric ID. The remote ID can differ from a locally cached copy.
// The database already enforces a unique index on (workspace, sender, name,
// language), so upsert by exactly that compound key.
export function metaTemplateSyncIdentity(workspaceId,integrationId,row={}){
  const metaTemplateName=String(row.name||'').trim();
  const language=String(row.language||'en_US').trim();
  if(!metaTemplateName||!language)throw new Error('Meta returned a template without a name or language');
  if(!row.id)throw new Error('Meta returned a template without an ID');
  return {workspaceId,integrationId,metaTemplateName,language};
}

export function metaTemplateSyncFields(row={}){
  const body=(Array.isArray(row.components)?row.components:[])
    .find(x=>String(x.type||'').toUpperCase()==='BODY');
  const score=row.quality_score?.score||row.quality_score||'';
  return {
    name:String(row.name||'meta_template'),
    body:String(body?.text||row.name||'Meta template'),
    metaTemplateId:String(row.id||''),
    metaStatus:String(row.status||'UNKNOWN').toUpperCase(),
    metaRejectedReason:String(row.rejected_reason||''),
    metaQualityScore:String(score),
    metaLastSyncedAt:new Date(),
    category:String(row.category||'MARKETING').toUpperCase()
  };
}

// Idempotent across repeated requests AND different Meta IDs for the same
// name/language. On simultaneous sync requests, a unique-index conflict may
// occur at upsert insertion time; update the winning row instead of failing.
export async function upsertRemoteMetaTemplate(TemplateModel,workspaceId,integrationId,row){
  const identity=metaTemplateSyncIdentity(workspaceId,integrationId,row);
  const update={$set:metaTemplateSyncFields(row)};
  try{
    return await TemplateModel.findOneAndUpdate(identity,update,{
      new:true,upsert:true,setDefaultsOnInsert:true,runValidators:true
    });
  }catch(e){
    if(e?.code!==11000)throw e;
    const existing=await TemplateModel.findOneAndUpdate(identity,update,{
      new:true,upsert:false,runValidators:true
    });
    if(existing)return existing;
    throw e;
  }
}
