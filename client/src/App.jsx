import React,{useEffect,useMemo,useState}from'react';
import{api,BASE}from'./api.js';

const nav=[
  ['overview','Overview','⌂'],
  ['send','Send message','➤'],
  ['campaigns','Campaigns','✦'],
  ['contacts','Contacts','◎'],
  ['schedule','Schedule','◷'],
  ['templates','Templates','▤'],
  ['reports','Delivery reports','▥'],
  ['subscription','Subscription','₹'],
  ['settings','Settings','⚙']
];

const fmt=d=>d?new Date(d).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'—';
const statusLabel=s=>String(s||'draft').replace('_',' ');

function Notice({children,type='ok'}){return children?<div className={'notice '+type}>{children}</div>:null}
function Loading(){return <div className="loading">Loading workspace…</div>}
function Empty({text}){return <div className="empty">{text}</div>}
function Title({title,sub,action,onAction}){
  return <div className="title"><div><span>WA SANTA</span><h1>{title}</h1><p>{sub}</p></div>{action&&<button className="primary" onClick={onAction}>+ {action}</button>}</div>
}
function Metric({label,value,sub}){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>}
function Avatar({user,className='userAvatar'}){
  return <span className={className}>{user?.avatarData?<img src={user.avatarData} alt="Profile"/>:(user?.name?.[0]?.toUpperCase()||'U')}</span>
}

