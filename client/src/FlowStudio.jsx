import React,{useEffect,useMemo,useRef,useState} from 'react';
import {api} from './api.js';
import './flowStudio.css';

const nodeKinds=[
  {type:'message',label:'Message',icon:'▤',group:'MESSAGE TYPES',ready:true,description:'Send a text reply'},
  {type:'buttons',label:'Reply buttons',icon:'◫',group:'MESSAGE TYPES',ready:true,description:'Offer 1–3 choices'},
  {type:'handoff',label:'Human handoff',icon:'♧',group:'ACTIONS',ready:true,description:'Pause bot for an agent'},
  {type:'end',label:'End flow',icon:'◉',group:'ACTIONS',ready:true,description:'Clear active flow'},
  {type:'media',label:'Media',icon:'▧',group:'MESSAGE TYPES',description:'Coming in a later release'},
  {type:'list',label:'List',icon:'☷',group:'MESSAGE TYPES',description:'Coming in a later release'},
  {type:'template',label:'Template',icon:'▣',group:'MESSAGE TYPES',description:'Coming in a later release'},
  {type:'cta',label:'CTA button',icon:'↗',group:'MESSAGE TYPES',description:'Coming in a later release'},
  {type:'location',label:'Location',icon:'⌖',group:'MESSAGE TYPES',description:'Coming in a later release'},
  {type:'delay',label:'Delay',icon:'◷',group:'UTILITY',description:'Needs a persistent scheduler'},
  {type:'condition',label:'Condition',icon:'◇',group:'UTILITY',description:'Coming in a later release'},
  {type:'assign',label:'Assign conversation',icon:'♧',group:'ACTIONS',description:'Coming in a later release'},
  {type:'unassign',label:'Unassign conversation',icon:'♙',group:'ACTIONS',description:'Coming in a later release'},
  {type:'resolve',label:'Close conversation',icon:'✓',group:'ACTIONS',description:'Coming in a later release'},
  {type:'api',label:'API request',icon:'◎',group:'CONNECTIONS',description:'Secure integration action not yet configured'}
];
const attrsBuiltIn=[
  {key:'customer_name',label:'Customer name'},
  {key:'customer_mobile',label:'Customer phone'},
  {key:'customer_email',label:'Customer email'}
];
const makeNode=(type='message',index=0)=>({
  id:'step_'+Math.random().toString(36).slice(2,10),
  type,text:type==='message'?'Hello {{customer_name}}! How can we help you?':type==='buttons'?'Please choose an option.':type==='handoff'?'A team member will reply shortly.':'',
  nextId:'',choices:type==='buttons'?[{id:'option_1',label:'Continue',nextId:''}]:[],
  position:{x:210+(index%3)*255,y:155+Math.floor(index/3)*190}
});
function newFlow(profile,name){
  const first=makeNode('message',0);first.id='start';
  return {name, integrationId:profile,triggerType:'contains',triggerText:'hello',
    priority:0,enabled:false,startNodeId:first.id,nodes:[first]};
}
function noticeText(e){return e?.message||'Unable to save changes'}
function NodeCanvas({flow,selected,onSelect,onMove}){
  const [zoom,setZoom]=useState(1);
  const pointer=useRef(null);
  const scrollRef=useRef(null);
  const nodes=flow.nodes||[];
  const position=(n,i)=>n.position&&Number.isFinite(+n.position.x)&&Number.isFinite(+n.position.y)
    ?{x:+n.position.x,y:+n.position.y}:{x:210+(i%3)*260,y:155+Math.floor(i/3)*185};
  const positions=nodes.map(position);
  const height=Math.max(650,...positions.map(p=>p.y+210));
  const width=Math.max(940,...positions.map(p=>p.x+305));
  const lookup=new Map(nodes.map((n,i)=>[n.id,{...positions[i],index:i}]));
  const edges=nodes.flatMap((n,i)=>{
    const links=[...(n.nextId?[{id:n.nextId,label:''}]:[]),...(n.choices||[]).filter(c=>c.nextId).map(c=>({id:c.nextId,label:c.label}))];
    return links.filter(c=>lookup.has(c.id)).map((c,j)=>{
      const src=positions[i],dst=lookup.get(c.id);
      const sx=src.x+100,sy=src.y+108,tx=dst.x+100,ty=dst.y;
      const middle=sy+(ty-sy)*.5;
      return {key:n.id+'-'+c.id+'-'+j,path:`M ${sx} ${sy} C ${sx} ${middle}, ${tx} ${middle}, ${tx} ${ty}`,label:c.label,
        lx:(sx+tx)/2,ly:(sy+ty)/2};
    });
  });
  function moveStart(e,n,i){
    if(e.button!==0&&e.pointerType==='mouse')return;
    e.preventDefault();
    const p=position(n,i);
    pointer.current={id:n.id,pointerId:e.pointerId,ox:e.clientX,oy:e.clientY,x:p.x,y:p.y,zoom};
    try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}
  }
  function move(e){
    if(!pointer.current||e.pointerId!==pointer.current.pointerId)return;
    const p=pointer.current;
    onMove(p.id,{x:Math.max(10,Math.min(3600,Math.round(p.x+(e.clientX-p.ox)/p.zoom))),
      y:Math.max(85,Math.min(3600,Math.round(p.y+(e.clientY-p.oy)/p.zoom)))});
  }
  function stop(e){
    if(pointer.current?.pointerId===e.pointerId)pointer.current=null;
  }
  return <div className="flowCanvasShell">
    <div className="flowCanvasBar">
      <div><b>Visual workflow canvas</b><small>Drag card headers to rearrange · Select a node to edit · Set links in the inspector</small></div>
      <div className="flowZoomControls">
        <button type="button" title="Zoom out" onClick={()=>setZoom(z=>Math.max(.55,+(z-.1).toFixed(2)))}>−</button>
        <span>{Math.round(zoom*100)}%</span>
        <button type="button" title="Zoom in" onClick={()=>setZoom(z=>Math.min(1.25,+(z+.1).toFixed(2)))}>+</button>
        <button type="button" title="Reset zoom" onClick={()=>{setZoom(1);if(scrollRef.current){scrollRef.current.scrollLeft=0;scrollRef.current.scrollTop=0}}}>Fit</button>
      </div>
    </div>
    <div className="flowCanvasViewport" ref={scrollRef} aria-label="Workflow canvas">
      <div className="flowCanvasScaled" style={{width:width*zoom,height:height*zoom}}>
        <div className="flowCanvasSurface" style={{width,height,transform:`scale(${zoom})`}}>
          <div className="flowStartPin"><span>⚡</span><b>TRIGGER</b><small>{flow.triggerType==='any'?'Any inbound message':flow.triggerType+' · '+flow.triggerText}</small></div>
          <svg className="flowWires" width={width} height={height} aria-hidden="true">
            <defs><marker id="flowArrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 Z" fill="#37966b"/></marker></defs>
            {edges.map(x=><g key={x.key}><path d={x.path} fill="none" stroke="#51aa7d" strokeWidth="2.3" markerEnd="url(#flowArrow)"/>{x.label&&<text x={x.lx} y={x.ly-8} fill="#167f55" fontSize="11" textAnchor="middle">{x.label.slice(0,16)}</text>}</g>)}
          </svg>
          {nodes.map((n,i)=>{
            const k=nodeKinds.find(k=>k.type===n.type);
            const p=positions[i];
            return <div role="group" key={n.id} aria-label={k?.label||n.type} className={'flowCanvasNode '+(selected===i?'selected ':'')+'type-'+n.type} style={{left:p.x,top:p.y}}>
              <div className="flowNodeDrag" onPointerDown={e=>moveStart(e,n,i)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onClick={()=>onSelect(i)}>
                <span>{k?.icon||'▤'}</span><b>{k?.label||n.type}</b><small>⋮⋮</small>
              </div>
              <button type="button" className="flowNodeBody" onClick={()=>onSelect(i)}>
                <strong>{n.text?.slice(0,90)||'Configure this step'}</strong>
                <small>{n.id}{n.id===flow.startNodeId?' · First step':''}</small>
              </button>
              <i className="flowPort in" aria-hidden="true"/><i className="flowPort out" aria-hidden="true"/>
            </div>;
          })}
          {nodes.length===1&&<div className="flowCanvasTip">Add another step from the node library →</div>}
        </div>
      </div>
    </div>
  </div>;
}

