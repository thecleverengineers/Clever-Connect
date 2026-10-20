// Reconcile Meta template snapshots using their WABA-local identity.
// Meta's numeric template ID can change, while MongoDB enforces uniqueness
// on workspaceId/integrationId/metaTemplateName/language. Never upsert by ID.
export function metaTemplateIdentity(workspaceId,integrationId,remote){
  const metaTemplateName=String(remote?.name||'').trim();
  const language=String(remote?.language||'').trim();
  if(!metaTemplateName||!language||!remote?.id)return null;
  return {workspaceId,integrationId,metaTemplateName,language};
}

export async function reconcileMetaTemplate(TemplateModel,identity,fields){
  const update={$set:{...fields,metaTemplateId:String(fields.metaTemplateId||'')}};
  try{
    return await TemplateModel.findOneAndUpdate(identity,update,{
      new:true,upsert:true,setDefaultsOnInsert:true,runValidators:true
    });
  }catch(e){
    if(e?.code!==11000)throw e;
    // Concurrent sync/create may win the unique-index race. Updating the
    // winner is safe; inserting another row or deleting existing drafts isn't.
    const winner=await TemplateModel.findOneAndUpdate(identity,update,{
      new:true,upsert:false,runValidators:true
    });
    if(winner)return winner;
    throw e;
  }
}