function Auth({onAuth}){
  const[mode,setMode]=useState('login');
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState('');
  const[challenge,setChallenge]=useState(null);

  async function submit(e){
    e.preventDefault();setBusy(true);setErr('');
    try{
      const o=Object.fromEntries(new FormData(e.currentTarget));
      const x=await api('/auth/'+mode,{method:'POST',body:JSON.stringify(o)});
      if(x.twoFactorRequired){setChallenge(x);return}
      onAuth(x);
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function verifyOtp(e){
    e.preventDefault();setBusy(true);setErr('');
    try{
      const otp=new FormData(e.currentTarget).get('otp');
      const x=await api('/auth/2fa/verify',{method:'POST',body:JSON.stringify({challengeToken:challenge.challengeToken,otp})});
      onAuth(x);
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }

  return <div className="auth">
    <div className="brandPanel">
      <div className="mark">WS</div>
      <h1>Make every message count.</h1>
      <p>A little planning. A lot more connection. Build thoughtful WhatsApp conversations with consent-aware contacts, scheduled delivery and clear reporting.</p>
      <div className="trust">✓ Workspace isolation &nbsp; ✓ Secure sessions &nbsp; ✓ WhatsApp 2FA</div>
    </div>
    {challenge?<form className="authCard" onSubmit={verifyOtp}>
      <div className="logo">WA <b>SANTA</b><small>WHATSAPP WORKSPACE</small></div>
      <div className="otpIcon">✓</div>
      <h2>Verify with WhatsApp</h2>
      <p>Enter the 6-digit OTP sent to {challenge.maskedPhone}.</p>
      <label>WhatsApp OTP<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="000000" required autoFocus/></label>
      {err&&<div className="error">{err}</div>}
      <button className="primary" disabled={busy}>{busy?'Verifying…':'Verify & sign in'}</button>
      <button type="button" className="link" onClick={()=>{setChallenge(null);setErr('')}}>Back to sign in</button>
    </form>:<form className="authCard" onSubmit={submit}>
      <div className="logo">WA <b>SANTA</b><small>WHATSAPP WORKSPACE</small></div>
      <h2>{mode==='login'?'Welcome back':'Create your workspace'}</h2>
      <p>{mode==='login'?'Sign in to continue to WA SANTA.':'Start in demo mode, then connect Meta WhatsApp when ready.'}</p>
      {mode==='register'&&<>
        <label>Full name<input name="name" required autoComplete="name"/></label>
        <label>Workspace name<input name="workspaceName" placeholder="Acme Studio"/></label>
      </>}
      <label>Email<input type="email" name="email" required autoComplete="email"/></label>
      <label>Password<input type="password" name="password" minLength="8" required autoComplete={mode==='login'?'current-password':'new-password'}/></label>
      {err&&<div className="error">{err}</div>}
      <button className="primary" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':'Create workspace'}</button>
      <button type="button" className="link" onClick={()=>{setErr('');setMode(mode==='login'?'register':'login')}}>{mode==='login'?'New here? Create an account':'Already have an account? Sign in'}</button>
    </form>}
  </div>
}

function Shell({session,onLogout,onSessionUpdate}){
  const access=session.workspace?.access||{allowed:true,state:'active'};
  const[page,setPage]=useState(access.allowed?'overview':'subscription');
  const[open,setOpen]=useState(false);
  const[profileOpen,setProfileOpen]=useState(false);
  const menu=session.user.isSuperAdmin?[...nav,['admin','Super Admin','★']]:nav;
  useEffect(()=>{
    const close=e=>{if(!e.target.closest?.('.profileMenu'))setProfileOpen(false)};
    const subscribe=()=>setPage('subscription');
    document.addEventListener('pointerdown',close);
    window.addEventListener('wa:subscription-required',subscribe);
    return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('wa:subscription-required',subscribe)};
  },[]);
  const pageTitle=page==='profile'?'Profile':page==='edit-profile'?'Edit profile':menu.find(x=>x[0]===page)?.[1];
  const locked=id=>!access.allowed&&!['subscription','settings','admin'].includes(id);
  const changePage=id=>{
    setPage(locked(id)?'subscription':id);
    setOpen(false);setProfileOpen(false);
  };
  return <div className="shell">
    <aside className={open?'open':''}>
      <div className="sideLogo"><span>WA</span> SANTA<small>WHATSAPP WORKSPACE</small></div>
      <div className="workspace">
        <div className="avatar">{session.workspace.name[0]?.toUpperCase()}</div>
        <div><b>{session.workspace.name}</b><small>{access.state==='trialing'?'trial · '+(access.daysRemaining||0)+' day(s) left':session.user.role+' workspace'}</small></div>
      </div>
      <nav>{menu.map(([id,label,ic])=><button key={id} className={page===id?'active':''} onClick={()=>changePage(id)}><i>{ic}</i>{label}{locked(id)&&<small className="navLock">• locked</small>}</button>)}</nav>
    </aside>
    <main>
      <header>
        <button className="hamb" onClick={()=>setOpen(!open)}>☰</button>
        <div><small>WA SANTA</small><b>{pageTitle}</b></div>
        <div className="headRight">
          {access.state==='trialing'?<button className="trialPill" onClick={()=>setPage('subscription')}>Trial · {access.daysRemaining} day(s) left</button>:access.allowed?<span className="pill">● Subscribed</span>:<button className="expiredPill" onClick={()=>setPage('subscription')}>Subscription required</button>}
          <div className="profileMenu">
            <button className="profileTrigger" aria-label="Open profile menu" aria-expanded={profileOpen} onClick={e=>{e.stopPropagation();setProfileOpen(v=>!v)}}>
              <Avatar user={session.user} className="miniAvatar"/>
              <span className="profileChevron">⌄</span>
            </button>
            {profileOpen&&<div className="profileDropdown">
              <div className="profileSummary">
                <Avatar user={session.user} className="dropdownAvatar"/>
                <div><b>{session.user.name}</b><small>{session.user.email}</small></div>
              </div>
              <button onClick={()=>changePage('profile')}><span>◎</span><div><b>Profile</b><small>Account center</small></div></button>
              <button onClick={()=>changePage('subscription')}><span>₹</span><div><b>Subscription</b><small>{access.allowed?statusLabel(access.state):'Action required'}</small></div></button>
              {session.user.isSuperAdmin&&<button onClick={()=>changePage('admin')}><span>★</span><div><b>Super Admin</b><small>Plans & subscriptions</small></div></button>}
              <button className="signoutItem" onClick={onLogout}><span>↪</span><div><b>Sign out</b><small>End this session</small></div></button>
            </div>}
          </div>
        </div>
      </header>
      {!access.allowed&&page!=='subscription'&&page!=='admin'&&<div className="accessBanner"><b>7-day trial ended.</b> Subscribe to a WA SANTA plan to restore workspace access.</div>}
      <Page id={page} session={session} go={changePage} onSessionUpdate={onSessionUpdate}/>
    </main>
  </div>
}

function Overview({go}){
  const[d,setD]=useState(null);
  const[err,setErr]=useState('');
  useEffect(()=>{api('/dashboard').then(setD).catch(e=>setErr(e.message))},[]);
  if(err)return <div className="page"><Notice type="bad">{err}</Notice></div>;
  if(!d)return <Loading/>;
  const max=Math.max(1,...d.activity.map(x=>Math.max(x.submitted,x.delivered,x.failed||0)));
  return <div className="page">
    <div className="hero">
      <div><span>YOUR WORKSPACE, AT A GLANCE</span><h1>Good things start with a message.</h1><p>Live delivery, consent and scheduling health for your workspace.</p></div>
      <button className="primary" onClick={()=>go('campaigns')}>+ Create a campaign</button>
    </div>
    <div className="metrics six">
      <Metric label="Messages submitted" value={d.metrics.submitted} sub={d.metrics.read+' read by recipients'}/>
      <Metric label="Delivery rate" value={d.metrics.deliveryRate+'%'} sub={d.metrics.delivered+' confirmed deliveries'}/>
      <Metric label="Opted-in contacts" value={d.metrics.optedIn} sub={d.metrics.contacts+' total saved contacts'}/>
      <Metric label="Pending consent" value={d.metrics.pendingConsent} sub={d.metrics.suppressed+' suppressed / opted out'}/>
      <Metric label="Scheduled campaigns" value={String(d.metrics.scheduled).padStart(2,'0')} sub="Automatic delivery queue"/>
      <Metric label="Failed messages" value={d.metrics.failed} sub="Last 14 days"/>
    </div>
    <section>
      <div className="sectionHead"><div><h2>Message activity</h2><p>Submitted, delivered and failed messages over the last 14 days.</p></div><button onClick={()=>go('reports')}>View report</button></div>
      <div className="chart">{d.activity.map((x,i)=><div className="barWrap" key={x.date}><div className="bars"><i style={{height:Math.max(4,x.submitted/max*100)+'%'}}></i><b style={{height:Math.max(4,x.delivered/max*100)+'%'}}></b><em style={{height:Math.max(0,(x.failed||0)/max*100)+'%'}}></em></div><small>{i%3===0?new Date(x.date).toLocaleDateString([],{month:'short',day:'numeric'}):''}</small></div>)}</div>
      <div className="legend"><span>Submitted</span><span>Delivered</span><span>Failed</span></div>
    </section>
    <section>
      <div className="eyebrow">QUICK ACTIONS</div><h2>Your next connection starts here.</h2>
      <div className="quick">
        <button onClick={()=>go('contacts')}><span>⇧</span><b>Import contacts</b><small>Excel or CSV with consent controls</small></button>
        <button onClick={()=>go('send')}><span>➤</span><b>Send a personal message</b><small>One recipient, instantly</small></button>
        <button onClick={()=>go('templates')}><span>＋</span><b>Create a template</b><small>Reusable WhatsApp copy</small></button>
      </div>
    </section>
    <CampaignTable rows={d.recent} go={go}/>
  </div>
}

function CampaignTable({rows,go,onOpen}){
  return <section>
    <div className="sectionHead"><div><h2>Recent campaigns</h2><p>Your latest campaign activity.</p></div>{go&&<button onClick={()=>go('campaigns')}>View all campaigns</button>}</div>
    <div className="table">
      <div className="tr th"><span>Campaign</span><span>Status</span><span>Audience</span><span>Delivery</span><span>Scheduled</span></div>
      {rows.length?rows.map(c=><div className="tr clickable" key={c._id} onClick={()=>onOpen?.(c)}>
        <span><b>{c.name}</b><small>{c.message||c.templateId?.name||'Template campaign'}</small></span>
        <span><em className={'status '+c.status}>{statusLabel(c.status)}</em></span>
        <span>{c.audienceType==='list'?(c.listId?.name||'List'):c.audienceType==='contacts'?'Selected contacts':'All opted-in contacts'}</span>
        <span>{c.totals?.submitted?Math.round((c.totals.delivered||0)/c.totals.submitted*100)+'%':'—'}</span>
        <span>{fmt(c.scheduledAt)}</span>
      </div>):<Empty text="No campaigns yet."/>}
    </div>
  </section>
}

function SingleSend(){
  const[contacts,setContacts]=useState([]);
  const[templates,setTemplates]=useState([]);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const[busy,setBusy]=useState(false);
  const[direct,setDirect]=useState(false);
  useEffect(()=>{Promise.all([api('/contacts'),api('/templates')]).then(([a,b])=>{setContacts(a);setTemplates(b)}).catch(e=>setErr(e.message))},[]);
  async function submit(e){
    e.preventDefault();setBusy(true);setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    if(direct){delete o.contactId;o.consentConfirmed=fd.get('consentConfirmed')==='true'}else delete o.phone;
    try{
      const d=await api('/campaigns/single/send',{method:'POST',body:JSON.stringify(o)});
      setMsg('Message accepted. Delivery status: '+statusLabel(d.status)+'.');
      e.currentTarget.reset();
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  const opted=contacts.filter(x=>x.consentStatus==='opted_in'&&!x.suppressed);
  return <div className="page">
    <Title title="Send message" sub="Send an individual WhatsApp message using an opted-in contact or a direct number."/>
    <div className="settingsGrid">
      <section>
        <div className="segmented"><button className={!direct?'active':''} onClick={()=>setDirect(false)}>Saved contact</button><button className={direct?'active':''} onClick={()=>setDirect(true)}>Direct number</button></div>
        <form className="formGrid" onSubmit={submit}>
          {!direct?<label className="full">Recipient<select name="contactId" required defaultValue=""><option value="">Choose opted-in contact</option>{opted.map(x=><option value={x._id} key={x._id}>{x.name||'Unnamed'} · {x.phone}</option>)}</select></label>:<>
            <label className="full">Phone number<input name="phone" placeholder="+919876543210" required/></label>
            <label className="check full"><input type="checkbox" name="consentConfirmed" value="true" required/> I confirm this recipient has explicitly opted in to receive WhatsApp messages.</label>
          </>}
          <label>Template<select name="templateId" defaultValue=""><option value="">Freeform message</option>{templates.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select></label>
          <label>Delivery mode<input value="Send immediately" readOnly/></label>
          <label className="full">Message<textarea name="message" rows="6" placeholder="Write a personal message…"/></label>
          <div className="actions full"><button className="primary" disabled={busy}>{busy?'Sending…':'Send message'}</button></div>
        </form>
        <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
      </section>
      <section>
        <h2>Safe sending</h2>
        <p>Saved contacts must be opted in and not suppressed. For direct numbers, confirmation is required before sending.</p>
        <div className="miniStats"><span><b>{opted.length}</b> ready contacts</span><span><b>{contacts.length-opted.length}</b> pending / suppressed</span></div>
      </section>
    </div>
  </div>
}

function Campaigns(){
  const[rows,setRows]=useState([]);
  const[lists,setLists]=useState([]);
  const[templates,setTemplates]=useState([]);
  const[contacts,setContacts]=useState([]);
  const[show,setShow]=useState(false);
  const[editing,setEditing]=useState(null);
  const[deliveries,setDeliveries]=useState(null);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const load=()=>Promise.all([api('/campaigns'),api('/lists'),api('/templates'),api('/contacts')]).then(([a,b,c,d])=>{setRows(a);setLists(b);setTemplates(c);setContacts(d)});
  useEffect(()=>{load().catch(e=>setErr(e.message))},[]);
  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    o.contactIds=fd.getAll('contactIds');
    if(!o.scheduledAt)delete o.scheduledAt;
    if(o.audienceType!=='list')o.listId=null;
    try{
      if(editing) await api('/campaigns/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/campaigns',{method:'POST',body:JSON.stringify(o)});
      setShow(false);setEditing(null);setMsg(editing?'Campaign updated.':'Campaign created.');await load();
    }catch(e){setErr(e.message)}
  }
  async function action(id,type){
    setErr('');setMsg('');
    try{
      if(type==='send'){await api('/campaigns/'+id+'/send',{method:'POST'});setMsg('Campaign processing started.')}
      if(type==='retry'){await api('/campaigns/'+id+'/retry-failed',{method:'POST'});setMsg('Retry started for failed deliveries.')}
      if(type==='delete'){if(!confirm('Delete this campaign and its delivery history?'))return;await api('/campaigns/'+id,{method:'DELETE'});setMsg('Campaign deleted.')}
      setTimeout(()=>load().catch(()=>{}),900);
    }catch(e){setErr(e.message)}
  }
  async function viewDeliveries(c){
    try{const d=await api('/campaigns/'+c._id+'/deliveries');setDeliveries({campaign:c,rows:d})}catch(e){setErr(e.message)}
  }
  return <div className="page">
    <Title title="Campaigns" sub="Create, schedule, send, retry and audit bulk WhatsApp campaigns." action="New campaign" onAction={()=>{setEditing(null);setShow(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    {show&&<div className="panel"><form key={editing?editing._id:'new'} className="formGrid" onSubmit={save}>
      <label htmlFor="campaign-name">Campaign name<input id="campaign-name" name="name" required defaultValue={editing?.name||''}/></label>
      <label htmlFor="campaign-audience">Audience<select id="campaign-audience" name="audienceType" defaultValue={editing?.audienceType||'all'}><option value="all">All opted-in contacts</option><option value="list">Contact list</option><option value="contacts">Specific contacts</option></select></label>
      <label>Contact list<select name="listId" defaultValue={editing?.listId?._id||editing?.listId||''}><option value="">Choose list</option>{lists.map(x=><option value={x._id} key={x._id}>{x.name} ({x.contactCount||0})</option>)}</select></label>
      <label>Template<select name="templateId" defaultValue={editing?.templateId?._id||editing?.templateId||''}><option value="">Freeform message</option>{templates.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select></label>
      <label className="full">Specific contacts<select name="contactIds" multiple size="5" defaultValue={editing?.contactIds?.map(String)||[]}>{contacts.filter(x=>x.consentStatus==='opted_in'&&!x.suppressed).map(x=><option value={x._id} key={x._id}>{x.name||'Unnamed'} · {x.phone}</option>)}</select></label>
      <label className="full" htmlFor="campaign-message">Message<textarea id="campaign-message" name="message" rows="5" defaultValue={editing?.message||''} placeholder="Hi {{name}}, your appointment is tomorrow…"/></label>
      <label htmlFor="campaign-scheduled-at">Schedule for<input id="campaign-scheduled-at" type="datetime-local" name="scheduledAt" defaultValue={editing?.scheduledAt?new Date(new Date(editing.scheduledAt).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''}/></label>
      <div className="actions"><button type="button" onClick={()=>{setShow(false);setEditing(null)}}>Cancel</button><button className="primary">{editing?'Update campaign':'Save campaign'}</button></div>
    </form></div>}
    <div className="cards campaignCards">{rows.map(c=><article key={c._id}>
      <div className="cardTop"><div><small>CAMPAIGN</small><h3>{c.name}</h3></div><em className={'status '+c.status}>{statusLabel(c.status)}</em></div>
      <p>{c.message||c.templateId?.name||'WhatsApp template message'}</p>
      <div className="stats"><span><b>{c.totals?.submitted||0}</b> submitted</span><span><b>{c.totals?.delivered||0}</b> delivered</span><span><b>{c.totals?.read||0}</b> read</span><span><b>{c.totals?.failed||0}</b> failed</span></div>
      {c.lastError&&<small className="warnText">{c.lastError}</small>}
      <footer><span>{c.scheduledAt?fmt(c.scheduledAt):'No schedule'}</span><div className="rowActions">
        <button onClick={()=>viewDeliveries(c)}>Deliveries</button>
        {!['processing','completed'].includes(c.status)&&<button onClick={()=>{setEditing(c);setShow(true)}}>Edit</button>}
        {['partial','failed'].includes(c.status)&&<button onClick={()=>action(c._id,'retry')}>Retry failed</button>}
        {c.status!=='completed'&&<button onClick={()=>action(c._id,'send')} disabled={c.status==='processing'}>Send now</button>}
        <button className="danger" onClick={()=>action(c._id,'delete')} disabled={c.status==='processing'}>Delete</button>
      </div></footer>
    </article>)}{!rows.length&&<Empty text="Create your first campaign to get started."/>}</div>
    {deliveries&&<div className="modalBack" onClick={()=>setDeliveries(null)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="modalHead"><div><small>DELIVERY LOG</small><h2>{deliveries.campaign.name}</h2></div><button onClick={()=>setDeliveries(null)}>×</button></div>
      <DeliveryTable rows={deliveries.rows}/>
    </div></div>}
  </div>
}

function Contacts(){
  const[rows,setRows]=useState([]);
  const[lists,setLists]=useState([]);
  const[show,setShow]=useState(false);
  const[editing,setEditing]=useState(null);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const[search,setSearch]=useState('');
  const[filter,setFilter]=useState('all');
  const[selected,setSelected]=useState(new Set());
  const load=()=>Promise.all([api('/contacts'),api('/lists')]).then(([a,b])=>{setRows(a);setLists(b);setSelected(new Set())});
  useEffect(()=>{load().catch(e=>setErr(e.message))},[]);
  const filtered=useMemo(()=>rows.filter(x=>{
    const q=search.toLowerCase();
    const match=!q||[x.name,x.phone,x.email].some(v=>String(v||'').toLowerCase().includes(q));
    const state=filter==='all'||(filter==='ready'&&x.consentStatus==='opted_in'&&!x.suppressed)||(filter==='pending'&&x.consentStatus==='pending')||(filter==='suppressed'&&(x.suppressed||x.consentStatus==='opted_out'));
    return match&&state;
  }),[rows,search,filter]);

  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    o.lists=fd.getAll('lists');
    try{
      if(editing)await api('/contacts/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/contacts',{method:'POST',body:JSON.stringify(o)});
      setShow(false);setEditing(null);setMsg(editing?'Contact updated.':'Contact added.');await load();
    }catch(e){setErr(e.message)}
  }
  async function remove(x){
    if(!confirm('Delete '+(x.name||x.phone)+'?'))return;
    try{await api('/contacts/'+x._id,{method:'DELETE'});setMsg('Contact deleted.');await load()}catch(e){setErr(e.message)}
  }
  async function bulkConsent(consentStatus){
    if(!selected.size)return;
    try{const x=await api('/contacts/bulk-consent',{method:'POST',body:JSON.stringify({ids:[...selected],consentStatus})});setMsg(x.updated+' contact(s) updated.');await load()}catch(e){setErr(e.message)}
  }
  async function bulkDelete(){
    if(!selected.size||!confirm('Delete '+selected.size+' selected contact(s)?'))return;
    try{const x=await api('/contacts/bulk-delete',{method:'POST',body:JSON.stringify({ids:[...selected]})});setMsg(x.deleted+' contact(s) deleted.');await load()}catch(e){setErr(e.message)}
  }
  async function importFile(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    if(fd.get('confirmConsent')==='on')fd.set('confirmConsent','true');else fd.set('confirmConsent','false');
    try{const x=await api('/contacts/import',{method:'POST',body:fd});setMsg('Imported: '+x.added+' new, '+x.updated+' updated, '+x.skipped+' skipped.');e.currentTarget.reset();await load()}catch(e){setErr(e.message)}
  }
  async function addList(){
    const name=prompt('New list name');
    if(!name)return;
    const description=prompt('Description (optional)')||'';
    try{await api('/lists',{method:'POST',body:JSON.stringify({name,description})});await load()}catch(e){setErr(e.message)}
  }
  async function editList(x){
    const name=prompt('List name',x.name);
    if(!name)return;
    const description=prompt('Description',x.description||'')||'';
    try{await api('/lists/'+x._id,{method:'PUT',body:JSON.stringify({name,description})});await load()}catch(e){setErr(e.message)}
  }
  async function deleteList(x){
    if(!confirm('Delete list "'+x.name+'"? Contacts will be kept.'))return;
    try{await api('/lists/'+x._id,{method:'DELETE'});await load()}catch(e){setErr(e.message)}
  }
  function toggle(id){
    setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n});
  }
  return <div className="page">
    <Title title="Contacts" sub="Manage consent-aware contacts, lists and Excel/CSV imports." action="Add contact" onAction={()=>{setEditing(null);setShow(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <div className="toolbar contactTools">
      <div className="toolbarGroup"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search contacts…"/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All contacts</option><option value="ready">Opted in</option><option value="pending">Pending consent</option><option value="suppressed">Suppressed / opted out</option></select><button onClick={addList}>+ New list</button></div>
      <form onSubmit={importFile}><select name="listId"><option value="">No list</option>{lists.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select><input type="file" name="file" accept=".xlsx,.xls,.csv" required/><label className="check compact"><input type="checkbox" name="confirmConsent"/> Imported contacts have documented opt-in</label><button className="primary">Import</button></form>
    </div>
    {selected.size>0&&<div className="bulkBar"><b>{selected.size} selected</b><button onClick={()=>bulkConsent('opted_in')}>Mark opted in</button><button onClick={()=>bulkConsent('opted_out')}>Opt out / suppress</button><button className="danger" onClick={bulkDelete}>Delete</button></div>}
    {show&&<div className="panel"><form key={editing?editing._id:'new'} className="formGrid" onSubmit={save}>
      <label>Name<input name="name" required defaultValue={editing?.name||''}/></label>
      <label>Phone<input name="phone" placeholder="+919876543210" required defaultValue={editing?.phone||''}/></label>
      <label>Email<input type="email" name="email" defaultValue={editing?.email||''}/></label>
      <label>Consent<select name="consentStatus" defaultValue={editing?.consentStatus||'pending'}><option value="pending">Pending / unknown</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out / suppress</option></select></label>
      <label className="full">Lists<select name="lists" multiple size="4" defaultValue={editing?.lists?.map(l=>l._id||l)||[]}>{lists.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select></label>
      <label className="full">Notes<textarea name="notes" rows="3" defaultValue={editing?.notes||''}/></label>
      <div className="actions full"><button type="button" onClick={()=>{setShow(false);setEditing(null)}}>Cancel</button><button className="primary">{editing?'Update contact':'Save contact'}</button></div>
    </form></div>}
    <section className="listStrip"><div className="sectionHead"><div><h2>Contact lists</h2><p>Organize audiences without duplicating contacts.</p></div></div><div className="listChips">{lists.map(x=><div className="listChip" key={x._id}><div><b>{x.name}</b><small>{x.contactCount||0} contacts</small></div><button onClick={()=>editList(x)}>Edit</button><button className="danger" onClick={()=>deleteList(x)}>Delete</button></div>)}{!lists.length&&<span className="mutedText">No lists yet.</span>}</div></section>
    <div className="table">
      <div className="tr contact th"><span></span><span>Name</span><span>Phone</span><span>Consent</span><span>Lists</span><span>Actions</span></div>
      {filtered.map(x=><div className="tr contact" key={x._id}>
        <span><input type="checkbox" checked={selected.has(x._id)} onChange={()=>toggle(x._id)}/></span>
        <span><b>{x.name||'Unnamed contact'}</b><small>{x.email||'—'}</small></span>
        <span>{x.phone}</span>
        <span><em className={'status '+(x.suppressed?'failed':x.consentStatus==='opted_in'?'completed':'scheduled')}>{x.suppressed?'suppressed':statusLabel(x.consentStatus)}</em></span>
        <span>{x.lists?.map(l=>l.name).join(', ')||'—'}</span>
        <span className="inlineActions"><button onClick={()=>{setEditing(x);setShow(true)}}>Edit</button><button className="danger" onClick={()=>remove(x)}>Delete</button></span>
      </div>)}{!filtered.length&&<Empty text="No matching contacts."/>}
    </div>
  </div>
}

function Schedule(){
  const[rows,setRows]=useState([]);
  const[times,setTimes]=useState({});
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const load=()=>api('/campaigns?status=scheduled').then(setRows);
  useEffect(()=>{load().catch(e=>setErr(e.message))},[]);
  async function reschedule(c){
    const scheduledAt=times[c._id];
    if(!scheduledAt)return setErr('Choose a new date and time first.');
    try{await api('/campaigns/'+c._id+'/reschedule',{method:'POST',body:JSON.stringify({scheduledAt})});setMsg('Campaign rescheduled.');await load()}catch(e){setErr(e.message)}
  }
  async function cancel(c){
    if(!confirm('Cancel this scheduled campaign?'))return;
    try{await api('/campaigns/'+c._id+'/cancel',{method:'POST'});setMsg('Campaign cancelled.');await load()}catch(e){setErr(e.message)}
  }
  async function send(c){
    try{await api('/campaigns/'+c._id+'/send',{method:'POST'});setMsg('Campaign processing started.');await load()}catch(e){setErr(e.message)}
  }
  return <div className="page">
    <Title title="Schedule" sub="Manage upcoming automated WhatsApp campaigns."/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <div className="cards">{rows.map(c=><article key={c._id}><div className="cardTop"><div><small>SCHEDULED</small><h3>{c.name}</h3></div><em className="status scheduled">scheduled</em></div><p>{c.message||c.templateId?.name||'Template campaign'}</p><div className="scheduleBox"><b>{fmt(c.scheduledAt)}</b><input id={'reschedule-'+c._id} type="datetime-local" value={times[c._id]||''} onChange={e=>setTimes({...times,[c._id]:e.target.value})}/></div><footer><span>{c.audienceType==='list'?(c.listId?.name||'List'):'Opted-in audience'}</span><div className="rowActions"><button onClick={()=>reschedule(c)}>Reschedule</button><button onClick={()=>send(c)}>Send now</button><button className="danger" onClick={()=>cancel(c)}>Cancel</button></div></footer></article>)}{!rows.length&&<Empty text="No scheduled campaigns."/>}</div>
  </div>
}

function Templates(){
  const[rows,setRows]=useState([]);
  const[show,setShow]=useState(false);
  const[editing,setEditing]=useState(null);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const load=()=>api('/templates').then(setRows);
  useEffect(()=>{load().catch(e=>setErr(e.message))},[]);
  async function save(e){
    e.preventDefault();setErr('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    try{
      if(editing)await api('/templates/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/templates',{method:'POST',body:JSON.stringify(o)});
      setShow(false);setEditing(null);setMsg(editing?'Template updated.':'Template created.');await load();
    }catch(e){setErr(e.message)}
  }
  async function remove(x){
    if(!confirm('Delete template "'+x.name+'"?'))return;
    try{await api('/templates/'+x._id,{method:'DELETE'});setMsg('Template deleted.');await load()}catch(e){setErr(e.message)}
  }
  return <div className="page">
    <Title title="Templates" sub="Reusable freeform copy and Meta-approved WhatsApp templates." action="New template" onAction={()=>{setEditing(null);setShow(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    {show&&<div className="panel"><form key={editing?editing._id:'new'} className="formGrid" onSubmit={save}>
      <label>Name<input name="name" required defaultValue={editing?.name||''}/></label>
      <label>Meta template name<input name="metaTemplateName" placeholder="Optional approved name" defaultValue={editing?.metaTemplateName||''}/></label>
      <label>Language<input name="language" defaultValue={editing?.language||'en_US'}/></label>
      <label>Category<select name="category" defaultValue={editing?.category||'MARKETING'}><option>MARKETING</option><option>UTILITY</option><option>AUTHENTICATION</option></select></label>
      <label className="full">Message body<textarea rows="5" name="body" required defaultValue={editing?.body||''}/></label>
      <div className="actions full"><button type="button" onClick={()=>{setShow(false);setEditing(null)}}>Cancel</button><button className="primary">{editing?'Update template':'Save template'}</button></div>
    </form></div>}
    <div className="cards">{rows.map(x=><article key={x._id}><small>{x.category} · {x.language}</small><h3>{x.name}</h3><p>{x.body}</p><footer><span>{x.metaTemplateName?'Meta: '+x.metaTemplateName:'Freeform message'}</span><div className="rowActions"><button onClick={()=>{setEditing(x);setShow(true)}}>Edit</button><button className="danger" onClick={()=>remove(x)}>Delete</button></div></footer></article>)}{!rows.length&&<Empty text="No templates yet."/>}</div>
  </div>
}

function DeliveryTable({rows}){
  return <div className="table">
    <div className="tr delivery th"><span>Recipient</span><span>Campaign</span><span>Status</span><span>Provider</span><span>Time</span><span>Error</span></div>
    {rows.map(x=><div className="tr delivery" key={x._id}>
      <span><b>{x.contactId?.name||x.phone}</b><small>{x.phone}</small></span>
      <span>{x.campaignId?.name||'Personal message'}</span>
      <span><em className={'status '+(x.status==='failed'?'failed':x.status==='read'||x.status==='delivered'?'completed':'scheduled')}>{statusLabel(x.status)}</em></span>
      <span>{x.provider}</span><span>{fmt(x.sentAt||x.createdAt)}</span><span className="errorText">{x.error||'—'}</span>
    </div>)}{!rows.length&&<Empty text="No delivery records."/>}
  </div>
}

function Reports(){
  const[d,setD]=useState(null);
  const[rows,setRows]=useState([]);
  const[filter,setFilter]=useState('all');
  const[err,setErr]=useState('');
  useEffect(()=>{Promise.all([api('/dashboard'),api('/campaigns/deliveries?limit=250')]).then(([a,b])=>{setD(a);setRows(b)}).catch(e=>setErr(e.message))},[]);
  if(err)return <div className="page"><Notice type="bad">{err}</Notice></div>;
  if(!d)return <Loading/>;
  const filtered=filter==='all'?rows:rows.filter(x=>x.status===filter);
  return <div className="page">
    <Title title="Delivery reports" sub="Audit message delivery, reads and failures across personal and campaign sends."/>
    <div className="metrics"><Metric label="Submitted" value={d.metrics.submitted} sub="Accepted for delivery"/><Metric label="Delivered" value={d.metrics.delivered} sub={d.metrics.deliveryRate+'% delivery rate'}/><Metric label="Read" value={d.metrics.read} sub="Confirmed read receipts"/><Metric label="Failed" value={d.metrics.failed} sub="Last 14 days"/></div>
    <div className="toolbar"><div className="toolbarGroup"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option></select></div></div>
    <DeliveryTable rows={filtered}/>
    <CampaignTable rows={d.recent}/>
  </div>
}

function Settings({go}){
  const[connections,setConnections]=useState(null);
  const[err,setErr]=useState('');
  useEffect(()=>{api('/integrations/whatsapp-connections').then(setConnections).catch(e=>setErr(e.message))},[]);
  const current=connections?.connections?.find(x=>x.isDefault)||connections?.connections?.[0];
  return <div className="page">
    <Title title="Settings" sub="Application status and messaging defaults."/>
    <Notice type="bad">{err}</Notice>
    <div className="settingsGrid">
      <section>
        <h2>Messaging default</h2>
        <p>{current?('Current sender: '+current.name):'No messaging provider configured.'}</p>
        {current&&<div className="profileDetails"><div><span>Provider</span><b>{current.provider}</b></div><div><span>Status</span><b>{current.enabled?'Enabled':'Disabled'}</b></div></div>}
        <button className="primary" onClick={()=>go('profile')}>Manage WhatsApp connections</button>
      </section>
      <section>
        <h2>Account & security</h2>
        <p>Profile image, password, WhatsApp 2FA, workspace, subscription and team controls now live in your Profile account center.</p>
        <button onClick={()=>go('profile')}>Open Profile</button>
      </section>
      <section>
        <h2>Deployment status</h2>
        <p>API endpoint</p><code>{BASE}</code>
        <p className="muted">Scheduled campaigns are checked every 60 seconds while the API service is awake. Free Render services can sleep when idle.</p>
      </section>
      <section>
        <h2>Webhook endpoint</h2>
        <p>Meta delivery webhooks are received by the WA SANTA API.</p>
        <code>{BASE.replace(/\/api$/,'')+'/api/webhooks/meta'}</code>
        <p className="muted">The verification token is available inside Profile → Meta WhatsApp connection settings.</p>
      </section>
    </div>
  </div>
}

function EditProfile({go,onSessionUpdate}){
  const[data,setData]=useState(null);
  const[avatar,setAvatar]=useState('');
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  useEffect(()=>{api('/account/profile').then(x=>{setData(x);setAvatar(x.user.avatarData||'')}).catch(e=>setErr(e.message))},[]);
  if(!data)return <div className="page">{err?<Notice type="bad">{err}</Notice>:<Loading/>}</div>;
  function chooseImage(e){
    const file=e.target.files?.[0];
    if(!file)return;
    if(!file.type.startsWith('image/'))return setErr('Choose an image file');
    if(file.size>350*1024)return setErr('Profile image must be under 350 KB');
    const reader=new FileReader();
    reader.onload=()=>setAvatar(String(reader.result||''));
    reader.readAsDataURL(file);
  }
  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    o.avatarData=avatar;
    try{
      await api('/account/profile',{method:'PUT',body:JSON.stringify(o)});
      const fresh=await api('/auth/me');
      onSessionUpdate(fresh);
      setMsg('Profile updated.');
      go('profile');
    }catch(e){setErr(e.message)}
  }
  return <div className="page">
    <div className="title"><div><span>WA SANTA</span><h1>Edit profile</h1><p>Update your photo, avatar and personal information.</p></div><button onClick={()=>go('profile')}>← Back to profile</button></div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <div className="editProfileGrid">
      <section className="avatarEditor">
        <div className="largeAvatar">{avatar?<img src={avatar} alt="Profile preview"/>:(data.user.name?.[0]?.toUpperCase()||'U')}</div>
        <h2>Profile image</h2>
        <p>Upload a JPG, PNG or WebP image under 350 KB.</p>
        <label className="uploadButton">Choose image<input type="file" accept="image/*" onChange={chooseImage}/></label>
        {avatar&&<button className="danger" onClick={()=>setAvatar('')}>Remove image</button>}
      </section>
      <section>
        <h2>Profile information</h2>
        <form className="formGrid" onSubmit={save}>
          <label>Full name<input name="name" defaultValue={data.user.name} required/></label>
          <label>Email<input value={data.user.email} readOnly/></label>
          <label>Phone<input name="phone" defaultValue={data.user.phone||''} placeholder="+919876543210"/></label>
          <label>Job title<input name="jobTitle" defaultValue={data.user.jobTitle||''} placeholder="Marketing Manager"/></label>
          <div className="actions full"><button type="button" onClick={()=>go('profile')}>Cancel</button><button className="primary">Save profile</button></div>
        </form>
      </section>
    </div>
  </div>
}

function Profile({session,go,onSessionUpdate}){
  const[data,setData]=useState(null);
  const[connections,setConnections]=useState([]);
  const[connSub,setConnSub]=useState(null);
  const[team,setTeam]=useState([]);
  const[showConnection,setShowConnection]=useState(false);
  const[editingConnection,setEditingConnection]=useState(null);
  const[showMember,setShowMember]=useState(false);
  const[otpSent,setOtpSent]=useState(false);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');

  async function load(){
    try{
      const p=await api('/account/profile');
      const t=await api('/account/team');
      setData(p);setTeam(t.members);
      if(p.workspace?.access?.allowed){
        const x=await api('/integrations/whatsapp-connections');
        setConnections(x.connections);setConnSub(x.subscription);
      }else{
        setConnections([]);setConnSub({plan:p.workspace.plan||'trial',used:0,max:p.workspace.limits?.metaConnections||0});
      }
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);
  if(!data)return <div className="page">{err?<Notice type="bad">{err}</Notice>:<Loading/>}</div>;
  const manager=['owner','admin'].includes(data.user.role);
  const usable2fa=connections.filter(x=>x.provider==='meta'&&x.enabled&&x.otpTemplateName);

  async function changePassword(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    if(o.newPassword!==o.confirmPassword)return setErr('New passwords do not match');
    delete o.confirmPassword;
    try{await api('/auth/password',{method:'POST',body:JSON.stringify(o)});e.currentTarget.reset();setMsg('Password changed successfully.')}catch(e){setErr(e.message)}
  }
  async function saveWorkspace(e){
    e.preventDefault();setErr('');
    try{
      await api('/account/workspace',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});
      const fresh=await api('/auth/me');onSessionUpdate(fresh);setMsg('Workspace updated.');await load();
    }catch(e){setErr(e.message)}
  }
  async function saveConnection(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    try{
      if(editingConnection)await api('/integrations/whatsapp-connections/'+editingConnection.id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/integrations/whatsapp-connections',{method:'POST',body:JSON.stringify(o)});
      setShowConnection(false);setEditingConnection(null);setMsg(editingConnection?'WhatsApp connection updated.':'Meta WhatsApp connected.');await load();
    }catch(e){setErr(e.message)}
  }
  async function connectionAction(x,type){
    setErr('');setMsg('');
    try{
      if(type==='test'){const y=await api('/integrations/whatsapp-connections/'+x.id+'/test',{method:'POST'});setMsg('Connected: '+(y.verifiedName||y.displayPhoneNumber||x.name))}
      if(type==='default'){await api('/integrations/whatsapp-connections/'+x.id+'/default',{method:'POST'});setMsg(x.name+' is now the default sender.')}
      if(type==='delete'){if(!confirm('Remove '+x.name+'?'))return;await api('/integrations/whatsapp-connections/'+x.id,{method:'DELETE'});setMsg('WhatsApp connection removed.')}
      await load();
    }catch(e){setErr(e.message)}
  }
  async function addMember(e){
    e.preventDefault();setErr('');
    try{await api('/account/team',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setShowMember(false);setMsg('Team member added.');await load()}catch(e){setErr(e.message)}
  }
  async function roleChange(member,role){
    try{await api('/account/team/'+member.id,{method:'PUT',body:JSON.stringify({role})});await load()}catch(e){setErr(e.message)}
  }
  async function removeMember(member){
    if(!confirm('Remove '+member.name+' from this workspace?'))return;
    try{await api('/account/team/'+member.id,{method:'DELETE'});setMsg('Team member removed.');await load()}catch(e){setErr(e.message)}
  }
  async function send2fa(e){
    e.preventDefault();setErr('');
    try{await api('/account/security/2fa/send-setup',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setOtpSent(true);setMsg('WhatsApp OTP sent. It expires in 5 minutes.')}catch(e){setErr(e.message)}
  }
  async function confirm2fa(e){
    e.preventDefault();setErr('');
    try{await api('/account/security/2fa/confirm',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setOtpSent(false);setMsg('WhatsApp two-factor authentication enabled.');await load()}catch(e){setErr(e.message)}
  }
  async function disable2fa(e){
    e.preventDefault();setErr('');
    try{await api('/account/security/2fa/disable',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setMsg('Two-factor authentication disabled.');e.currentTarget.reset();await load()}catch(e){setErr(e.message)}
  }

  return <div className="page">
    <div className="title"><div><span>ACCOUNT CENTER</span><h1>Profile</h1><p>Identity, security, WhatsApp connections, subscription, workspace and team.</p></div><button className="primary" onClick={()=>go('edit-profile')}>Edit profile</button></div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>

    <section className="profileOverview">
      <div className="profileIdentity"><Avatar user={data.user} className="profileHeroAvatar"/><div><h2>{data.user.name}</h2><p>{data.user.jobTitle||data.user.role} · {data.user.email}</p><span className="status completed">Active account</span></div></div>
      <div className="profileDetails">
        <div><span>Phone</span><b>{data.user.phone||'Not added'}</b></div>
        <div><span>Role</span><b>{data.user.role}</b></div>
        <div><span>Workspace</span><b>{data.workspace.name}</b></div>
        <div><span>2FA</span><b>{data.user.twoFactorEnabled?'WhatsApp enabled':'Not enabled'}</b></div>
      </div>
    </section>

    <div className="accountGrid">
      <section>
        <div className="sectionHead"><div><h2>Security</h2><p>Password and WhatsApp Meta OTP two-factor authentication.</p></div></div>
        <form className="formGrid compactForm" onSubmit={changePassword}>
          <label className="full">Current password<input type="password" name="currentPassword" required autoComplete="current-password"/></label>
          <label>New password<input type="password" name="newPassword" minLength="8" required autoComplete="new-password"/></label>
          <label>Confirm password<input type="password" name="confirmPassword" minLength="8" required autoComplete="new-password"/></label>
          <div className="actions full"><button className="primary">Change password</button></div>
        </form>
        <div className="subDivider"></div>
        <h3>WhatsApp two-factor authentication</h3>
        {data.user.twoFactorEnabled?<form className="inlineSecurity" onSubmit={disable2fa}><span className="securityOn">● Enabled on {data.user.twoFactorPhone}</span><input type="password" name="currentPassword" placeholder="Current password to disable" required/><button className="danger">Disable 2FA</button></form>:<>
          <p className="muted">Login OTP is sent through one of your approved Meta WhatsApp authentication templates.</p>
          {!usable2fa.length?<Notice type="bad">Add a Meta WhatsApp connection and configure its OTP authentication template first.</Notice>:<form className="formGrid compactForm" onSubmit={send2fa}>
            <label>WhatsApp number<input name="phone" defaultValue={data.user.phone||''} placeholder="+919876543210" required/></label>
            <label>OTP connection<select name="integrationId" required defaultValue=""><option value="">Choose Meta connection</option>{usable2fa.map(x=><option key={x.id} value={x.id}>{x.name}{x.displayPhoneNumber?' · '+x.displayPhoneNumber:''}</option>)}</select></label>
            <div className="actions full"><button>Send verification OTP</button></div>
          </form>}
          {otpSent&&<form className="otpConfirm" onSubmit={confirm2fa}><input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6-digit OTP" required/><button className="primary">Verify & enable 2FA</button></form>}
        </>}
      </section>

      <section className="subscriptionCard">
        <div className="sectionHead"><div><h2>Subscription</h2><p>Your current WA SANTA plan and usage.</p></div><em className={'status '+(data.workspace.subscriptionStatus==='active'?'completed':'scheduled')}>{data.workspace.subscriptionStatus}</em></div>
        <div className="planName">{data.workspace.plan}<small>Current plan</small></div>
        <div className="usageRow"><span>Meta WhatsApp connections</span><b>{data.workspace.usage.metaConnections} / {data.workspace.limits.metaConnections}</b></div>
        <div className="usageRow"><span>Team members</span><b>{data.workspace.usage.teamMembers} / {data.workspace.limits.teamMembers}</b></div>
        {data.workspace.trialEndsAt&&data.workspace.subscriptionStatus==='trialing'&&<div className="usageRow"><span>Trial ends</span><b>{fmt(data.workspace.trialEndsAt)}</b></div>}
        {data.workspace.currentPeriodEnd&&<div className="usageRow"><span>Current period ends</span><b>{fmt(data.workspace.currentPeriodEnd)}</b></div>}
        <button className="primary manageSubButton" onClick={()=>go('subscription')}>Manage subscription</button>
      </section>
    </div>

    <section>
      <div className="sectionHead"><div><h2>Connect Meta WhatsApp</h2><p>Connect multiple WhatsApp Cloud API numbers according to your subscription plan.</p></div>{connSub&&connSub.used<connSub.max&&<button className="primary" onClick={()=>{setEditingConnection(null);setShowConnection(true)}}>+ Add connection</button>}</div>
      <div className="planHint">{connSub?.plan} plan · {connSub?.used||0} of {connSub?.max||1} Meta connections used</div>
      {showConnection&&<div className="panel nestedPanel"><form key={editingConnection?.id||'new-meta'} className="formGrid" onSubmit={saveConnection}>
        <label>Connection name<input name="name" defaultValue={editingConnection?.name||''} placeholder="Sales WhatsApp" required/></label>
        <label>Graph version<input name="graphVersion" defaultValue={editingConnection?.graphVersion||'v23.0'}/></label>
        <label>Phone Number ID<input name="phoneNumberId" defaultValue={editingConnection?.phoneNumberId||''} required/></label>
        <label>Business Account ID<input name="businessAccountId" defaultValue={editingConnection?.businessAccountId||''}/></label>
        <label className="full">Access token<input type="password" name="accessToken" required={!editingConnection} placeholder={editingConnection?.hasAccessToken?'Saved securely — leave blank to keep':'Meta system-user access token'}/></label>
        <label>OTP authentication template<input name="otpTemplateName" defaultValue={editingConnection?.otpTemplateName||''} placeholder="login_otp"/></label>
        <label>OTP template language<input name="otpTemplateLanguage" defaultValue={editingConnection?.otpTemplateLanguage||'en_US'}/></label>
        <div className="actions full"><button type="button" onClick={()=>{setShowConnection(false);setEditingConnection(null)}}>Cancel</button><button className="primary">{editingConnection?'Update connection':'Connect & verify'}</button></div>
      </form></div>}
      <div className="connectionGrid">{connections.map(x=><article className={'connectionCard '+(x.isDefault?'defaultConnection':'')} key={x.id}>
        <div className="cardTop"><div><small>{x.provider==='meta'?'META CLOUD API':'DEMO'}</small><h3>{x.name}</h3></div>{x.isDefault&&<em className="status completed">Default</em>}</div>
        <p>{x.provider==='meta'?(x.displayPhoneNumber||x.phoneNumberId):'Safe test provider — no real WhatsApp messages are sent.'}</p>
        {x.provider==='meta'&&<div className="connectionMeta"><span>OTP: {x.otpTemplateName||'Not configured'}</span><span>{x.enabled?'Enabled':'Disabled'}</span></div>}
        <footer><span>{x.hasAccessToken?'Token secured':'No token required'}</span><div className="rowActions">
          {x.provider==='meta'&&<><button onClick={()=>connectionAction(x,'test')}>Test</button><button onClick={()=>{setEditingConnection(x);setShowConnection(true)}}>Edit</button>{!x.isDefault&&<button onClick={()=>connectionAction(x,'default')}>Make default</button>}<button className="danger" onClick={()=>connectionAction(x,'delete')}>Remove</button></>}
        </div></footer>
      </article>)}</div>
    </section>

    <div className="accountGrid">
      <section>
        <div className="sectionHead"><div><h2>Workspace</h2><p>Workspace identity and ownership.</p></div></div>
        <form className="formGrid compactForm" onSubmit={saveWorkspace}>
          <label className="full">Workspace name<input name="name" defaultValue={data.workspace.name} disabled={!manager}/></label>
          <div className="profileDetails full"><div><span>Your role</span><b>{data.user.role}</b></div><div><span>Workspace ID</span><b>{data.workspace.id}</b></div></div>
          {manager&&<div className="actions full"><button className="primary">Save workspace</button></div>}
        </form>
      </section>

      <section>
        <div className="sectionHead"><div><h2>Team</h2><p>{team.length} of {data.workspace.limits.teamMembers} seats used.</p></div>{manager&&team.length<data.workspace.limits.teamMembers&&<button onClick={()=>setShowMember(!showMember)}>+ Add member</button>}</div>
        {showMember&&<form className="formGrid compactForm teamAdd" onSubmit={addMember}>
          <label>Name<input name="name" required/></label><label>Email<input type="email" name="email" required/></label>
          <label>Role<select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <label>Temporary password<input type="password" name="temporaryPassword" minLength="8" required/></label>
          <div className="actions full"><button className="primary">Create team account</button></div>
        </form>}
        <div className="teamList">{team.map(member=><div className="teamMember" key={member.id}><Avatar user={member} className="teamAvatar"/><div><b>{member.name}</b><small>{member.email}</small></div>{manager&&member.role!=='owner'&&member.id!==data.user.id?<><select value={member.role} onChange={e=>roleChange(member,e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select><button className="danger" onClick={()=>removeMember(member)}>Remove</button></>:<em>{member.role}</em>}</div>)}</div>
      </section>
    </div>
  </div>
}

function Page({id,go,session,onSessionUpdate}){
  if(id==='overview')return <Overview go={go}/>;
  if(id==='send')return <SingleSend/>;
  if(id==='campaigns')return <Campaigns/>;
  if(id==='contacts')return <Contacts/>;
  if(id==='schedule')return <Schedule/>;
  if(id==='templates')return <Templates/>;
  if(id==='reports')return <Reports/>;
  if(id==='profile')return <Profile session={session} go={go} onSessionUpdate={onSessionUpdate}/>;
  if(id==='edit-profile')return <EditProfile go={go} onSessionUpdate={onSessionUpdate}/>;
  return <Settings go={go}/>;
}

export default function App(){
  const[session,setSession]=useState(undefined);
  useEffect(()=>{
    api('/auth/me').then(setSession).catch(()=>setSession(null));
    const unauth=()=>setSession(null);
    window.addEventListener('cc:unauthorized',unauth);
    return()=>window.removeEventListener('cc:unauthorized',unauth);
  },[]);
  async function logout(){
    try{await api('/auth/logout',{method:'POST'})}catch{}
    setSession(null);
  }
  if(session===undefined)return <Loading/>;
  return session?<Shell session={session} onLogout={logout} onSessionUpdate={setSession}/>:<Auth onAuth={setSession}/>;
}