function AttributePanel({scope}){
  const [items,setItems]=useState([]);
  const [contacts,setContacts]=useState([]);
  const [contactId,setContactId]=useState('');
  const [contactValues,setContactValues]=useState({});
  const [editing,setEditing]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('all');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  async function reload(){
    const [attributes,book]=await Promise.all([api('/flow-attributes?scope='+scope,{fresh:true}),scope==='user'?api('/contacts',{fresh:true}):Promise.resolve([])]);
    setItems(attributes.items||[]);if(scope==='user')setContacts(book||[]);
  }
  useEffect(()=>{setShowForm(false);setEditing(null);setError('');setMessage('');reload().catch(e=>setError(noticeText(e)))},[scope]);
  useEffect(()=>{
    if(scope!=='user'||!contactId){setContactValues({});return}
    let mounted=true;
    api('/flow-attributes/user-values/'+contactId,{fresh:true}).then(x=>{if(mounted)setContactValues(x.values||{})}).catch(e=>{if(mounted)setError(noticeText(e))});
    return()=>{mounted=false};
  },[scope,contactId,items]);
  const filtered=items.filter(a=>[a.key,a.label].join(' ').toLowerCase().includes(search.toLowerCase())&&(status==='all'||(status==='active'&&a.enabled)||(status==='inactive'&&!a.enabled)));
  async function save(e){
    e.preventDefault();setBusy(true);setError('');setMessage('');
    const fd=new FormData(e.currentTarget);
    const payload={scope,key:String(fd.get('key')||'').toLowerCase(),label:String(fd.get('label')||'').trim(),enabled:fd.get('enabled')==='on'};
    if(scope==='global'){
      payload.isSecret=fd.get('isSecret')==='on';
      if(!editing||fd.get('value'))payload.value=String(fd.get('value')||'');
    }
    try{
      await api('/flow-attributes'+(editing?'/'+editing._id:''),{method:editing?'PUT':'POST',body:JSON.stringify(payload)});
      setShowForm(false);setEditing(null);setMessage(editing?'Attribute updated.':'Attribute created.');await reload();
    }catch(err){setError(noticeText(err))}finally{setBusy(false)}
  }
  async function remove(a){
    if(!window.confirm('Delete attribute '+a.key+'? Existing contact values will no longer be available in flows.'))return;
    try{await api('/flow-attributes/'+a._id,{method:'DELETE'});setMessage('Attribute deleted.');await reload()}catch(err){setError(noticeText(err))}
  }
  async function saveValues(e){
    e.preventDefault();if(!contactId)return;
    setBusy(true);setError('');setMessage('');
    try{
      await api('/flow-attributes/user-values/'+contactId,{method:'PUT',body:JSON.stringify({values:contactValues})});
      setMessage('Saved this contact’s custom attribute values.');
    }catch(err){setError(noticeText(err))}finally{setBusy(false)}
  }
  return <div className="attributePage">
    <div className="attributeGuide">
      <b>✧ &nbsp; Quick Guide</b>
      {scope==='global'
        ?<p>Global attributes are shared settings such as opening hours or support URLs. Use <code>{'{{support_hours}}'}</code> in chatbot replies. Secret attributes are encrypted and <strong>never inserted into outgoing messages</strong>.</p>
        :<p>Define up to 50 custom customer attributes and manage their values for individual contacts. Defaults: <strong>customer_name, customer_mobile, customer_email</strong>. Use them in messages like <code>{'Hello {{customer_name}}'}</code>.</p>}
    </div>
    {!!error&&<div className="flowAlert bad">{error}</div>}
    {!!message&&<div className="flowAlert good">{message}</div>}
    <div className="attributeToolbar">
      <label><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search attribute name"/></label>
      <select aria-label="Attribute status" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option>
      </select>
      <button type="button" className="attributeAdd" disabled={items.length>=50} onClick={()=>{setEditing(null);setShowForm(true)}}>+ &nbsp; Add attribute</button>
    </div>
    {showForm&&<form className="attributeEditForm" key={editing?editing._id:'new'} onSubmit={save}>
      <div className="sectionHead"><h3>{editing?'Edit attribute':'Create '+scope+' attribute'}</h3><button type="button" onClick={()=>{setShowForm(false);setEditing(null)}}>Close</button></div>
      <label>Attribute key <input name="key" required maxLength={48} pattern="[a-z][a-z0-9_]{1,47}" title="Lowercase letters, digits and underscores" disabled={!!editing} defaultValue={editing?.key||''} placeholder="support_hours"/></label>
      <label>Display label <input name="label" required maxLength={80} defaultValue={editing?.label||''} placeholder="Support hours"/></label>
      {scope==='global'&&<label>Value <textarea name="value" maxLength={2000} rows={3} placeholder={editing?.isSecret?'Leave empty to preserve the saved secret':'e.g. 9 AM to 6 PM'} defaultValue={editing?.isSecret?'':editing?.value||''}/></label>}
      <div className="attributeChecks">
        <label><input name="enabled" type="checkbox" defaultChecked={editing?.enabled!==false}/> Active</label>
        {scope==='global'&&<label><input name="isSecret" type="checkbox" defaultChecked={!!editing?.isSecret}/> Store as secret (never expose to chatbot replies)</label>}
      </div>
      <div className="flowFooter"><button type="button" onClick={()=>setShowForm(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save attribute'}</button></div>
    </form>}
    <div className="attributeTable">
      <div className="attributeRow attributeTableHead"><span>S.No.</span><span>Attribute details</span><span>Status</span><span>Manage</span></div>
      {filtered.map((a,i)=><div className="attributeRow" key={a._id}>
        <span>{String(i+1).padStart(2,'0')}</span>
        <span><b>{a.label}</b><code>{'{{'+a.key+'}}'}</code>{scope==='global'&&<small>{a.isSecret?'🔒 Secure value hidden':a.value||'No value set'}</small>}</span>
        <span className={a.enabled?'attributeActive':'attributeDisabled'}>{a.enabled?'Active':'Disabled'}</span>
        <span className="attributeActions"><button type="button" onClick={()=>{setEditing(a);setShowForm(true)}}>Edit</button><button type="button" onClick={()=>remove(a)}>Delete</button></span>
      </div>)}
      {!filtered.length&&<div className="attributeEmpty">No attributes found. Create your first {scope} attribute above.</div>}
    </div>
    <div className="attributeCount">{items.length} of 50 custom {scope} attributes configured.</div>
    {scope==='user'&&<section className="attributeContactValues">
      <h3>Contact attribute values</h3><p>Select an address-book contact and customize the values used in that customer's chatbot messages.</p>
      <select aria-label="Contact for custom attributes" value={contactId} onChange={e=>setContactId(e.target.value)}>
        <option value="">Choose a contact</option>{contacts.map(c=><option key={c._id} value={c._id}>{c.name||'Unnamed'} · {c.phone}</option>)}
      </select>
      {!!contactId&&<form onSubmit={saveValues}>
        {items.filter(a=>a.enabled).map(a=><label key={a._id}>{a.label} <code>{'{{'+a.key+'}}'}</code>
          <input maxLength={2000} value={contactValues[a.key]||''} onChange={e=>setContactValues(v=>({...v,[a.key]:e.target.value}))}/>
        </label>)}
        {!items.filter(a=>a.enabled).length&&<p>No active custom user attributes yet.</p>}
        <button className="primary" disabled={busy||!items.some(a=>a.enabled)}>{busy?'Saving…':'Save contact values'}</button>
      </form>}
    </section>}
    {scope==='user'&&<div className="attributeBuiltins"><b>Built-in customer attributes</b><div>{attrsBuiltIn.map(a=><span key={a.key}><strong>{a.label}</strong> <code>{'{{'+a.key+'}}'}</code></span>)}</div></div>}
  </div>;
}

export default function FlowStudio({session}){
  const [tab,setTab]=useState('flows');
  const [profiles,setProfiles]=useState([]);
  const [flows,setFlows]=useState([]);
  const [editing,setEditing]=useState(null);
  const [selected,setSelected]=useState(0);
  const [createOpen,setCreateOpen]=useState(false);
  const [newName,setNewName]=useState('');
  const [newProfile,setNewProfile]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [showLibrary,setShowLibrary]=useState(true);
  const editorRef=useRef(null);
  const canEdit=['owner','admin'].includes(session?.user?.role)||session?.user?.isSuperAdmin;
  async function reload(){
    const [profileData,flowData]=await Promise.all([api('/integrations/whatsapp-connections',{fresh:true}),api('/flows',{fresh:true})]);
    setProfiles((profileData.connections||[]).filter(p=>p.provider==='meta'&&p.enabled&&p.planAllowed!==false&&p.connectionStatus==='connected'));
    setFlows(flowData);
  }
  useEffect(()=>{reload().catch(e=>setError(noticeText(e)))},[]);
  const nodes=editing?.nodes||[];
  const focused=nodes[Math.min(selected,nodes.length-1)];
  const activeProfile=profiles.find(p=>p.id===editing?.integrationId);
  const setField=(key,value)=>setEditing(flow=>({...flow,[key]:value}));
  const updateNode=(i,patch)=>setEditing(flow=>({...flow,nodes:flow.nodes.map((n,j)=>j===i?{...n,...patch}:n)}));
  const moveNode=(id,position)=>setEditing(flow=>({...flow,nodes:flow.nodes.map(n=>n.id===id?{...n,position}:n)}));
  function addNode(type){
    if(nodes.length>=50)return;
    const n=makeNode(type,nodes.length);
    setEditing(flow=>({...flow,nodes:[...flow.nodes,n]}));
    setSelected(nodes.length);
    requestAnimationFrame(()=>editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  function deleteNode(id){
    if(nodes.length<2)return;
    setEditing(flow=>{
      const left=flow.nodes.filter(n=>n.id!==id).map(n=>({...n,nextId:n.nextId===id?'':n.nextId,choices:(n.choices||[]).map(c=>({...c,nextId:c.nextId===id?'':c.nextId}))}));
      return {...flow,nodes:left,startNodeId:flow.startNodeId===id?left[0].id:flow.startNodeId};
    });setSelected(0);
  }
  function beginCreate(e){
    e.preventDefault();
    if(!newProfile||!newName.trim()){setError('Choose a WhatsApp sender and enter a workflow name.');return}
    setEditing(newFlow(newProfile,newName.trim()));setSelected(0);setCreateOpen(false);setError('');setMessage('');
  }
  async function save(e){
    e.preventDefault();
    if(!canEdit)return;
    setBusy(true);setError('');setMessage('');
    try{
      const id=editing._id;
      const result=await api('/flows'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(editing)});
      await reload();
      setEditing(null);setMessage('Workflow saved as '+(result.enabled?'enabled':'draft')+'. Its trigger only runs for inbound messages on the selected WhatsApp number.');
    }catch(err){setError(noticeText(err))}finally{setBusy(false)}
  }
  async function remove(f){
    if(!window.confirm('Delete workflow '+f.name+'? Active conversations will no longer use this workflow.'))return;
    try{await api('/flows/'+f._id,{method:'DELETE'});setMessage('Workflow deleted.');await reload()}catch(err){setError(noticeText(err))}
  }
  const usedAttributes=useMemo(()=>({}),[]);
  return <div className="page flowStudio">
    <div className="flowStudioHeading"><div><span>WHATSAPP AUTOMATION</span><h1>Flow Builder (Chatbot)</h1><p>Build structured conversations, personalize messages and assign each workflow to a connected WhatsApp sender.</p></div>
      {tab==='flows'&&!editing&&<button type="button" className="primary" disabled={!canEdit||!profiles.length} onClick={()=>{setNewName('');setNewProfile(profiles[0]?.id||'');setCreateOpen(true)}}>+ Create workflow</button>}</div>
    <div className="flowStudioTabs" role="tablist" aria-label="Chatbot settings">
      {[['flows','Flow Builder'],['global','Global Attributes'],['user','User Attributes']].map(([id,label])=>
        <button type="button" key={id} role="tab" aria-selected={tab===id} className={tab===id?'selected':''} onClick={()=>{if(editing&&tab!==id&&!window.confirm('Leave workflow editor? Unsaved edits will be lost.'))return;setTab(id);setEditing(null);setError('')}}>{label}</button>)}
    </div>
    {tab==='global'||tab==='user'?<AttributePanel key={tab} scope={tab}/>:
      <>
        {!!error&&<div className="flowAlert bad" role="alert">{error}</div>}
        {!!message&&<div className="flowAlert good" role="status">{message}</div>}
        {!profiles.length&&<div className="flowAlert bad">Connect a working, plan-entitled Meta WhatsApp number before creating new automation flows.</div>}
        {!editing?<div className="workflowOverview">
          <div className="workflowOverviewHead"><b>Saved workflows</b><span>{flows.length} workflows</span></div>
          <div className="workflowGrid">{flows.map(flow=><article key={flow._id} className="workflowItem">
            <div className="workflowItemTop"><span>◇</span><em className={flow.enabled?'on':'off'}>{flow.enabled?'Enabled':'Draft'}</em></div>
            <h3>{flow.name}</h3><p>Sender: {profiles.find(p=>p.id===String(flow.integrationId))?.name||'Previously connected number'}</p>
            <p>Trigger: {flow.triggerType==='any'?'Any inbound message':flow.triggerType+' · '+flow.triggerText}</p>
            <div className="workflowItemFoot"><span>{flow.nodes?.length||0} steps · Priority {flow.priority||0}</span>
              <div><button type="button" disabled={!canEdit} onClick={()=>{setEditing(flow);setSelected(0)}}>Open builder ↗</button>
                <button type="button" disabled={!canEdit} onClick={()=>remove(flow)}>Delete</button></div>
            </div>
          </article>)}{!flows.length&&<div className="workflowEmpty"><span>◇</span><h3>Start with your first workflow</h3><p>Create an automated greeting, reply buttons and human handoff for a connected WhatsApp number.</p>
            <button className="primary" type="button" disabled={!canEdit||!profiles.length} onClick={()=>{setNewName('');setNewProfile(profiles[0]?.id||'');setCreateOpen(true)}}>+ Create workflow</button></div>}</div>
        </div>:<form className="flowVisualEditor" onSubmit={save} ref={editorRef}>
          <div className="flowEditorHeading"><div><small>EDIT WORKFLOW</small><h2>{editing.name}</h2><p>{activeProfile?.name||'Meta WhatsApp sender'} · Draft changes are saved only when you select Save Changes.</p></div>
            <div><button type="button" onClick={()=>{if(window.confirm('Discard unsaved changes?'))setEditing(null)}}>← Back</button><button className="primary" disabled={busy||!canEdit}>{busy?'Saving…':'Save Changes'}</button></div></div>
          <div className="flowWorkflowSettings">
            <label>Workflow name<input required maxLength={100} value={editing.name} onChange={e=>setField('name',e.target.value)}/></label>
            <label>WhatsApp sender<select required value={editing.integrationId} onChange={e=>setField('integrationId',e.target.value)}>
              {!profiles.some(p=>p.id===editing.integrationId)&&<option value={editing.integrationId}>Previously connected number (not available)</option>}
              {profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.displayPhoneNumber||p.phoneNumberId}</option>)}
            </select></label>
            <label>Start when<select value={editing.triggerType} onChange={e=>setField('triggerType',e.target.value)}>
              <option value="contains">Message contains</option><option value="exact">Exact keyword</option><option value="any">Any inbound message</option>
            </select></label>
            <label>Keyword<input required={editing.triggerType!=='any'} disabled={editing.triggerType==='any'} value={editing.triggerText} onChange={e=>setField('triggerText',e.target.value)}/></label>
            <label>Priority<input type="number" min="-100" max="100" value={editing.priority} onChange={e=>setField('priority',Number(e.target.value))}/></label>
            <label>Start step<select value={editing.startNodeId} onChange={e=>setField('startNodeId',e.target.value)}>
              {nodes.map(n=><option key={n.id} value={n.id}>{n.id}</option>)}
            </select></label>
            <label className="flowEnable"><input type="checkbox" checked={editing.enabled} onChange={e=>setField('enabled',e.target.checked)}/> Enable workflow</label>
          </div>
          <div className="flowBuilderColumns">
            <aside className="flowPalette">
              <div className="flowPanelTitle"><b>NODE LIBRARY</b><button type="button" onClick={()=>setShowLibrary(v=>!v)}>{showLibrary?'−':'+'}</button></div>
              {showLibrary&&['MESSAGE TYPES','UTILITY','ACTIONS','CONNECTIONS'].map(group=><div className="flowPaletteGroup" key={group}>
                <h4>{group}</h4>{nodeKinds.filter(k=>k.group===group).map(k=><button type="button" key={k.type} disabled={!k.ready||nodes.length>=50} title={k.description}
                  onClick={()=>addNode(k.type)}><span>{k.icon}</span><b>{k.label}</b>{k.ready?<em>+</em>:<small>Planned</small>}</button>)}
              </div>)}
            </aside>
            <NodeCanvas flow={editing} selected={selected} onSelect={setSelected} onMove={moveNode}/>
            <aside className="flowDetails">
              <div className="flowPanelTitle"><b>STEP SETTINGS</b><span>{selected+1} / {nodes.length}</span></div>
              {focused&&<div className="flowDetailsFields">
                <div className="flowDetailsName"><span>{nodeKinds.find(n=>n.type===focused.type)?.icon}</span><div><b>{focused.type==='message'?'Message':focused.type==='buttons'?'Reply buttons':focused.type==='handoff'?'Human handoff':'End flow'}</b><small>{focused.id}</small></div></div>
                <label>Node type<select value={focused.type} onChange={e=>updateNode(selected,{type:e.target.value,choices:e.target.value==='buttons'?[{id:'option_1',label:'Continue',nextId:''}]:[]})}>
                  {nodeKinds.filter(k=>k.ready).map(k=><option key={k.type} value={k.type}>{k.label}</option>)}</select></label>
                {focused.type!=='end'&&<label>Reply message <textarea rows={5} maxLength={1024} value={focused.text||''} onChange={e=>updateNode(selected,{text:e.target.value})}/></label>}
                {['message','handoff'].includes(focused.type)&&<label>{focused.type==='handoff'?'After handoff':'Next step on next customer reply'}<select disabled={focused.type==='handoff'} value={focused.nextId||''} onChange={e=>updateNode(selected,{nextId:e.target.value})}>
                  <option value="">No next step</option>{nodes.filter(n=>n.id!==focused.id).map(n=><option value={n.id} key={n.id}>{n.id} · {n.type}</option>)}</select></label>}
                {focused.type==='buttons'&&<div className="flowDetailsButtons">
                  <h4>Reply choices (max 3)</h4>{(focused.choices||[]).map((c,i)=><div className="flowDetailsChoice" key={i}>
                    <label>Button label<input value={c.label||''} maxLength={20} onChange={e=>updateNode(selected,{choices:focused.choices.map((v,j)=>j===i?{...v,label:e.target.value}:v)})}/></label>
                    <label>Reply ID<input value={c.id||''} maxLength={40} onChange={e=>updateNode(selected,{choices:focused.choices.map((v,j)=>j===i?{...v,id:e.target.value}:v)})}/></label>
                    <label>Go to step<select value={c.nextId||''} onChange={e=>updateNode(selected,{choices:focused.choices.map((v,j)=>j===i?{...v,nextId:e.target.value}:v)})}>
                      <option value="">No next step</option>{nodes.filter(n=>n.id!==focused.id).map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select></label>
                    <button type="button" disabled={focused.choices.length===1} onClick={()=>updateNode(selected,{choices:focused.choices.filter((_,j)=>j!==i)})}>Remove choice</button>
                  </div>)}
                  <button type="button" disabled={focused.choices.length>=3} onClick={()=>updateNode(selected,{choices:[...focused.choices,{id:'option_'+(focused.choices.length+1),label:'New option',nextId:''}]})}>+ Add choice</button>
                </div>}
                <div className="flowAttributeHint">Personalize messages with <code>{'{{customer_name}}'}</code> and your Global/User attributes. Secrets cannot be inserted.</div>
                <button type="button" className="flowRemoveNode" disabled={nodes.length===1} onClick={()=>deleteNode(focused.id)}>Remove this step</button>
              </div>}
            </aside>
          </div>
          <div className="flowEditorFoot"><small>WhatsApp free-form replies only work inside the customer's 24-hour service window. Unsupported node types are disabled rather than shown as functional.</small><button className="primary" disabled={busy||!canEdit}>{busy?'Saving…':'Save Workflow'}</button></div>
        </form>}
      </>}
    {createOpen&&<div className="workflowModalOverlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}>
      <form className="workflowCreateModal" onSubmit={beginCreate} role="dialog" aria-modal="true" aria-label="Create Workflow">
        <div className="workflowModalTitle"><h2>Create Workflow</h2><button type="button" onClick={()=>setCreateOpen(false)} aria-label="Close">×</button></div>
        <div className="workflowModalFields">
          <label>Workflow Name *<input autoFocus required maxLength={100} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Customer Support Flow"/></label>
          <label>Channel *<select value="WHATSAPP" disabled><option>WHATSAPP</option></select></label>
          <label>From ID (WhatsApp number) *<select required value={newProfile} onChange={e=>setNewProfile(e.target.value)}>
            <option value="">Select From ID</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.displayPhoneNumber||p.phoneNumberId} ({p.name})</option>)}
          </select></label>
          <p>Each workflow is linked to one Meta WhatsApp sender. Only ready, subscription-entitled numbers are available.</p>
        </div>
        <div className="workflowModalFoot"><button type="button" onClick={()=>setCreateOpen(false)}>Cancel</button><button className="primary">Continue to Builder →</button></div>
      </form>
    </div>}
  </div>;
}
