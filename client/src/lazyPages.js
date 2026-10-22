import {lazy} from 'react';

// Only download the code for a module when its route is visited or
// intentionally prefetched. Avoid loading every editor, inbox, and analytics
// component on the login screen or the workspace home page.
const loaders={
  ai:()=>import('./AICopilot.jsx'),
  send:()=>import('./SendMessage.jsx'),
  bulk:()=>import('./BulkWhatsApp.jsx'),
  templates:()=>import('./MetaTemplateManager.jsx'),
  inbox:()=>import('./ConversationSuite.jsx'),
  chatbot:()=>import('./FlowStudio.jsx'),
  payments:()=>import('./Payments.jsx')
};

export const LazyAICopilot=lazy(loaders.ai);
export const LazySendMessage=lazy(loaders.send);
export const LazyBulkWhatsApp=lazy(loaders.bulk);
export const LazyMetaTemplateManager=lazy(loaders.templates);
export const LazyInbox=lazy(async()=>{
  const module=await loaders.inbox();
  return {default:module.Inbox};
});
export const LazyFlowStudio=lazy(loaders.chatbot);
export const LazyPayments=lazy(loaders.payments);

const pending=new Map();
export function prefetchPageModule(page){
  const loader=loaders[page];
  if(!loader)return Promise.resolve();
  if(pending.has(page))return pending.get(page);
  const promise=loader().catch(()=>{pending.delete(page)});
  pending.set(page,promise);
  return promise;
}
