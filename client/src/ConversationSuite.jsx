import React,{useEffect,useMemo,useState} from 'react';
import {api} from './api.js';
import './conversationSuite.css';

const date=v=>v?new Date(v).toLocaleString([],{dateStyle:'short',timeStyle:'short'}):'—';
const clean=v=>String(v||'').toLowerCase();
export function Inbox(){
  const [conversations,setConversations]=useState([]);
  const [selected,setSelected]=useState('');
  const [data,setData]=useState(null);
  const [search,setSearch]=useState('');
  const [reply,setReply]=useState('');
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const [notice,setNotice]=useState('');
  async function refreshList(){
    const list=await api('/inbox/conversations',{fresh:true});
    setConversations(list);
    setSelected(id=>list.some(x=>x._id===id)?id:(list[0]?._id||''));
  }
  async function refreshMessages(id){
    if(!id)return;
    const x=await api('/inbox/conversations/'+id+'/messages',{fresh:true});
    setData(x);
  }
  useEffect(()=>{
    let live=true;
    async function tick(){try{const x=await api('/inbox/conversations',{fresh:true});if(!live)return;
      setConversations(x);
      setSelected(old=>{
        const linked=sessionStorage.getItem('wa:open-chat');
        if(linked){
          const match=x.find(c=>c.phone===linked.replace(/\D/g,''));
          if(match){sessionStorage.removeItem('wa:open-chat');return match._id}
        }
        return x.some(c=>c._id===old)?old:x[0]?._id||''
      });
    }catch(e){if(live)setErr(e.message)}}
    tick();const interval=setInterval(tick,5000);
    return()=>{live=false;clearInterval(interval)};
  },[]);
  useEffect(()=>{
    if(!selected)return;
    let live=true;
    async function tick(){try{
      const x=await api('/inbox/conversations/'+selected+'/messages',{fresh:true});
      if(live)setData(x);
    }catch(e){if(live)setErr(e.message)}}
    tick();const interval=setInterval(tick,4000);
    return()=>{live=false;clearInterval(interval)};
  },[selected]);
  const active=conversations.find(c=>c._id===selected);
  const matches=useMemo(()=>conversations.filter(c=>
    clean(c.contactId?.name||c.phone).includes(clean(search))||clean(c.phone).includes(clean(search))),[conversations,search]);
  const recent=active?.lastInboundAt&&Date.now()-new Date(active.lastInboundAt).getTime()<24*60*60*1000;
  async function send(e){
    e.preventDefault();if(!selected||!reply.trim())return;
    setBusy(true);setErr('');setNotice('');
    try{
      await api('/inbox/conversations/'+selected+'/reply',{method:'POST',body:JSON.stringify({text:reply})});
      setReply('');setNotice('Reply submitted to Meta.');
      await Promise.all([refreshMessages(selected),refreshList()]);
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function setAgent(paused){
    if(!selected)return;
    try{
      await api('/inbox/conversations/'+selected+'/agent',{method:'PUT',body:JSON.stringify({botPaused:paused})});
      await Promise.all([refreshMessages(selected),refreshList()]);
    }catch(e){setErr(e.message)}
  }
  async function markRead(id){
    setSelected(id);
    try{
      await api('/inbox/conversations/'+id+'/read',{method:'POST'});
      setConversations(s=>s.map(x=>x._id===id?{...x,unreadCount:0}:x));
    }catch(e){setErr(e.message)}
  }
  return <div className="page">
    <div className="title"><div><span>WA SANTA · CONVERSATIONS</span><h1>Live chat inbox</h1>
      <p>Reply to contacts who message your Meta WhatsApp number, including campaign responses. Refreshes automatically every few seconds.</p></div></div>
    {err&&<div className="notice bad">{err}</div>}{notice&&<div className="notice">{notice}</div>}
    <div className="liveChatGrid">
      <aside className="chatThreads">
        <input placeholder="Search contact or phone" value={search} onChange={e=>setSearch(e.target.value)}/>
        {matches.map(c=><button className={'chatThread '+(c._id===selected?'selected':'')} key={c._id} onClick={()=>markRead(c._id)}>
          <span className="chatCircle">{(c.contactId?.name||c.phone||'?')[0]?.toUpperCase()}</span>
          <span className="chatThreadText"><b>{c.contactId?.name||'+'+c.phone}</b><small>{c.lastPreview||'New conversation'}</small>
            <small>{c.integrationId?.name||'WhatsApp profile'} · {date(c.lastMessageAt)}</small></span>
          {c.unreadCount>0&&<span className="chatUnread">{c.unreadCount}</span>}
        </button>)}
        {!matches.length&&<div className="chatEmpty">No conversations. New customer messages will appear here after Meta webhook delivery.</div>}
      </aside>
      <section className="chatWindow">
        {!active?<div className="chatEmpty">Choose a conversation from the left to read and reply.</div>:<>
          <div className="chatTop">
            <div><b>{active.contactId?.name||'+'+active.phone}</b><small>+{active.phone} · {recent?'24-hour session open':'24-hour session closed'}</small></div>
            <div className="chatControls">
              <button onClick={()=>setAgent(!active.botPaused)}>{active.botPaused?'Resume chatbot':'Take over chat'}</button>
              <button onClick={()=>refreshMessages(selected)}>Refresh</button>
            </div>
          </div>
          <div className="chatMessages" key={selected}>
            {(data?.messages||[]).map(m=><div key={m._id} className={'chatBubble '+(m.direction==='out'?'out':'in')}>
              <div>{m.text||'['+m.type+']'}</div>
              {m.campaignId&&<small>Campaign reply / message</small>}
              <small>{date(m.metaTimestamp||m.createdAt)} · {m.direction==='out'?m.status:m.type}</small>
            </div>)}
            {!data?.messages?.length&&<div className="chatEmpty">No messages stored in this conversation yet.</div>}
          </div>
          <form className="chatReply" onSubmit={send}>
            <textarea rows={2} maxLength={4096} placeholder={recent?'Write a WhatsApp reply…':'24-hour session expired. Start with an approved template from Campaigns.'}
              value={reply} onChange={e=>setReply(e.target.value)} disabled={!recent}/>
            <button className="primary" disabled={!recent||busy||!reply.trim()}>{busy?'Sending…':'Send reply'}</button>
          </form>
        </>}
      </section>
    </div>
  </div>;
}

const freshNode=(i=1)=>({id:'step_'+i,type:'message',text:'Hello! How can we help you?',nextId:'',choices:[]});
const freshFlow=profile=>({
 name:'Welcome chatbot',integrationId:profile,triggerType:'contains',triggerText:'hello',
 priority:0,enabled:false,startNodeId:'step_1',nodes:[freshNode(1)]
});
export function FlowBuilder(){
  const [profiles,setProfiles]=useState([]);
  const [flows,setFlows]=useState([]);
  const [editing,setEditing]=useState(null);
  const [selected,setSelected]=useState(0);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const [notice,setNotice]=useState('');
  async function reload(){
    const [p,f]=await Promise.all([api('/integrations/whatsapp-connections',{fresh:true}),api('/flows',{fresh:true})]);
    setProfiles((p.connections||[]).filter(x=>x.provider==='meta'&&x.enabled));setFlows(f);
    return p.connections||[];
  }
  useEffect(()=>{reload().catch(e=>setErr(e.message))},[]);
  const nodes=editing?.nodes||[];
  const focused=nodes[Math.min(selected,nodes.length-1)];
  const setField=(key,value)=>setEditing(x=>({...x,[key]:value}));
  function updateNode(index,patch){
    setEditing(x=>({...x,nodes:x.nodes.map((node,i)=>i===index?{...node,...patch}:node)}));
  }
  function addNode(type){
    setEditing(x=>{
      const id='step_'+Math.random().toString(36).slice(2,9);
      return {...x,nodes:[...x.nodes,{id,type,text:type==='handoff'?'A team member will reply shortly.':type==='buttons'?'Please choose an option.':'Thanks for messaging!',nextId:'',choices:type==='buttons'?[{id:'option_1',label:'Continue',nextId:''}]:[]}]};
    });
    setSelected(nodes.length);
  }
  function removeNode(id){
    if(nodes.length<=1)return;
    setEditing(x=>{
      const filtered=x.nodes.filter(n=>n.id!==id).map(n=>({...n,nextId:n.nextId===id?'':n.nextId,
        choices:n.choices.map(c=>({...c,nextId:c.nextId===id?'':c.nextId}))}));
      return {...x,nodes:filtered,startNodeId:x.startNodeId===id?filtered[0].id:x.startNodeId};
    });setSelected(0);
  }
  async function save(e){
    e.preventDefault();setBusy(true);setErr('');setNotice('');
    try{
      const id=editing._id;
      await api('/flows'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(editing)});
      await reload();setEditing(null);setNotice('Chatbot flow saved. Enabled flows respond to customer messages matching their trigger.');
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function removeFlow(f){
    if(!confirm('Delete '+f.name+'?'))return;
    try{await api('/flows/'+f._id,{method:'DELETE'});await reload()}catch(e){setErr(e.message)}
  }
  return <div className="page">
    <div className="title"><div><span>WA SANTA · AUTOMATION</span><h1>Chatbot & Flow builder</h1>
      <p>Build keyword-triggered, visual WhatsApp conversation flows using native text and quick-reply buttons. Add a human handoff whenever needed.</p>
    </div><button className="primary" disabled={!profiles.length} onClick={()=>{setEditing(freshFlow(profiles[0]?.id));setSelected(0)}}>+ Create flow</button></div>
    {err&&<div className="notice bad">{err}</div>}{notice&&<div className="notice">{notice}</div>}
    {!profiles.length&&<div className="notice bad">Connect an active Meta WhatsApp profile first.</div>}
    {!editing?<div className="cards campaignCards">{flows.map(f=><article key={f._id}>
      <div className="cardTop"><div><small>CHATBOT FLOW</small><h3>{f.name}</h3></div>
        <em className={'status '+(f.enabled?'completed':'scheduled')}>{f.enabled?'Enabled':'Draft'}</em></div>
      <p>{f.triggerType==='any'?'Any inbound message':f.triggerType+' · '+f.triggerText} · {f.nodes?.length||0} steps</p>
      <footer><span>Priority {f.priority||0}</span><div className="rowActions">
        <button onClick={()=>{setEditing({...f,integrationId:String(f.integrationId?._id||f.integrationId)});setSelected(0)}}>Edit flow</button>
        <button className="danger" onClick={()=>removeFlow(f)}>Delete</button>
      </div></footer>
    </article>)}{!flows.length&&<div className="chatEmpty">No bot flows yet. Create a welcome flow with a keyword and message steps.</div>}</div>:
      <form className="flowEditor" onSubmit={save}>
        <div className="flowConfig">
          <label>Flow name<input required maxLength={100} value={editing.name} onChange={e=>setField('name',e.target.value)}/></label>
          <label>Meta profile<select required value={editing.integrationId} onChange={e=>setField('integrationId',e.target.value)}>
            {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Trigger<select value={editing.triggerType} onChange={e=>setField('triggerType',e.target.value)}>
            <option value="contains">Message contains</option><option value="exact">Exact match</option><option value="any">Any inbound message</option></select></label>
          <label>Keyword<input value={editing.triggerText} disabled={editing.triggerType==='any'} onChange={e=>setField('triggerText',e.target.value)} placeholder="hello"/></label>
          <label>Priority<input type="number" min="-100" max="100" value={editing.priority} onChange={e=>setField('priority',Number(e.target.value))}/></label>
          <label>First step<select value={editing.startNodeId} onChange={e=>setField('startNodeId',e.target.value)}>
            {nodes.map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select></label>
          <label className="flowCheck"><input type="checkbox" checked={editing.enabled} onChange={e=>setField('enabled',e.target.checked)}/> Enable chatbot</label>
        </div>
        <div className="flowWorkspace">
          <div className="flowDiagram">
            <h3>Flow map</h3><small>Select a step to edit. Connect steps using the Next-step fields.</small>
            {nodes.map((n,i)=><React.Fragment key={n.id}>
              <button type="button" className={'flowNode '+(selected===i?'active':'')} onClick={()=>setSelected(i)}>
                <b>{i+1}. {n.type==='message'?'Send text':n.type==='buttons'?'Reply buttons':n.type==='handoff'?'Human takeover':'End flow'}</b>
                <small>{n.text?.slice(0,100)||'No message'}</small>
                <small>{n.nextId?'→ '+n.nextId:n.choices?.length?'Button branches':'No next step'}</small>
              </button>{i<nodes.length-1&&<span className="flowConnector">↓</span>}
            </React.Fragment>)}
            <div className="flowAdd">
              <button type="button" onClick={()=>addNode('message')} disabled={nodes.length>=50}>+ Text</button>
              <button type="button" onClick={()=>addNode('buttons')} disabled={nodes.length>=50}>+ Buttons</button>
              <button type="button" onClick={()=>addNode('handoff')} disabled={nodes.length>=50}>+ Handoff</button>
              <button type="button" onClick={()=>addNode('end')} disabled={nodes.length>=50}>+ End</button>
            </div>
          </div>
          {focused&&<div className="flowInspector">
            <div className="sectionHead"><div><h3>Configure {focused.id}</h3><small>{focused.type} step</small></div>
              <button className="danger" type="button" disabled={nodes.length===1} onClick={()=>removeNode(focused.id)}>Remove step</button></div>
            <label>Step type<select value={focused.type} onChange={e=>updateNode(selected,{type:e.target.value,choices:e.target.value==='buttons'?[{id:'option_1',label:'Continue',nextId:''}]:[]})}>
              <option value="message">Send text</option><option value="buttons">Quick reply buttons</option>
              <option value="handoff">Human takeover</option><option value="end">End flow</option></select></label>
            {['message','buttons'].includes(focused.type)&&<label>WhatsApp message<textarea rows={5} maxLength={1024} value={focused.text} onChange={e=>updateNode(selected,{text:e.target.value})}/></label>}
            {focused.type==='message'&&<label>Next step (after next inbound response)<select value={focused.nextId||''} onChange={e=>updateNode(selected,{nextId:e.target.value})}>
              <option value="">Finish / await new keyword</option>{nodes.filter(n=>n.id!==focused.id).map(n=><option key={n.id} value={n.id}>{n.id} · {n.type}</option>)}</select></label>}
            {focused.type==='buttons'&&<div className="flowChoices">
              <h4>Quick replies — up to 3</h4>
              {(focused.choices||[]).map((c,i)=><div className="flowChoice" key={i}>
                <label>Button label<input value={c.label} maxLength={20} onChange={e=>updateNode(selected,{choices:focused.choices.map((x,j)=>i===j?{...x,label:e.target.value}:x)})}/></label>
                <label>Reply ID<input value={c.id} onChange={e=>updateNode(selected,{choices:focused.choices.map((x,j)=>i===j?{...x,id:e.target.value}:x)})}/></label>
                <label>Go to<select value={c.nextId||''} onChange={e=>updateNode(selected,{choices:focused.choices.map((x,j)=>i===j?{...x,nextId:e.target.value}:x)})}>
                  <option value="">No next step</option>{nodes.filter(n=>n.id!==focused.id).map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select></label>
                <button type="button" disabled={focused.choices.length===1} onClick={()=>updateNode(selected,{choices:focused.choices.filter((_,j)=>j!==i)})}>Remove</button>
              </div>)}
              <button type="button" disabled={focused.choices.length>=3} onClick={()=>updateNode(selected,{choices:[...focused.choices,{id:'option_'+(focused.choices.length+1),label:'New choice',nextId:''}]})}>+ Add button</button>
            </div>}
            <p className="flowHelp">Chatbot responses are only sent within an active 24-hour customer-service window. A handoff stops automation until the agent resumes it.</p>
          </div>}
        </div>
        <div className="flowFooter"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save flow'}</button></div>
      </form>}
  </div>;
}
