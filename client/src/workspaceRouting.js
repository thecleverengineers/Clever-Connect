// Hash routing keeps pages addressable on Render static hosting without
// requiring server-side rewrites. The route is browser history, not a global
// app-wide draft state; every workspace page has a stable URL.
export const WORKSPACE_PAGE_IDS=Object.freeze([
  'overview','ai','send','bulk','campaigns','contacts','schedule',
  'templates','reports','inbox','chatbot','whatsapp-api','payments',
  'subscription','settings','profile','edit-profile','admin'
]);

const known=new Set(WORKSPACE_PAGE_IDS);
export function pageFromHash(hash){
  const match=String(hash||'').match(/^#\/([a-z][a-z0-9-]*)\/?$/i);
  const id=match?.[1]?.toLowerCase();
  return id&&known.has(id)?id:null;
}
export function allowedWorkspacePage(id,{allowed=true,isSuperAdmin=false}={}){
  const requested=known.has(id)?id:'overview';
  if(requested==='admin'&&!isSuperAdmin)return allowed?'overview':'subscription';
  if(!allowed&&!['subscription','profile','edit-profile','admin'].includes(requested))return 'subscription';
  return requested;
}
export function resolveWorkspacePage(hash,access){
  return allowedWorkspacePage(pageFromHash(hash)||'overview',access);
}
export function workspacePageHash(id){return '#/'+(known.has(id)?id:'overview')}
