import React,{useEffect,useMemo,useState}from'react';
import{api,BASE,getCached,warmWorkspace}from'./api.js';
import Payments from './Payments.jsx';
import CampaignComposer,{blankCampaignDraft,existingCampaignDraft} from './CampaignComposer.jsx';

const nav=[
  ['overview','Overview','⌂'],
  ['send','Send message','➤'],
  ['campaigns','Campaigns','✦'],
  ['contacts','Contacts','◎'],
  ['schedule','Schedule','◷'],
  ['templates','Templates','▤'],
  ['reports','Delivery reports','▥'],
  ['whatsapp-api','Meta WhatsApp API','☏'],
  ['payments','WhatsApp Payments','₹'],
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
      <p>{mode==='login'?'Sign in to continue to WA SANTA.':'Start with 7 days of trial access. After the trial, choose a subscription plan approved by Super Admin.'}</p>
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
  const locked=id=>!access.allowed&&!['subscription','profile','edit-profile','admin'].includes(id);
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
  const[d,setD]=useState(()=>getCached('/dashboard')||null);
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
  const[contacts,setContacts]=useState(()=>getCached('/contacts')||[]);
  const[templates,setTemplates]=useState(()=>getCached('/templates')||[]);
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
  const[rows,setRows]=useState(()=>getCached('/campaigns')||[]);
  const[lists,setLists]=useState(()=>getCached('/lists')||[]);
  const[templates,setTemplates]=useState(()=>getCached('/templates')||[]);
  const[contacts,setContacts]=useState(()=>getCached('/contacts')||[]);
  const[show,setShow]=useState(false);
  const[editing,setEditing]=useState(null);
  const[draft,setDraft]=useState(blankCampaignDraft);
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
    o.contentType=draft.contentType;
    o.message=draft.message;
    o.integrationId=draft.integrationId||null;
    o.carouselCards=draft.contentType==='carousel'?draft.carouselCards:[];
    if(draft.contentType==='carousel')o.templateId=null;
    if(!o.scheduledAt)delete o.scheduledAt;
    if(o.audienceType!=='list')o.listId=null;
    try{
      if(editing) await api('/campaigns/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/campaigns',{method:'POST',body:JSON.stringify(o)});
      setShow(false);setEditing(null);setDraft(blankCampaignDraft());setMsg(editing?'Campaign updated.':'Campaign created.');await load();
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
    <Title title="Campaigns" sub="Create, schedule, send, retry and audit WhatsApp campaigns with native text formatting and image carousels." action="New campaign" onAction={()=>{setEditing(null);setDraft(blankCampaignDraft());setShow(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    {show&&<div className="panel"><form key={editing?editing._id:'new'} className="formGrid" onSubmit={save}>
      <label htmlFor="campaign-name">Campaign name<input id="campaign-name" name="name" required defaultValue={editing?.name||''}/></label>
      <label htmlFor="campaign-audience">Audience<select id="campaign-audience" name="audienceType" defaultValue={editing?.audienceType||'all'}><option value="all">All opted-in contacts</option><option value="list">Contact list</option><option value="contacts">Specific contacts</option></select></label>
      <label>Contact list<select name="listId" defaultValue={editing?.listId?._id||editing?.listId||''}><option value="">Choose list</option>{lists.map(x=><option value={x._id} key={x._id}>{x.name} ({x.contactCount||0})</option>)}</select></label>
      <label>Template<select name="templateId" disabled={draft.contentType==='carousel'} defaultValue={editing?.templateId?._id||editing?.templateId||''}><option value="">Freeform message</option>{templates.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select></label>
      <label className="full">Specific contacts<select name="contactIds" multiple size="5" defaultValue={editing?.contactIds?.map(String)||[]}>{contacts.filter(x=>x.consentStatus==='opted_in'&&!x.suppressed).map(x=><option value={x._id} key={x._id}>{x.name||'Unnamed'} · {x.phone}</option>)}</select></label>
      <CampaignComposer draft={draft} onChange={setDraft}/>
      <label htmlFor="campaign-scheduled-at">Schedule for<input id="campaign-scheduled-at" type="datetime-local" name="scheduledAt" defaultValue={editing?.scheduledAt?new Date(new Date(editing.scheduledAt).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''}/></label>
      <div className="actions"><button type="button" onClick={()=>{setShow(false);setEditing(null);setDraft(blankCampaignDraft())}}>Cancel</button><button className="primary">{editing?'Update campaign':'Save campaign'}</button></div>
    </form></div>}
    <div className="cards campaignCards">{rows.map(c=><article key={c._id}>
      <div className="cardTop"><div><small>CAMPAIGN</small><h3>{c.name}</h3></div><em className={'status '+c.status}>{statusLabel(c.status)}</em></div>
      <p>{c.contentType==='carousel'?'🖼 Image carousel · '+(c.carouselCards?.length||0)+' cards · '+(c.message||''):c.message||c.templateId?.name||'WhatsApp template message'}</p>
      <div className="stats"><span><b>{c.totals?.submitted||0}</b> submitted</span><span><b>{c.totals?.delivered||0}</b> delivered</span><span><b>{c.totals?.read||0}</b> read</span><span><b>{c.totals?.failed||0}</b> failed</span></div>
      {c.lastError&&<small className="warnText">{c.lastError}</small>}
      <footer><span>{c.scheduledAt?fmt(c.scheduledAt):'No schedule'}</span><div className="rowActions">
        <button onClick={()=>viewDeliveries(c)}>Deliveries</button>
        {!['processing','completed'].includes(c.status)&&<button onClick={()=>{setEditing(c);setDraft(existingCampaignDraft(c));setShow(true)}}>Edit</button>}
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
  const[rows,setRows]=useState(()=>getCached('/contacts')||[]);
  const[lists,setLists]=useState(()=>getCached('/lists')||[]);
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
  const[rows,setRows]=useState(()=>getCached('/campaigns?status=scheduled')||[]);
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
  const[rows,setRows]=useState(()=>getCached('/templates')||[]);
  const[connections,setConnections]=useState(()=>getCached('/integrations/whatsapp-connections')?.connections||[]);
  const[show,setShow]=useState(false);
  const[editing,setEditing]=useState(null);
  const[mode,setMode]=useState('local');
  const[selectedProfile,setSelectedProfile]=useState(()=>localStorage.getItem('wa:template-profile')||'');
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');

  async function load(){
    try{
      const [templates,conn]=await Promise.all([api('/templates'),api('/integrations/whatsapp-connections')]);
      setRows(templates);
      const meta=(conn.connections||[]).filter(x=>x.provider==='meta');
      setConnections(meta);
      if(selectedProfile&&!meta.some(x=>x.id===selectedProfile))setSelectedProfile('');
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);

  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    try{
      if(mode==='meta'){
        if(!selectedProfile)return setErr('Choose a connected Meta WhatsApp profile');
        o.metaTemplateName=o.metaTemplateName||o.name;
        o.bodyExamples=String(o.bodyExamples||'').split(',').map(x=>x.trim()).filter(Boolean);
        await api('/templates/meta/'+selectedProfile,{method:'POST',body:JSON.stringify(o)});
        setMsg('Template submitted to Meta for review.');
      }else if(editing){
        await api('/templates/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
        setMsg('Local template updated.');
      }else{
        await api('/templates',{method:'POST',body:JSON.stringify(o)});
        setMsg('Local template created.');
      }
      setShow(false);setEditing(null);await load();
    }catch(e){setErr(e.message)}
  }

  async function syncProfile(id){
    setErr('');setMsg('');
    try{
      const x=await api('/templates/meta/'+id+'/sync',{method:'POST'});
      setMsg('Synced '+x.synced+' template(s) from Meta.');
      await load();
    }catch(e){setErr(e.message)}
  }

  async function remove(x){
    if(x.metaTemplateId){
      if(!confirm('Delete "'+x.metaTemplateName+'" from Meta and WA SANTA?'))return;
      try{await api('/templates/meta/'+x._id,{method:'DELETE'});setMsg('Meta template deleted.');await load()}catch(e){setErr(e.message)}
      return;
    }
    if(!confirm('Delete template "'+x.name+'"?'))return;
    try{await api('/templates/'+x._id,{method:'DELETE'});setMsg('Template deleted.');await load()}catch(e){setErr(e.message)}
  }

  function openNew(kind,profileId=''){
    setEditing(null);setMode(kind);
    if(profileId){setSelectedProfile(profileId);localStorage.setItem('wa:template-profile',profileId)}
    setShow(true);
  }

  const selected=connections.find(x=>x.id===selectedProfile);
  const filtered=selectedProfile?rows.filter(x=>(x.integrationId?._id||x.integrationId)===selectedProfile):rows;

  return <div className="page">
    <div className="title">
      <div><span>WA SANTA</span><h1>Templates</h1><p>Create local reusable copy or submit templates directly to a connected Meta WhatsApp profile.</p></div>
      <div className="rowActions"><button onClick={()=>openNew('local')}>+ Local template</button><button className="primary" disabled={!connections.length} onClick={()=>openNew('meta',selectedProfile||connections[0]?.id)}>+ Meta template</button></div>
    </div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>

    <section className="templateProfileBar">
      <div>
        <small>META PROFILE</small>
        <select value={selectedProfile} onChange={e=>{setSelectedProfile(e.target.value);if(e.target.value)localStorage.setItem('wa:template-profile',e.target.value);else localStorage.removeItem('wa:template-profile')}}>
          <option value="">All templates / profiles</option>
          {connections.map(x=><option value={x.id} key={x.id}>{x.name}{x.displayPhoneNumber?' · '+x.displayPhoneNumber:''}</option>)}
        </select>
      </div>
      {selectedProfile&&<div className="rowActions"><button onClick={()=>syncProfile(selectedProfile)}>↻ Sync from Meta</button><button className="primary" onClick={()=>openNew('meta',selectedProfile)}>+ Create for {selected?.name||'profile'}</button></div>}
    </section>

    {!connections.length&&<Notice type="bad">Connect a Meta WhatsApp API profile first to create Meta-approved templates.</Notice>}

    {show&&<div className="panel">
      <div className="sectionHead"><div><h2>{mode==='meta'?'Create Meta template':editing?'Edit local template':'Create local template'}</h2><p>{mode==='meta'?'The template will be submitted to Meta and usually starts as PENDING.':'Reusable copy stored only inside WA SANTA.'}</p></div></div>
      <form key={(editing?editing._id:'new')+'-'+mode} className="formGrid" onSubmit={save}>
        {mode==='meta'&&<label className="full">Connected Meta profile<select value={selectedProfile} onChange={e=>setSelectedProfile(e.target.value)} required><option value="">Choose Meta profile</option>{connections.map(x=><option value={x.id} key={x.id}>{x.name}{x.displayPhoneNumber?' · '+x.displayPhoneNumber:''}</option>)}</select></label>}
        <label>Display name<input name="name" required defaultValue={editing?.name||''} placeholder="Order confirmation"/></label>
        {mode==='meta'&&<label>Meta template name<input name="metaTemplateName" required placeholder="order_confirmation"/></label>}
        <label>Language<input name="language" defaultValue={editing?.language||'en_US'}/></label>
        <label>Category<select name="category" defaultValue={editing?.category||'MARKETING'}><option>MARKETING</option><option>UTILITY</option><option>AUTHENTICATION</option></select></label>
        <label className="full">Message body<textarea rows="5" name="body" required={mode!=='meta'} defaultValue={editing?.body||''} placeholder={mode==='meta'?'For MARKETING/UTILITY use Meta variables like {{1}}, {{2}}. Authentication templates use Meta OTP format automatically.':'Write reusable message text…'}/></label>
        {mode==='meta'&&<label className="full">Variable examples<input name="bodyExamples" placeholder="Example for {{1}}, Example for {{2}}"/><small>Required when the body contains positional Meta variables.</small></label>}
        <div className="actions full"><button type="button" onClick={()=>{setShow(false);setEditing(null)}}>Cancel</button><button className="primary">{mode==='meta'?'Submit to Meta':'Save template'}</button></div>
      </form>
    </div>}

    <div className="cards templateCards">{filtered.map(x=><article key={x._id}>
      <div className="cardTop"><div><small>{x.category} · {x.language}</small><h3>{x.name}</h3></div><em className={'status '+(x.metaStatus==='APPROVED'?'completed':x.metaStatus==='REJECTED'?'failed':x.metaStatus==='PENDING'?'scheduled':'cancelled')}>{x.metaStatus||'LOCAL'}</em></div>
      <p>{x.body}</p>
      <div className="templateMetaInfo">
        <span><small>Profile</small><b>{x.integrationId?.name||'Local only'}</b></span>
        <span><small>Meta name</small><b>{x.metaTemplateName||'—'}</b></span>
        <span><small>Meta ID</small><b>{x.metaTemplateId||'—'}</b></span>
      </div>
      {x.metaRejectedReason&&<Notice type="bad">{x.metaRejectedReason}</Notice>}
      <footer><span>{x.metaLastSyncedAt?'Synced '+fmt(x.metaLastSyncedAt):'Local template'}</span><div className="rowActions">
        {!x.metaTemplateId&&<button onClick={()=>{setEditing(x);setMode('local');setShow(true)}}>Edit</button>}
        <button className="danger" onClick={()=>remove(x)}>{x.metaTemplateId?'Delete from Meta':'Delete'}</button>
      </div></footer>
    </article>)}{!filtered.length&&<Empty text="No templates for this selection."/>}</div>
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
  const[d,setD]=useState(()=>getCached('/dashboard')||null);
  const[rows,setRows]=useState(()=>getCached('/campaigns/deliveries?limit=250')||[]);
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
  const[connections,setConnections]=useState(()=>getCached('/integrations/whatsapp-connections')||null);
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
        <button className="primary" onClick={()=>go('whatsapp-api')}>Manage WhatsApp connections</button>
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
        <p className="muted">The verification token is available inside the Meta WhatsApp API page.</p>
      </section>
    </div>
  </div>
}

function EditProfile({go,onSessionUpdate}){
  const[data,setData]=useState(()=>getCached('/account/profile')||null);
  const[avatar,setAvatar]=useState(()=>getCached('/account/profile')?.user?.avatarData||'');
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
  const[data,setData]=useState(()=>getCached('/account/profile')||null);
  const[connections,setConnections]=useState(()=>getCached('/integrations/whatsapp-connections')?.connections||[]);
  const[connSub,setConnSub]=useState(()=>getCached('/integrations/whatsapp-connections')?.subscription||null);
  const[team,setTeam]=useState(()=>getCached('/account/team')?.members||[]);
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
  const canManageTeam=manager&&data.workspace.subscriptionStatus==='active';
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

    <section className="metaShortcut">
      <div>
        <small>META WHATSAPP CLOUD API</small>
        <h2>WhatsApp API connections</h2>
        <p>Manage WhatsApp Business API numbers on a dedicated page. Your plan currently allows {data.workspace.limits.metaConnections} connection(s).</p>
      </div>
      <div className="metaShortcutStats">
        <span><b>{connections.filter(x=>x.provider==='meta').length}</b> connected</span>
        <span><b>{connections.filter(x=>x.provider==='meta'&&x.isDefault).length}</b> default sender</span>
        <button className="primary" onClick={()=>go('whatsapp-api')}>Manage Meta WhatsApp API</button>
      </div>
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
        <div className="sectionHead"><div><h2>Team</h2><p>{team.length} of {data.workspace.limits.teamMembers} seats used.</p></div>{canManageTeam&&team.length<data.workspace.limits.teamMembers&&<button onClick={()=>setShowMember(!showMember)}>+ Add member</button>}</div>
        {!canManageTeam&&<Notice type="bad">Team management requires an active subscription. You can view existing members, but adding, changing roles, and removing members are locked.</Notice>}
        {showMember&&canManageTeam&&<form className="formGrid compactForm teamAdd" onSubmit={addMember}>
          <label>Name<input name="name" required/></label><label>Email<input type="email" name="email" required/></label>
          <label>Role<select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <label>Temporary password<input type="password" name="temporaryPassword" minLength="8" required/></label>
          <div className="actions full"><button className="primary">Create team account</button></div>
        </form>}
        <div className="teamList">{team.map(member=><div className="teamMember" key={member.id}><Avatar user={member} className="teamAvatar"/><div><b>{member.name}</b><small>{member.email}</small></div>{canManageTeam&&member.role!=='owner'&&member.id!==data.user.id?<><select value={member.role} onChange={e=>roleChange(member,e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select><button className="danger" onClick={()=>removeMember(member)}>Remove</button></>:<em>{member.role}</em>}</div>)}</div>
      </section>
    </div>
  </div>
}


function loadFacebookSdk(appId,version='v23.0'){
  return new Promise((resolve,reject)=>{
    if(window.FB){
      try{window.FB.init({appId,cookie:true,xfbml:true,version});resolve(window.FB)}catch(e){reject(e)}
      return;
    }
    const existing=document.getElementById('facebook-jssdk');
    const finish=()=>{
      try{window.FB.init({appId,cookie:true,xfbml:true,version});resolve(window.FB)}
      catch(e){reject(e)}
    };
    window.fbAsyncInit=finish;
    if(existing)return;
    const script=document.createElement('script');
    script.id='facebook-jssdk';
    script.async=true;
    script.defer=true;
    script.crossOrigin='anonymous';
    script.src='https://connect.facebook.net/en_US/sdk.js';
    script.onerror=()=>reject(new Error('Unable to load Facebook SDK'));
    document.body.appendChild(script);
  });
}

function WhatsAppApi({go}){
  const[connections,setConnections]=useState(()=>getCached('/integrations/whatsapp-connections')?.connections||[]);
  const[subscription,setSubscription]=useState(()=>getCached('/integrations/whatsapp-connections')?.subscription||null);
  const[embedded,setEmbedded]=useState(()=>getCached('/integrations/embedded-signup/config')||null);
  const[showForm,setShowForm]=useState(false);
  const[editing,setEditing]=useState(null);
  const[fbBusy,setFbBusy]=useState(false);
  const[coexistence,setCoexistence]=useState(false);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');

  async function load(){
    setErr('');
    try{
      const [x,embed]=await Promise.all([
        api('/integrations/whatsapp-connections'),
        api('/integrations/embedded-signup/config')
      ]);
      setConnections(x.connections||[]);
      setSubscription(x.subscription||null);
      setEmbedded(embed);
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);
  const meta=connections.filter(x=>x.provider==='meta');
  const demo=connections.filter(x=>x.provider==='demo');
  const allowed=subscription?.access?.allowed!==false;
  const canAdd=allowed&&subscription&&subscription.used<subscription.max;
  const verifyToken=connections.find(x=>x.webhookVerifyToken)?.webhookVerifyToken||'';
  const webhook=BASE.replace(/\/api$/,'')+'/api/webhooks/meta';

  async function connectWithFacebook(){
    if(!canAdd)return;
    if(!embedded?.enabled){
      setErr('Facebook Embedded Signup is not configured by the WA SANTA administrator yet.');
      return;
    }
    setFbBusy(true);setErr('');setMsg('');
    let authCode='';
    let session=null;
    let finished=false;
    let timer=null;

    const cleanup=()=>{
      window.removeEventListener('message',listener);
      if(timer)clearTimeout(timer);
    };
    const complete=async()=>{
      if(finished||!authCode||!session?.waba_id)return;
      finished=true;cleanup();
      try{
        const eventName=String(session.event||'').toUpperCase();
        const y=await api('/integrations/embedded-signup/complete',{
          method:'POST',
          body:JSON.stringify({
            code:authCode,
            wabaId:session.waba_id,
            phoneNumberId:session.phone_number_id||'',
            businessPortfolioId:session.business_id||session.businessId||'',
            coexistence:eventName.includes('WHATSAPP_BUSINESS_APP_ONBOARDING')
          })
        });
        setMsg(y.warning||y.message||'Meta WhatsApp connected with Facebook.');
        await load();
      }catch(e){setErr(e.message)}
      finally{setFbBusy(false)}
    };
    const listener=(event)=>{
      const okOrigin=event.origin==='https://www.facebook.com'||event.origin==='https://web.facebook.com'||event.origin.endsWith('.facebook.com');
      if(!okOrigin)return;
      let data=event.data;
      try{if(typeof data==='string')data=JSON.parse(data)}catch{return}
      if(!data||data.type!=='WA_EMBEDDED_SIGNUP')return;
      const name=String(data.event||'').toUpperCase();
      if(name==='CANCEL'){
        api('/integrations/embedded-signup/diagnostic',{method:'POST',body:JSON.stringify({event:name,status:'cancel',detail:String(data.data?.current_step||'')})}).catch(()=>{});
        cleanup();setFbBusy(false);setErr('Facebook signup was cancelled inside Meta.');
        return;
      }
      if(name==='ERROR'){
        cleanup();setFbBusy(false);setErr(data.data?.error_message||'Meta Embedded Signup reported an error.');
        return;
      }
      if(['FINISH','FINISH_ONLY_WABA','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(name)){
        session={...(data.data||{}),event:name};
        complete();
      }
    };

    window.addEventListener('message',listener);
    timer=setTimeout(()=>{
      if(!finished){cleanup();setFbBusy(false);setErr('Facebook signup timed out. Please try again.')}
    },120000);

    try{
      const FB=await loadFacebookSdk(embedded.appId,embedded.graphVersion||'v23.0');
      const extras={setup:{}};
      if(coexistence)extras.featureType='whatsapp_business_app_onboarding';
      FB.login(response=>{
        if(response?.authResponse?.code){
          authCode=response.authResponse.code;
          complete();
          return;
        }
        if(response?.authResponse?.accessToken&&!response?.authResponse?.code){
          cleanup();setFbBusy(false);
          setErr('Meta returned an access token instead of an authorization code. Check that this Facebook Login for Business configuration uses WhatsApp Embedded Signup with response type Code.');
          return;
        }
        if(!finished){
          setTimeout(()=>{
            if(!finished&&!session){
              cleanup();setFbBusy(false);
              const status=response?.status||'unknown';
              api('/integrations/embedded-signup/diagnostic',{method:'POST',body:JSON.stringify({event:'FB_LOGIN_CALLBACK',status,detail:'No authorization code returned'})}).catch(()=>{});
              setErr('Facebook authorization was not completed. Meta status: '+status+'. Check the Facebook Login for Business OAuth/JavaScript SDK settings and the Embedded Signup Configuration ID.');
            }
          },2500);
        }
      },{
        config_id:embedded.configId,
        auth_type:'rerequest',
        response_type:'code',
        override_default_response_type:true,
        extras
      });
    }catch(e){
      cleanup();setFbBusy(false);setErr(e.message||'Unable to open Facebook signup.');
    }
  }

  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    try{
      if(editing){
        await api('/integrations/whatsapp-connections/'+editing.id,{method:'PUT',body:JSON.stringify(o)});
        setMsg('Meta WhatsApp connection updated.');
      }else{
        const y=await api('/integrations/whatsapp-connections',{method:'POST',body:JSON.stringify(o)});
        setMsg(y.warning||'Meta WhatsApp connection added and verified.');
      }
      setShowForm(false);setEditing(null);await load();
    }catch(e){setErr(e.message)}
  }

  async function act(x,type){
    setErr('');setMsg('');
    try{
      if(type==='test'){
        const y=await api('/integrations/whatsapp-connections/'+x.id+'/test',{method:'POST'});
        setMsg('Connection successful: '+(y.verifiedName||y.displayPhoneNumber||x.name));
      }
      if(type==='default'){
        await api('/integrations/whatsapp-connections/'+x.id+'/default',{method:'POST'});
        setMsg(x.name+' is now the default WhatsApp sender.');
      }
      if(type==='delete'){
        if(!confirm('Disconnect '+x.name+'? This removes the saved Meta profile from WA SANTA.'))return;
        await api('/integrations/whatsapp-connections/'+x.id,{method:'DELETE'});
        setMsg('Meta WhatsApp profile disconnected.');
      }
      await load();
    }catch(e){setErr(e.message)}
  }

  return <div className="page">
    <div className="title"><div><span>WHATSAPP CLOUD API</span><h1>Meta WhatsApp API</h1><p>Connect Meta through Facebook Embedded Signup or use manual credentials as an advanced option.</p></div></div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>

    <section className="facebookConnectHero">
      <div className="facebookConnectCopy">
        <span className="facebookLogo">f</span>
        <div><small>RECOMMENDED</small><h2>Connect with Facebook</h2><p>Sign in to Meta, choose your Business Portfolio, WhatsApp Business Account and phone number. WA SANTA securely completes the API connection for you.</p></div>
      </div>
      <div className="facebookConnectAction">
        <label className="coexistenceChoice"><input type="checkbox" checked={coexistence} onChange={e=>setCoexistence(e.target.checked)}/><span><b>Use existing WhatsApp Business App number</b><small>Enable only for Coexistence onboarding. Leave off for normal Cloud API signup.</small></span></label>
        <button className="facebookButton" disabled={!canAdd||fbBusy||!embedded?.enabled} onClick={connectWithFacebook}>{fbBusy?'Connecting with Meta…':'Continue with Facebook'}</button>
        {!embedded?.enabled&&embedded&&<small>Admin setup required: {embedded.missing?.join(', ')||'Meta Embedded Signup configuration'}</small>}
        {embedded?.enabled&&<small>Meta-hosted login · WA SANTA never sees your Facebook password</small>}
      </div>
    </section>

    <section className="whatsappApiHero">
      <div><small>SUBSCRIPTION LIMIT</small><h2>{subscription?.used||0} of {subscription?.max||0} Meta connections used</h2><p>{subscription?.plan||'trial'} plan · {subscription?.access?.state||'loading'} access</p></div>
      <div className="apiUsageMeter"><i style={{width:Math.min(100,((subscription?.used||0)/Math.max(1,subscription?.max||1))*100)+'%'}}></i></div>
      {!allowed&&<Notice type="bad">Meta WhatsApp API management is locked until your subscription or trial is active.</Notice>}
      {allowed&&subscription?.used>=subscription?.max&&<Notice type="bad">You have reached your plan limit. Upgrade your subscription to connect another WhatsApp number.</Notice>}
    </section>

    <section className="manualConnectionBox">
      <div className="sectionHead">
        <div><small>ADVANCED</small><h2>Manual Meta API connection</h2><p>Use this only if you already have a Phone Number ID, WABA ID and access token.</p></div>
        {canAdd&&<button onClick={()=>{setEditing(null);setShowForm(!showForm)}}>{showForm?'Hide manual form':'Connect manually'}</button>}
      </div>
      {showForm&&<div className="panel metaConnectionForm">
        <form key={editing?.id||'new-meta'} className="formGrid" onSubmit={save}>
          <label>Connection name<input name="name" defaultValue={editing?.name||''} placeholder="Sales WhatsApp" required/></label>
          <label>Graph API version<input name="graphVersion" defaultValue={editing?.graphVersion||'v23.0'} placeholder="v23.0"/></label>
          <label>Phone Number ID<input name="phoneNumberId" defaultValue={editing?.phoneNumberId||''} required/></label>
          <label>WhatsApp Business Account ID<input name="businessAccountId" defaultValue={editing?.businessAccountId||''}/></label>
          <label className="full">Permanent/System-user access token<input type="password" name="accessToken" required={!editing} placeholder={editing?.hasAccessToken?'Saved securely — leave blank to keep current token':'Paste Meta access token'}/></label>
          <label>OTP authentication template<input name="otpTemplateName" defaultValue={editing?.otpTemplateName||''} placeholder="login_otp"/></label>
          <label>OTP template language<input name="otpTemplateLanguage" defaultValue={editing?.otpTemplateLanguage||'en_US'} placeholder="en_US"/></label>
          <div className="actions full"><button type="button" onClick={()=>{setShowForm(false);setEditing(null)}}>Cancel</button><button className="primary">{editing?'Save changes':'Connect & verify'}</button></div>
        </form>
      </div>}
    </section>

    <section>
      <div className="sectionHead"><div><h2>Connected Meta WhatsApp profiles</h2><p>Connections remain saved until you explicitly disconnect them.</p></div></div>
      <div className="connectionGrid whatsappConnectionGrid">
        {meta.map(x=><article className={'connectionCard '+(x.isDefault?'defaultConnection':'')} key={x.id}>
          <div className="cardTop"><div><small>{x.connectMethod==='embedded'?'FACEBOOK EMBEDDED SIGNUP':'META CLOUD API'}</small><h3>{x.name}</h3></div><div className="connectionBadges">{x.isDefault&&<em className="status completed">Default sender</em>}<em className={'status '+(x.connectionStatus==='error'?'failed':x.connectionStatus==='disabled'?'cancelled':'completed')}>{x.connectionStatus==='error'?'Needs attention':x.connectionStatus||'connected'}</em></div></div>
          <div className="connectionPhone">{x.displayPhoneNumber||'Phone Number ID: '+x.phoneNumberId}</div>
          <div className="connectionMeta">
            <span>{x.connectMethod==='embedded'?'Connected via Facebook':'Manual connection'}</span>
            <span>{x.enabled?'Enabled':'Disabled'}</span>
          </div>
          <div className="connectionDetails">
            <span><small>WhatsApp Business Account</small><b>{x.businessAccountId||'Not added'}</b></span>
            <span><small>OTP template</small><b>{x.otpTemplateName||'Not configured'}</b></span>
            <span><small>Access token</small><b>{x.hasAccessToken?'Encrypted & stored':'Missing'}</b></span>
          </div>
          {x.lastError&&<Notice type="bad">{x.lastError} — profile remains saved until you disconnect it.</Notice>}
          <footer><span>{x.connectedAt?'Connected '+fmt(x.connectedAt):'Messaging connection'}</span><div className="rowActions">
            <button onClick={()=>act(x,'test')}>Test</button>
            <button onClick={()=>{localStorage.setItem('wa:template-profile',x.id);go('templates')}}>Templates</button>
            <button onClick={()=>{setEditing(x);setShowForm(true)}}>Edit</button>
            {!x.isDefault&&<button onClick={()=>act(x,'default')}>Make default</button>}
            <button className="danger" onClick={()=>act(x,'delete')}>Disconnect</button>
          </div></footer>
        </article>)}
        {!meta.length&&<Empty text="No Meta WhatsApp profiles connected yet."/>}
      </div>
    </section>

    <div className="accountGrid metaSetupGrid">
      <section>
        <h2>Meta webhook setup</h2>
        <p>Embedded Signup automatically subscribes each selected WABA to your app. Keep this callback configured in your Meta app.</p>
        <label className="copyLabel">Callback URL<code>{webhook}</code></label>
        <label className="copyLabel">Verify token<code>{verifyToken||'Available after a provider is initialized'}</code></label>
        <div className="rowActions"><button onClick={()=>navigator.clipboard?.writeText(webhook)}>Copy callback URL</button>{verifyToken&&<button onClick={()=>navigator.clipboard?.writeText(verifyToken)}>Copy verify token</button>}</div>
      </section>
      <section>
        <h2>Facebook Embedded Signup requirements</h2>
        <div className="setupChecklist">
          <span>1 <b>Meta App + Facebook Login for Business</b><small>Embedded Signup configuration ID</small></span>
          <span>2 <b>Advanced Meta permissions</b><small>business_management and whatsapp_business_management</small></span>
          <span>3 <b>App Review / Access Verification</b><small>Required before public customer onboarding</small></span>
          <span>4 <b>HTTPS + Webhooks</b><small>Your current Render deployment already uses HTTPS</small></span>
        </div>
      </section>
    </div>

    {!!demo.length&&<section className="demoProviderInfo"><h2>Demo provider</h2><p>The built-in demo provider remains available for testing without sending real WhatsApp messages.</p></section>}
    <div className="pageBottomActions"><button onClick={()=>go('profile')}>← Back to Profile</button><button onClick={()=>go('subscription')}>View subscription limits</button></div>
  </div>
}

function Subscription({onSessionUpdate}){
  const[data,setData]=useState(()=>getCached('/subscription')||null);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  async function load(){
    setErr('');
    try{
      const x=await api('/subscription');
      setData(x);
      const fresh=await api('/auth/me');
      onSessionUpdate(fresh);
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);
  async function requestPlan(plan){
    setErr('');setMsg('');
    try{
      await api('/subscription/request',{method:'POST',body:JSON.stringify({planId:plan._id})});
      setMsg('Subscription request sent to Super Admin.');
      await load();
    }catch(e){setErr(e.message)}
  }
  async function cancelRequest(){
    try{await api('/subscription/request/cancel',{method:'POST'});setMsg('Pending subscription request cancelled.');await load()}catch(e){setErr(e.message)}
  }
  if(!data)return <div className="page">{err?<Notice type="bad">{err}</Notice>:<Loading/>}</div>;
  const access=data.access||{};
  return <div className="page">
    <Title title="Subscription" sub="Your 7-day trial, subscription status and WA SANTA plans."/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <section className={'subscriptionHero '+(access.allowed?'accessOn':'accessOff')}>
      <div>
        <small>{access.state==='trialing'?'FREE TRIAL':access.state==='active'?'SUBSCRIPTION ACTIVE':'ACCESS LOCKED'}</small>
        <h2>{access.state==='trialing'?(access.daysRemaining+' day(s) remaining'):access.state==='active'?'WA SANTA is active':'Your trial or subscription has ended'}</h2>
        <p>{access.state==='trialing'?'All subscribed workspace features remain available until '+fmt(access.endsAt)+'.':access.state==='active'?'Current access continues until '+fmt(access.endsAt)+'.':'Choose a plan below and submit a subscription request. Super Admin must approve it before access is restored.'}</p>
      </div>
      <button onClick={load}>Refresh status</button>
    </section>

    {data.pendingRequest&&<section className="pendingRequest">
      <div><small>PENDING APPROVAL</small><h2>{data.pendingRequest.planId?.name||'Subscription request'}</h2><p>Requested {fmt(data.pendingRequest.createdAt)}. WA SANTA Super Admin must approve this request.</p></div>
      <button className="danger" onClick={cancelRequest}>Cancel request</button>
    </section>}

    <div className="sectionHead planHeading"><div><h2>Available plans</h2><p>Plans, prices and limits are controlled by WA SANTA Super Admin.</p></div></div>
    <div className="pricingGrid">
      {data.plans.map(plan=><article className="priceCard" key={plan._id}>
        <small>{plan.currency}</small>
        <h3>{plan.name}</h3>
        <div className="priceValue">{plan.currency==='INR'?'₹':plan.currency+' '}{Number(plan.priceMonthly).toLocaleString()}<span>/month</span></div>
        <p>{plan.description||'WA SANTA subscription plan'}</p>
        <div className="planLimits">
          <span><b>{plan.metaConnections}</b> Meta WhatsApp connection(s)</span>
          <span><b>{plan.teamMembers}</b> team member(s)</span>
          <span><b>{Number(plan.monthlyMessages).toLocaleString()}</b> messages / month</span>
        </div>
        {!!plan.features?.length&&<ul>{plan.features.map((x,i)=><li key={i}>✓ {x}</li>)}</ul>}
        <button className="primary" disabled={!!data.pendingRequest} onClick={()=>requestPlan(plan)}>{data.workspace.subscriptionPlanId===plan._id&&data.access.state==='active'?'Current plan':'Request subscription'}</button>
      </article>)}
      {!data.plans.length&&<section className="noPlans"><h2>Plans are being configured</h2><p>Super Admin has not published a subscription plan yet.</p></section>}
    </div>
  </div>
}

function SuperAdmin(){
  const[data,setData]=useState(()=>getCached('/admin/overview')||null);
  const[metaSettings,setMetaSettings]=useState(()=>getCached('/admin/meta-settings')||null);
  const[editing,setEditing]=useState(null);
  const[showPlan,setShowPlan]=useState(false);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const[workspacePlans,setWorkspacePlans]=useState({});
  async function load(){
    setErr('');
    try{
      const [overview,meta]=await Promise.all([api('/admin/overview'),api('/admin/meta-settings')]);
      setData(overview);setMetaSettings(meta);
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);
  async function saveMetaSettings(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    try{
      const x=await api('/admin/meta-settings',{method:'PUT',body:JSON.stringify(o)});
      setMetaSettings(x);
      e.currentTarget.elements.appSecret.value='';
      setMsg('Meta Embedded Signup settings saved securely.');
    }catch(e){setErr(e.message)}
  }
  async function testMetaSettings(){
    setErr('');setMsg('');
    try{
      const x=await api('/admin/meta-settings/test',{method:'POST'});
      setMsg(x.message||'Meta App credentials are valid.');
    }catch(e){setErr(e.message)}
  }
  async function clearMetaSecret(){
    if(!confirm('Clear the saved Meta App Secret? Continue with Facebook will stop working until a new secret is saved.'))return;
    try{
      const x=await api('/admin/meta-settings/clear-secret',{method:'POST'});
      setMetaSettings(x);setMsg('Saved Meta App Secret cleared.');
    }catch(e){setErr(e.message)}
  }

  async function savePlan(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    o.active=fd.get('active')==='on';
    o.features=String(o.features||'').split('\n').map(x=>x.trim()).filter(Boolean);
    try{
      if(editing)await api('/admin/plans/'+editing._id,{method:'PUT',body:JSON.stringify(o)});
      else await api('/admin/plans',{method:'POST',body:JSON.stringify(o)});
      setShowPlan(false);setEditing(null);setMsg(editing?'Plan updated.':'Plan created.');await load();
    }catch(e){setErr(e.message)}
  }
  async function deletePlan(plan){
    if(!confirm('Delete plan "'+plan.name+'"?'))return;
    try{await api('/admin/plans/'+plan._id,{method:'DELETE'});setMsg('Plan deleted.');await load()}catch(e){setErr(e.message)}
  }
  async function requestAction(req,type){
    try{
      if(type==='approve'){
        const months=Number(prompt('Subscription duration in months','1')||1);
        await api('/admin/requests/'+req._id+'/approve',{method:'POST',body:JSON.stringify({months})});
        setMsg('Subscription approved and activated.');
      }else{
        const adminNote=prompt('Reason for rejection (optional)','')||'';
        await api('/admin/requests/'+req._id+'/reject',{method:'POST',body:JSON.stringify({adminNote})});
        setMsg('Subscription request rejected.');
      }
      await load();
    }catch(e){setErr(e.message)}
  }
  async function setWorkspace(w,status){
    try{
      const body={subscriptionStatus:status};
      if(status==='active'){
        const planId=workspacePlans[w._id]||data.plans.find(x=>x.active)?._id;
        if(!planId)return setErr('Create an active plan first.');
        body.planId=planId;body.months=1;
      }
      await api('/admin/workspaces/'+w._id+'/subscription',{method:'PUT',body:JSON.stringify(body)});
      setMsg('Workspace subscription updated.');await load();
    }catch(e){setErr(e.message)}
  }
  if(!data)return <div className="page">{err?<Notice type="bad">{err}</Notice>:<Loading/>}</div>;
  return <div className="page">
    <Title title="Super Admin" sub="Control WA SANTA plans, pricing, tenant trials and subscriptions." action="Create plan" onAction={()=>{setEditing(null);setShowPlan(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>

    <div className="metrics">
      <Metric label="Plans" value={data.plans.length} sub={data.plans.filter(x=>x.active).length+' active'}/>
      <Metric label="Workspaces" value={data.workspaces.length} sub="Registered tenants"/>
      <Metric label="Pending requests" value={data.pendingRequests.length} sub="Need approval"/>
      <Metric label="Expired / locked" value={data.workspaces.filter(x=>!x.access?.allowed).length} sub="Subscription required"/>
    </div>

    <section className="adminMetaSettings">
      <div className="sectionHead">
        <div>
          <small>META PLATFORM</small>
          <h2>Meta Embedded Signup Settings</h2>
          <p>Configure the global Facebook/Meta app used by every tenant's “Continue with Facebook” WhatsApp onboarding flow.</p>
        </div>
        <em className={'status '+(metaSettings?.enabled?'completed':'failed')}>{metaSettings?.enabled?'Ready':'Setup required'}</em>
      </div>
      <form className="formGrid" onSubmit={saveMetaSettings}>
        <label>Meta App ID<input name="appId" defaultValue={metaSettings?.appId||''} placeholder="123456789012345" required/></label>
        <label>Embedded Signup Config ID<input name="configId" defaultValue={metaSettings?.configId||''} placeholder="Facebook Login for Business config ID" required/></label>
        <label>Graph API version<input name="graphVersion" defaultValue={metaSettings?.graphVersion||'v23.0'} placeholder="v23.0" required/></label>
        <label>Meta App Secret<input type="password" name="appSecret" placeholder={metaSettings?.hasAppSecret?'Saved securely — leave blank to keep current secret':'Paste Meta App Secret'} required={!metaSettings?.hasAppSecret}/></label>
        <div className="metaSecretState full">
          <span><b>App Secret</b><small>{metaSettings?.hasAppSecret?'Encrypted and stored securely':'Not configured'}</small></span>
          <span><b>Config source</b><small>{metaSettings?.source==='admin'?'Managed in Super Admin':'Render environment fallback'}</small></span>
          <span><b>Missing</b><small>{metaSettings?.missing?.length?metaSettings.missing.join(', '):'None — Facebook connection is ready'}</small></span>
        </div>
        <div className="actions full">
          {metaSettings?.hasAppSecret&&<button type="button" className="danger" onClick={clearMetaSecret}>Clear secret</button>}
          <button type="button" onClick={testMetaSettings}>Test Meta credentials</button>
          <button className="primary">Save Meta settings</button>
        </div>
      </form>
      <div className="adminMetaHelp">
        <span><b>Where to get these values</b><small>Meta for Developers → your app → App settings / Facebook Login for Business → Embedded Signup configuration.</small></span>
        <span><b>Security</b><small>The App Secret is encrypted before being stored and is never returned to the browser after save.</small></span>
      </div>
    </section>

    {showPlan&&<div className="panel"><form key={editing?editing._id:'new-plan'} className="formGrid" onSubmit={savePlan}>
      <label>Plan name<input name="name" defaultValue={editing?.name||''} required/></label>
      <label>Slug<input name="slug" defaultValue={editing?.slug||''} placeholder="starter" required/></label>
      <label>Monthly price<input type="number" min="0" step="0.01" name="priceMonthly" defaultValue={editing?.priceMonthly??''} required/></label>
      <label>Currency<input name="currency" defaultValue={editing?.currency||'INR'} required/></label>
      <label>Meta WhatsApp connections<input type="number" min="0" name="metaConnections" defaultValue={editing?.metaConnections??1} required/></label>
      <label>Team members<input type="number" min="1" name="teamMembers" defaultValue={editing?.teamMembers??3} required/></label>
      <label>Monthly message limit<input type="number" min="0" name="monthlyMessages" defaultValue={editing?.monthlyMessages??1000} required/></label>
      <label>Sort order<input type="number" name="sortOrder" defaultValue={editing?.sortOrder??0}/></label>
      <label className="full">Description<textarea name="description" rows="2" defaultValue={editing?.description||''}/></label>
      <label className="full">Features — one per line<textarea name="features" rows="4" defaultValue={editing?.features?.join('\n')||''}/></label>
      <label className="check full"><input type="checkbox" name="active" defaultChecked={editing?.active??true}/> Publish this plan</label>
      <div className="actions full"><button type="button" onClick={()=>{setShowPlan(false);setEditing(null)}}>Cancel</button><button className="primary">{editing?'Update plan':'Create plan'}</button></div>
    </form></div>}

    <section>
      <div className="sectionHead"><div><h2>Subscription plans</h2><p>These are the only plans tenants can request.</p></div></div>
      <div className="adminPlanGrid">{data.plans.map(p=><article key={p._id}>
        <div className="cardTop"><div><small>{p.active?'PUBLISHED':'HIDDEN'}</small><h3>{p.name}</h3></div><em className={'status '+(p.active?'completed':'cancelled')}>{p.active?'active':'disabled'}</em></div>
        <div className="priceValue">{p.currency==='INR'?'₹':p.currency+' '}{Number(p.priceMonthly).toLocaleString()}<span>/month</span></div>
        <p>{p.metaConnections} WhatsApp · {p.teamMembers} team · {Number(p.monthlyMessages).toLocaleString()} messages</p>
        <footer><span>{p.slug}</span><div className="rowActions"><button onClick={()=>{setEditing(p);setShowPlan(true)}}>Edit</button><button className="danger" onClick={()=>deletePlan(p)}>Delete</button></div></footer>
      </article>)}</div>
    </section>

    <section>
      <div className="sectionHead"><div><h2>Pending subscription requests</h2><p>Approve to activate paid access; reject to keep the workspace locked/trial state.</p></div></div>
      <div className="table">
        <div className="tr adminRequest th"><span>Workspace</span><span>Owner</span><span>Plan</span><span>Price</span><span>Requested</span><span>Action</span></div>
        {data.pendingRequests.map(x=><div className="tr adminRequest" key={x._id}>
          <span><b>{x.workspaceId?.name||'Workspace'}</b><small>{x.workspaceId?.subscriptionStatus}</small></span>
          <span>{x.requestedBy?.email||'—'}</span>
          <span>{x.planId?.name||'—'}</span>
          <span>{x.planId?.currency==='INR'?'₹':''}{x.planId?.priceMonthly??'—'}</span>
          <span>{fmt(x.createdAt)}</span>
          <span className="inlineActions"><button className="primary" onClick={()=>requestAction(x,'approve')}>Approve</button><button className="danger" onClick={()=>requestAction(x,'reject')}>Reject</button></span>
        </div>)}{!data.pendingRequests.length&&<Empty text="No pending subscription requests."/>}
      </div>
    </section>

    <section>
      <div className="sectionHead"><div><h2>Tenant workspaces</h2><p>Manually restart a 7-day trial, activate a plan, or expire access.</p></div></div>
      <div className="table">
        <div className="tr adminWorkspace th"><span>Workspace</span><span>Owner</span><span>Access</span><span>Plan</span><span>Ends</span><span>Controls</span></div>
        {data.workspaces.map(w=><div className="tr adminWorkspace" key={w._id}>
          <span><b>{w.name}</b><small>{String(w._id)}</small></span>
          <span>{w.owner?.email||'—'}</span>
          <span><em className={'status '+(w.access?.allowed?'completed':'failed')}>{w.access?.state||w.subscriptionStatus}</em></span>
          <span>{w.plan||'trial'}</span>
          <span>{fmt(w.currentPeriodEnd||w.trialEndsAt)}</span>
          <span className="workspaceControls">
            <select value={workspacePlans[w._id]||''} onChange={e=>setWorkspacePlans({...workspacePlans,[w._id]:e.target.value})}><option value="">Choose plan</option>{data.plans.filter(p=>p.active).map(p=><option key={p._id} value={p._id}>{p.name}</option>)}</select>
            <button onClick={()=>setWorkspace(w,'active')}>Activate</button>
            <button onClick={()=>setWorkspace(w,'trialing')}>7-day trial</button>
            <button className="danger" onClick={()=>setWorkspace(w,'expired')}>Expire</button>
          </span>
        </div>)}
      </div>
    </section>
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
  if(id==='whatsapp-api')return <WhatsAppApi go={go}/>;
  if(id==='payments')return <Payments session={session} go={go}/>;
  if(id==='subscription')return <Subscription onSessionUpdate={onSessionUpdate}/>;
  if(id==='admin'&&session.user.isSuperAdmin)return <SuperAdmin/>;
  if(id==='profile')return <Profile session={session} go={go} onSessionUpdate={onSessionUpdate}/>;
  if(id==='edit-profile')return <EditProfile go={go} onSessionUpdate={onSessionUpdate}/>;
  return <Settings go={go}/>;
}

export default function App(){
  const[session,setSession]=useState(()=>getCached('/auth/me')??undefined);
  useEffect(()=>{
    api('/auth/me',{fresh:true}).then(x=>{setSession(x);warmWorkspace(!!x.user?.isSuperAdmin)}).catch(()=>setSession(null));
    const unauth=()=>setSession(null);
    window.addEventListener('wa:unauthorized',unauth);
    return()=>window.removeEventListener('wa:unauthorized',unauth);
  },[]);
  async function logout(){
    try{await api('/auth/logout',{method:'POST'})}catch{}
    setSession(null);
  }
  if(session===undefined)return <Loading/>;
  return session?<Shell session={session} onLogout={logout} onSessionUpdate={setSession}/>:<Auth onAuth={x=>{setSession(x);warmWorkspace(!!x.user?.isSuperAdmin)}}/>;
}