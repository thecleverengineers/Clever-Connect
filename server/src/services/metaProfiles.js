// Workspace-scoped summary for independently connected Meta senders.
// One profile = one Meta Phone Number ID; WABAs and portfolios may have many
// profiles. Never group across workspaces or infer that a provider owns an app.
export function summarizeMetaProfiles(connections=[]){
  const profiles=(Array.isArray(connections)?connections:[]).filter(x=>x.provider==='meta');
  const groups=new Map();
  const portfolios=new Set();
  let ready=0,needsAttention=0,planRestricted=0;
  for(const x of profiles){
    const wabaId=String(x.businessAccountId||'').trim();
    const portfolioId=String(x.businessPortfolioId||'').trim();
    const key=portfolioId+'|'+(wabaId||'unassigned:'+String(x.id||x._id||x.phoneNumberId));
    if(portfolioId)portfolios.add(portfolioId);
    const active=x.enabled!==false&&x.connectionStatus==='connected'&&x.planAllowed!==false;
    if(active)ready++;
    else needsAttention++;
    if(x.planAllowed===false)planRestricted++;
    if(!groups.has(key))groups.set(key,{
      key, businessPortfolioId:portfolioId,businessAccountId:wabaId,
      profileIds:[],phoneCount:0,readyCount:0,needsAttentionCount:0
    });
    const group=groups.get(key);
    group.profileIds.push(String(x.id||x._id||''));
    group.phoneCount++;
    if(active)group.readyCount++;
    else group.needsAttentionCount++;
  }
  return {
    total:profiles.length,ready,needsAttention,planRestricted,
    businessAccounts:groups.size,businessPortfolios:portfolios.size,
    groups:[...groups.values()]
  };
}
