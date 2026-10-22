import React,{useEffect,useMemo,useRef,useState}from'react';
import{api,BASE,getCached}from'./api.js';
import CampaignComposer,{blankCampaignDraft,existingCampaignDraft} from './CampaignComposer.jsx';
import DropFileInput from './DropFileInput.jsx';
import './premium.css';
import {LazyAICopilot,LazySendMessage,LazyBulkWhatsApp,LazyMetaTemplateManager,LazyInbox,LazyFlowStudio,LazyPayments,prefetchPageModule} from './lazyPages.js';
import {allowedWorkspacePage,resolveWorkspacePage,workspacePageHash} from './workspaceRouting.js';
import {existingFacebookAccessToken,shouldReuseFacebookSession,facebookDiscoveryLoginOptions} from './facebookDiscoverySession.js';
import {BUSINESS_TYPES,BUSINESS_GOALS,BRAND_TONES,LANGUAGES} from './business.js';

const nav=[
  ['overview','Overview','⌂'],
  ['ai','AI Copilot','✦'],
  ['send','Send message','➤'],
  ['bulk','Bulk WhatsApp','◈'],
  ['campaigns','Campaigns','✦'],
  ['contacts','Contacts','◎'],
  ['schedule','Schedule','◷'],
  ['templates','Templates','▤'],
  ['reports','Delivery reports','▥'],
  ['inbox','Live chat','◉'],
  ['chatbot','Chatbot & Flows','◇'],
  ['whatsapp-api','Numbers','☏'],
  ['payments','WhatsApp Payments','₹'],
  ['subscription','Subscription','₹'],
  ['settings','Settings','⚙']
];

// Menu groups follow the familiar WhatsApp → Manager → Reports → Utility
// hierarchy without presenting unsupported endpoints as working modules.
const workspaceMenu=[
  {heading:'WORKSPACE',ids:['overview','ai']},
  {heading:'CAMPAIGNS',ids:['campaigns','schedule','send','contacts']},
  {heading:'WHATSAPP',ids:['bulk','inbox','chatbot'],manager:true},
  {heading:'REPORTS',ids:['reports','payments']},
  {heading:'UTILITY',ids:['settings','subscription']}
];

const fmt=d=>d?new Date(d).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'—';
const statusLabel=s=>String(s||'draft').replace('_',' ');

function Notice({children,type='ok'}){return children?<div className={'notice '+type}>{children}</div>:null}
function Loading(){return <div className="page instantSkeleton" aria-busy="true" aria-label="Opening workspace"><div className="instantSkeletonTitle"/><div className="instantSkeletonSub"/><div className="instantSkeletonMetrics">{Array.from({length:4},(_,i)=><div className="instantSkeletonCard" key={i}/>)}</div><div className="instantSkeletonWide"/></div>}
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
        <label>Business type<select name="businessType" required defaultValue=""><option value="">Choose business type</option>{BUSINESS_TYPES.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Primary business goal<select name="primaryGoal" required defaultValue=""><option value="">Choose primary goal</option>{BUSINESS_GOALS.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Business subtype<input name="businessSubtype" placeholder="e.g. Rental properties, Dental clinic"/></label>
        <label>Preferred language<select name="preferredLanguage" defaultValue="English">{LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Brand tone<select name="brandTone" defaultValue="Professional">{BRAND_TONES.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Country<input name="country" defaultValue="India"/></label>
        <label>Products / services<input name="productsServices" placeholder="What do you sell or provide?"/></label>
        <label>Target customers<input name="targetCustomers" placeholder="Who are your ideal customers?"/></label>
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
  const[page,setPage]=useState(()=>resolveWorkspacePage(window.location.hash,{allowed:access.allowed,isSuperAdmin:!!session.user.isSuperAdmin}));
  const[open,setOpen]=useState(false);
  const[profileOpen,setProfileOpen]=useState(false);
  const[managerExpanded,setManagerExpanded]=useState(()=>window.localStorage.getItem('wa:manager-expanded')!=='false');
  const[managerCounts,setManagerCounts]=useState({numbers:null,templates:null});
  useEffect(()=>{
    // Sidebar counters are secondary UI; defer their API calls until the
    // manager area is actually opened instead of blocking every login.
    if(!access.allowed||!(open||['whatsapp-api','templates'].includes(page)))return;
    let live=true;
    Promise.allSettled([api('/integrations/whatsapp-connections'),api('/templates')]).then(results=>{
      if(!live)return;
      setManagerCounts({
        numbers:results[0].status==='fulfilled'?(results[0].value.connections||[]).filter(x=>x.provider==='meta').length:null,
        templates:results[1].status==='fulfilled'?(results[1].value||[]).filter(x=>x.metaStatus==='APPROVED').length:null
      });
    });
    return()=>{live=false};
  },[access.allowed,open,page]);
  const menu=session.user.isSuperAdmin?[...nav,['admin','Super Admin','★']]:nav;
  const locked=id=>!access.allowed&&!['subscription','profile','edit-profile','admin'].includes(id);
  const changePage=id=>{
    const next=allowedWorkspacePage(id,{allowed:access.allowed,isSuperAdmin:!!session.user.isSuperAdmin});
    prefetchPageModule(next);
    setPage(next);
    if(window.location.hash!==workspacePageHash(next))window.location.hash=workspacePageHash(next);
    setOpen(false);setProfileOpen(false);
    window.scrollTo({top:0,left:0,behavior:'auto'});
  };
  useEffect(()=>{
    const syncFromBrowser=()=>{
      const next=resolveWorkspacePage(window.location.hash,{allowed:access.allowed,isSuperAdmin:!!session.user.isSuperAdmin});
      // Canonicalize unsupported/locked routes without another history entry.
      if(window.location.hash!==workspacePageHash(next))
        window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+workspacePageHash(next));
      setPage(next);
      if(['whatsapp-api','templates'].includes(next))setManagerExpanded(true);
    };
    window.addEventListener('hashchange',syncFromBrowser);
    window.addEventListener('popstate',syncFromBrowser);
    syncFromBrowser();
    return()=>{
      window.removeEventListener('hashchange',syncFromBrowser);
      window.removeEventListener('popstate',syncFromBrowser);
    };
  },[access.allowed,session.user.isSuperAdmin]);
  useEffect(()=>{
    window.localStorage.setItem('wa:manager-expanded',String(managerExpanded));
  },[managerExpanded]);
  useEffect(()=>{
    const close=e=>{if(!e.target.closest?.('.profileMenu'))setProfileOpen(false)};
    const subscribe=()=>changePage('subscription');
    document.addEventListener('pointerdown',close);
    window.addEventListener('wa:subscription-required',subscribe);
    return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('wa:subscription-required',subscribe)};
  },[access.allowed,session.user.isSuperAdmin]);
  const pageTitle=page==='profile'?'Profile':page==='edit-profile'?'Edit profile':menu.find(x=>x[0]===page)?.[1];
  return <div className="shell">
    {open&&<button type="button" className="sidebarScrim" aria-label="Close navigation menu" onClick={()=>setOpen(false)}/>}
    <aside id="workspace-sidebar" className={open?'open':''}>
      <div className="sideLogo"><span>WA</span> SANTA<small>WHATSAPP WORKSPACE</small></div>
      <div className="workspace">
        <div className="avatar">{session.workspace.name[0]?.toUpperCase()}</div>
        <div><b>{session.workspace.name}</b><small>{access.state==='trialing'?'trial · '+(access.daysRemaining||0)+' day(s) left':session.user.role+' workspace'}</small></div>
      </div>
      <nav className="sidebarGroups" aria-label="Main navigation">
        {workspaceMenu.map(group=><div className="sidebarGroup" key={group.heading}>
          <div className="sidebarGroupTitle">{group.heading}</div>
          {group.ids.map(id=>{
            const item=menu.find(x=>x[0]===id);
            if(!item)return null;
            const [,label,ic]=item;
            return <button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onPointerEnter={()=>prefetchPageModule(id)} onFocus={()=>prefetchPageModule(id)} onClick={()=>changePage(id)}>
              <i aria-hidden="true">{ic}</i><span>{id==='inbox'?'Live Chat (Inbox)':id==='chatbot'?'Chat Automation':id==='reports'?'Delivery Report':label}</span>
              {locked(id)&&<small className="navLock">• locked</small>}
            </button>;
          })}
          {group.manager&&<div className="sidebarManager">
            <button type="button" className={'sidebarManagerToggle '+(['whatsapp-api','templates'].includes(page)?'active':'')} aria-expanded={managerExpanded}
              onClick={()=>setManagerExpanded(x=>!x)}>
              <i aria-hidden="true">☏</i><span>WhatsApp Manager</span><b aria-hidden="true">{managerExpanded?'⌄':'›'}</b>
            </button>
            {managerExpanded&&<div className="sidebarSubmenu">
              {[['whatsapp-api','Numbers',managerCounts.numbers],['templates','Templates',managerCounts.templates]].map(([id,label,count])=>
                <button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onPointerEnter={()=>prefetchPageModule(id)} onFocus={()=>prefetchPageModule(id)} onClick={()=>changePage(id)}>
                  <span>{label}</span>{count!==null&&<b>{count}</b>}
                </button>)}
            </div>}
          </div>}
        </div>)}
        {session.user.isSuperAdmin&&<div className="sidebarGroup">
          <div className="sidebarGroupTitle">ADMINISTRATION</div>
          <button type="button" className={page==='admin'?'active':''} onClick={()=>changePage('admin')}><i>★</i><span>Super Admin</span></button>
        </div>}
      </nav>
    </aside>
    <main>
      <header>
        <button type="button" className="hamb" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls="workspace-sidebar" onClick={()=>setOpen(!open)}>☰</button>
        <div><small>WA SANTA</small><b>{pageTitle}</b></div>
        <div className="headRight">
          {access.state==='trialing'?<button className="trialPill" onClick={()=>changePage('subscription')}>Trial · {access.daysRemaining} day(s) left</button>:access.allowed?<span className="pill">● Subscribed</span>:<button className="expiredPill" onClick={()=>changePage('subscription')}>Subscription required</button>}
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
      <React.Suspense fallback={<Loading/>}><Page key={page} id={page} session={session} go={changePage} onSessionUpdate={onSessionUpdate}/></React.Suspense>
      <nav className="mobileAppbar" aria-label="Mobile app navigation">{[['overview','Home','⌂'],['bulk','Bulk WA','◈'],['campaigns','Campaigns','✦'],['inbox','Inbox','◉'],['contacts','Contacts','◎']].map(([id,label,icon])=><button key={id} type="button" aria-current={page===id?'page':undefined} className={page===id?'active':''} onPointerDown={()=>prefetchPageModule(id)} onClick={()=>changePage(id)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}</nav>
    </main>
  </div>
}

function AIOverview({go}){
  const[data,setData]=useState(null);
  const[status,setStatus]=useState(null);
  useEffect(()=>{
    let active=true;
    api('/ai/status').then(s=>{
      if(!active)return;
      setStatus(s);
      if(!s.enabled||!s.profileComplete)return;
      return api('/ai/recommendations').then(x=>{if(active)setData(x.recommendations)});
    }).catch(()=>{});
    return()=>{active=false};
  },[]);
  if(status&& !status.enabled)return null;
  if(!data?.recommendations?.length)return <section className="aiDashboardTeaser">
    <div className="sectionHead"><div><span className="eyebrow">WA SANTA AI</span><h2>AI recommendations</h2><p>{status?.profileComplete?'Preparing business-aware recommendations…':'Complete your AI business profile to unlock automatic campaign, message and template suggestions.'}</p></div><button onClick={()=>go('ai')}>Open AI Copilot</button></div>
  </section>;
  return <section className="aiDashboardTeaser">
    <div className="sectionHead"><div><span className="eyebrow">WA SANTA AI</span><h2>{data.headline||'Recommended for your business'}</h2><p>{data.summary}</p></div><button className="primary" onClick={()=>go('ai')}>Open AI Copilot</button></div>
    <div className="aiDashboardCards">{data.recommendations.slice(0,3).map((x,i)=><button key={i} onClick={()=>go('ai')}><span>{x.type}</span><b>{x.title}</b><small>{x.reason}</small></button>)}</div>
  </section>
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
    <AIOverview go={go}/>
    <section>
      <div className="sectionHead"><div><h2>Message activity</h2><p>Submitted, delivered and failed messages over the last 14 days.</p></div><button onClick={()=>go('reports')}>View report</button></div>
      <div className="chart">{d.activity.map((x,i)=><div className="barWrap" key={x.date}><div className="bars"><i style={{height:Math.max(4,x.submitted/max*100)+'%'}}></i><b style={{height:Math.max(4,x.delivered/max*100)+'%'}}></b><em style={{height:Math.max(0,(x.failed||0)/max*100)+'%'}}></em></div><small>{i%3===0?new Date(x.date).toLocaleDateString([],{month:'short',day:'numeric'}):''}</small></div>)}</div>
      <div className="legend"><span>Submitted</span><span>Delivered</span><span>Failed</span></div>
    </section>
    <section>
      <div className="eyebrow">QUICK ACTIONS</div><h2>Your next connection starts here.</h2>
      <div className="quick">
        <button onClick={()=>go('contacts')}><span>⇧</span><b>Import contacts</b><small>Excel or CSV with consent controls</small></button>
        <button onClick={()=>go('bulk')}><span>◈</span><b>Bulk WhatsApp</b><small>Approved templates, address book or CSV</small></button>
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
    o.sendMode=draft.sendMode||'freeform';
    o.templateId=o.sendMode==='template'?draft.templateId:null;
    o.templateParams=o.sendMode==='template'?draft.templateParams:[];
    o.contentType=o.sendMode==='template'?'text':draft.contentType;
    o.message=o.sendMode==='template'?'':draft.message;
    o.integrationId=draft.integrationId||null;
    o.carouselCards=o.sendMode==='freeform'&&draft.contentType==='carousel'?draft.carouselCards:[];
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
    try{
      const [rows,funnel]=await Promise.all([api('/campaigns/'+c._id+'/deliveries',{fresh:true}),api('/campaigns/'+c._id+'/funnel',{fresh:true})]);
      setDeliveries({campaign:c,rows,funnel});
    }catch(e){setErr(e.message)}
  }
  return <div className="page">
    <Title title="Campaigns" sub="Create, schedule, send, retry and audit WhatsApp campaigns with native text formatting and image carousels." action="New campaign" onAction={()=>{setEditing(null);setDraft(blankCampaignDraft());setShow(true)}}/>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    {show&&<div className="panel"><form key={editing?editing._id:'new'} className="formGrid" onSubmit={save}>
      <label htmlFor="campaign-name">Campaign name<input id="campaign-name" name="name" required defaultValue={editing?.name||''}/></label>
      <label htmlFor="campaign-audience">Audience<select id="campaign-audience" name="audienceType" defaultValue={editing?.audienceType||'all'}><option value="all">All opted-in contacts</option><option value="list">Contact list</option><option value="contacts">Specific contacts</option></select></label>
      <label>Contact list<select name="listId" defaultValue={editing?.listId?._id||editing?.listId||''}><option value="">Choose list</option>{lists.map(x=><option value={x._id} key={x._id}>{x.name} ({x.contactCount||0})</option>)}</select></label>

      <label className="full">Specific contacts<select name="contactIds" multiple size="5" defaultValue={editing?.contactIds?.map(String)||[]}>{contacts.filter(x=>x.consentStatus==='opted_in'&&!x.suppressed).map(x=><option value={x._id} key={x._id}>{x.name||'Unnamed'} · {x.phone}</option>)}</select></label>
      <CampaignComposer draft={draft} onChange={setDraft} templates={templates}/>
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
    <Title title="Contacts" sub="Download the Excel template, import E.164 WhatsApp contacts, and manage documented consent." action="Add contact" onAction={()=>{setEditing(null);setShow(true)}}/>
    <div className="notice">Excel import: up to 5 MB and 5,000 rows per file (WA SANTA batch cap). Meta's business-initiated template messaging limits depend on your business portfolio and are enforced by Meta; importing contacts does not increase that limit or bypass customer opt-in.</div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <div className="toolbar contactTools">
      <div className="toolbarGroup"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search contacts…"/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All contacts</option><option value="ready">Opted in</option><option value="pending">Pending consent</option><option value="suppressed">Suppressed / opted out</option></select><button onClick={addList}>+ New list</button></div>
      <button type="button" onClick={async()=>{
        try{
          const response=await fetch(BASE+'/contacts/template.xlsx',{credentials:'include'});
          if(!response.ok)throw new Error('Unable to download contact template');
          const blob=await response.blob(),url=URL.createObjectURL(blob);
          const a=document.createElement('a');a.href=url;a.download='WA-SANTA-Contacts-Template.xlsx';a.click();
          URL.revokeObjectURL(url);
        }catch(e){setErr(e.message)}
      }}>↓ Excel template</button>
      <form onSubmit={importFile}><select name="listId"><option value="">No list</option>{lists.map(x=><option value={x._id} key={x._id}>{x.name}</option>)}</select><DropFileInput name="file" accept=".xlsx,.xls,.csv" required description="Drop your Excel/CSV file here or choose a file"/><label className="check compact"><input type="checkbox" name="confirmConsent"/> Imported contacts have documented opt-in</label><button className="primary">Import</button></form>
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

function CampaignFunnel({detail,onChat}){
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const t=detail.funnel?.totals||{};
  const buckets=[['Audience',t.audience||0,'Selected contacts'],['Excluded',t.skipped||0,'Pre-send checks'],['Delivered',t.delivered||0,(t.deliveredPct||0)+'% of eligible'],['Non-delivered',t.failed||0,(t.failedPct||0)+'% of eligible'],['Pending',t.pending||0,'Awaiting receipt'],['Read',t.read||0,(t.readPct||0)+'% of delivered'],['Replied',t.replied||0,'Customer responses']];
  const rows=detail.rows.filter(x=>(filter==='all'||(filter==='pending'?['queued','submitted','sent'].includes(x.status):filter==='non-delivered'?x.status==='failed':filter==='delivered'?['delivered','read'].includes(x.status):x.status===filter))&&
    (!query||[x.recipientName,x.contactId?.name,x.phone,x.error,x.skipReason,x.errorCode].some(v=>String(v||'').toLowerCase().includes(query.toLowerCase()))));
  function exportCsv(){
    const csv=[['Name','Phone','Status','Reason','Error code','Provider message ID','Sent at','Delivered at','Read at'],...rows.map(x=>[
      x.recipientName||x.contactId?.name||'',x.phone,x.status,x.skipReason||x.error||'',x.errorCode||'',x.providerMessageId||'',
      x.sentAt||'',x.deliveredAt||'',x.readAt||''
    ])].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='campaign-deliveries-'+detail.campaign._id+'.csv';link.click();URL.revokeObjectURL(url);
  }
  return <section className="premiumFunnel">
    <div className="funnelHeading"><div><small>PERFORMANCE OVERVIEW</small><h3>Campaign delivery funnel</h3><p>Every selected contact is accounted for, with receipts and failure reasons.</p></div><span className="funnelMeta">{detail.funnel?.status||detail.campaign.status}</span></div>
    <div className="funnelCards">{buckets.map(([name,value,sub])=><article key={name}><small>{name}</small><strong>{Number(value).toLocaleString()}</strong><span>{sub}</span></article>)}</div>
    <div className="funnelSegment" aria-label="Exclusive audience buckets">{[['Excluded',t.skipped,'#94a3b8'],['Delivered',t.delivered,'#087b56'],['Non-delivered',t.failed,'#d86e69'],['Pending',t.pending,'#d9a441']].map(([name,value,color])=><span key={name} title={name+': '+(value||0)} style={{width:(t.audience?100*(value||0)/t.audience:0)+'%',background:color}} />)}</div>
    <div className="funnelTools"><select aria-label="Filter campaign recipients" value={filter} onChange={e=>setFilter(e.target.value)}>{[['all','All recipients'],['skipped','Excluded'],['pending','Pending'],['submitted','Dispatched'],['sent','Sent'],['delivered','Delivered'],['read','Read'],['non-delivered','Non-delivered']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><input aria-label="Search recipients" placeholder="Search name, phone or failure" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" onClick={exportCsv}>↓ Export CSV</button></div>
    <p className="funnelFine">{rows.length} matching recipients · Read receipts are included within Delivered (never double-counted).</p>
    <div className="funnelRecipientList">{rows.length?rows.map(x=><div key={x._id}><div><b>{x.recipientName||x.contactId?.name||x.phone}</b><small>{x.phone}</small></div><em className={'status '+(x.status==='failed'?'failed':x.status==='delivered'||x.status==='read'?'completed':'scheduled')}>{x.status}</em><small title={x.skipReason||x.error||''}>{x.skipReason||x.error||x.errorCode||'—'}</small>{onChat&&<button type="button" onClick={()=>onChat(x)}>Chat ↗</button>}</div>):<div className="empty">No recipients match this filter.</div>}</div>
    {!!detail.funnel?.failures?.length&&<div className="funnelReasons"><b>Failure & exclusion reasons</b>{detail.funnel.failures.map((x,i)=><span key={i}>{x.status} · {x.code||'UNKNOWN'} <strong>{x.count}</strong></span>)}</div>}
  </section>;
}

function DeliveryTable({rows,onChat}){
  return <div className="table">
    <div className="tr delivery th"><span>Recipient</span><span>Campaign</span><span>Status</span><span>Provider</span><span>Time</span><span>Error</span>{onChat&&<span>Chat</span>}</div>
    {rows.map(x=><div className="tr delivery" key={x._id}>
      <span><b>{x.contactId?.name||x.phone}</b><small>{x.phone}</small></span>
      <span>{x.campaignId?.name||'Personal message'}</span>
      <span><em className={'status '+(x.status==='failed'?'failed':x.status==='read'||x.status==='delivered'?'completed':'scheduled')}>{statusLabel(x.status)}</em></span>
      <span>{x.provider}</span><span>{fmt(x.sentAt||x.createdAt)}</span><span className="errorText">{x.error||'—'}{x.repliedAt?' · Customer replied':''}</span>{onChat&&<span><button type="button" onClick={()=>onChat(x)}>Open chat</button></span>}
    </div>)}{!rows.length&&<Empty text="No delivery records."/>}
  </div>
}

function Reports({go}){
  const[d,setD]=useState(()=>getCached('/dashboard')||null);
  const[rows,setRows]=useState(()=>getCached('/campaigns/deliveries?limit=250')||[]);
  const[filter,setFilter]=useState('all');
  const[campaigns,setCampaigns]=useState([]);
  const[opened,setOpened]=useState(null);
  const[err,setErr]=useState('');
  useEffect(()=>{Promise.all([api('/dashboard'),api('/campaigns/deliveries?limit=250'),api('/campaigns')])
    .then(([a,b,c])=>{setD(a);setRows(b);setCampaigns(c)}).catch(e=>setErr(e.message))},[]);
  async function openCampaign(c){
    setErr('');
    try{
      const [rows,funnel]=await Promise.all([api('/campaigns/'+c._id+'/deliveries',{fresh:true}),api('/campaigns/'+c._id+'/funnel',{fresh:true})]);
      setOpened({campaign:c,rows,funnel});
    }catch(e){setErr(e.message)}
  }
  function openChat(x){
    sessionStorage.setItem('wa:open-chat',String(x.phone||'').replace(/\D/g,''));
    go('inbox');
  }
  if(err)return <div className="page"><Notice type="bad">{err}</Notice></div>;
  if(!d)return <Loading/>;
  const filtered=filter==='all'?rows:rows.filter(x=>x.status===filter);
  return <div className="page">
    <Title title="Delivery reports" sub="Audit message delivery, reads and failures across personal and campaign sends."/>
    <div className="metrics"><Metric label="Submitted" value={d.metrics.submitted} sub="Accepted for delivery"/><Metric label="Delivered" value={d.metrics.delivered} sub={d.metrics.deliveryRate+'% delivery rate'}/><Metric label="Read" value={d.metrics.read} sub="Confirmed read receipts"/><Metric label="Failed" value={d.metrics.failed} sub="Last 14 days"/></div>
    <div className="toolbar"><div className="toolbarGroup"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option></select></div></div>
    <DeliveryTable rows={filtered}/>
    <div className="reportCampaigns">
      <h2>Campaign-wise reports</h2>
      <p>Select a campaign to inspect contact-wise deliveries, failures, and replies.</p>
      <CampaignTable rows={campaigns} onOpen={openCampaign}/>
    </div>
    {opened&&<div className="modalBack" onClick={()=>setOpened(null)}>
      <div className="modal reportModal" onClick={e=>e.stopPropagation()}>
        <div className="modalHead"><div><small>CAMPAIGN DELIVERY AUDIT</small><h2>{opened.campaign.name}</h2></div>
          <button onClick={()=>setOpened(null)}>×</button></div>
        <p>{opened.rows.length} contact-wise delivery records. Open chat for replies.</p>
        <DeliveryTable rows={opened.rows} onChat={openChat}/>
      </div>
    </div>}
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
        <DropFileInput accept="image/jpeg,image/png,image/webp" description="Drop a profile image here or choose a file" onFile={file=>chooseImage({target:{files:[file]}})}/>
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
  const[profileSummary,setProfileSummary]=useState(()=>getCached('/integrations/whatsapp-connections')?.metaProfiles||null);
  const[embedded,setEmbedded]=useState(()=>getCached('/integrations/embedded-signup/config')||null);
  const[showForm,setShowForm]=useState(false);
  const[manualTokenEntry,setManualTokenEntry]=useState(false);
  const[editing,setEditing]=useState(null);
  const[fbBusy,setFbBusy]=useState(false);
  const[fbSdkReady,setFbSdkReady]=useState(false);
  const[fbSdkFailure,setFbSdkFailure]=useState('');
  const[metaLoginHelpOpen,setMetaLoginHelpOpen]=useState(false);
  const[pendingActivation,setPendingActivation]=useState(null);
  const[activationSelected,setActivationSelected]=useState([]);
  const[activationBusy,setActivationBusy]=useState(false);
  const[activationResults,setActivationResults]=useState([]);

  const[connectionMode,setConnectionMode]=useState('new');
  const[metaAssets,setMetaAssets]=useState(null);
  const[assetBusy,setAssetBusy]=useState(false);
  const[fbSessionAvailable,setFbSessionAvailable]=useState(false);
  const[permissionRetryAvailable,setPermissionRetryAvailable]=useState(false);
  const fbAuthRef=useRef(null);
  const[chosenBusiness,setChosenBusiness]=useState('');
  const[chosenWaba,setChosenWaba]=useState('');
  const[chosenPhone,setChosenPhone]=useState('');
  const[businessAppPhone,setBusinessAppPhone]=useState('');
  const[accountDiscoveryError,setAccountDiscoveryError]=useState('');
  const[existingPrefill,setExistingPrefill]=useState(null);
  const coexistence=connectionMode==='business_app';
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const[numberSearch,setNumberSearch]=useState('');
  const[numberFilter,setNumberFilter]=useState('all');
  const[businessFilter,setBusinessFilter]=useState('all');
  const[showSetup,setShowSetup]=useState(false);
  const[syncing,setSyncing]=useState(false);


  async function load(){
    setErr('');
    try{
      const [x,embed]=await Promise.all([
        api('/integrations/whatsapp-connections',{fresh:true}),
        api('/integrations/embedded-signup/config')
      ]);
      setConnections(x.connections||[]);
      setSubscription(x.subscription||null);
      setProfileSummary(x.metaProfiles||null);
      setEmbedded(embed);
      const requestedEdit=sessionStorage.getItem('wa:edit-sender');
      if(requestedEdit){
        sessionStorage.removeItem('wa:edit-sender');
        const profile=(x.connections||[]).find(y=>y.id===requestedEdit&&y.provider==='meta');
        if(profile){
          setEditing(profile);setShowSetup(true);setShowForm(true);
          setConnectionMode('cloud_api');
          setTimeout(()=>document.getElementById('numbersSetup')?.scrollIntoView({behavior:'smooth',block:'start'}),120);
        }
      }
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{
    fbAuthRef.current=null;
    setFbSessionAvailable(false);
    if(!embedded?.enabled){setFbSdkReady(false);return}
    let active=true;
    // Preload the SDK AND discover whether this browser already has an
    // authenticated session for the configured Meta application. This is a
    // read-only status check, never an attempt to bypass Meta security.
    loadFacebookSdk(embedded.appId,embedded.graphVersion||'v23.0')
      .then(FB=>{
        if(!active)return;
        setFbSdkReady(true);
        setFbSdkFailure('');
        FB.getLoginStatus(response=>{
          if(!active)return;
          const token=existingFacebookAccessToken(response);
          fbAuthRef.current=token||null;
          setFbSessionAvailable(!!token);
        });
      })
      .catch(e=>{if(active){setFbSdkReady(false);setFbSdkFailure(e.message||'Facebook SDK unavailable')}});
    return()=>{active=false};
  },[embedded?.enabled,embedded?.appId,embedded?.graphVersion]);

  useEffect(()=>{
    load();
    // Recover a staged Meta signup after a browser refresh without ever
    // placing tokens into localStorage, query params or browser state.
    api('/meta-activation/pending',{fresh:true,cache:false}).then(data=>{
      if(!data.session)return;
      setPendingActivation(current=>current||data.session);
      setShowSetup(true);
      setConnectionMode(data.session.mode==='existing'?'cloud_api':
        data.session.mode==='coexistence'?'business_app':'new');
    }).catch(()=>{});
  },[]);
  const meta=connections.filter(x=>x.provider==='meta');
  const demo=connections.filter(x=>x.provider==='demo');
  const businessKey=x=>String(x.businessPortfolioId||'')+'|'+String(x.businessAccountId||'unassigned:'+x.id);
  const businessGroups=[...new Map(meta.map(x=>[businessKey(x),{
    key:businessKey(x),
    portfolioId:x.businessPortfolioId||'',
    wabaId:x.businessAccountId||'',
    count:meta.filter(z=>businessKey(z)===businessKey(x)).length
  }])).values()];
  const shown=meta.filter(x=>{
    const query=numberSearch.toLowerCase().trim();
    const matches=!query||[x.name,x.displayPhoneNumber,x.phoneNumberId,x.businessAccountId].some(v=>String(v||'').toLowerCase().includes(query));
    const health=x.enabled&&x.connectionStatus==='connected'&&x.planAllowed!==false;
    const matchedBusiness=businessFilter==='all'||businessKey(x)===businessFilter;
    return matches&&matchedBusiness&&(numberFilter==='all'||(numberFilter==='ready'&&health)||(numberFilter==='attention'&&!health)||(numberFilter==='default'&&x.isDefault));
  });

  const allowed=subscription?.access?.allowed!==false;
  const canAdd=allowed&&subscription&&subscription.used<subscription.max;
  const verifyToken=embedded?.webhookVerifyToken||connections.find(x=>x.webhookVerifyToken)?.webhookVerifyToken||'';
  const webhook=BASE.replace(/\/api$/,'')+'/api/webhooks/meta';

  function beginAnotherMetaProfile(){
    if(!canAdd)return;
    if(pendingActivation?.sessionId){
      api('/meta-activation/pending/'+pendingActivation.sessionId,{method:'DELETE'}).catch(()=>{});
    }
    setPendingActivation(null);
    setActivationSelected([]);
    setActivationResults([]);
    setEditing(null);
    setExistingPrefill(null);
    setManualTokenEntry(false);
    setShowForm(false);
    setConnectionMode('new');
    setMetaAssets(null);
    setChosenBusiness('');
    setChosenWaba('');
    setChosenPhone('');
    setErr('');
    setMsg('Connect a different Meta business portfolio, WABA or phone number. Existing profiles will be preserved.');
    setShowSetup(true);
    requestAnimationFrame(()=>document.getElementById('numbersSetup')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }

  // Meta requires the business owner to authorize portfolio enumeration.
  // This is a separate short-lived Facebook Login; it does NOT connect,
  // migrate or register any number. No user token is persisted.
  function discoverFacebookAssets({forceLogin=false,regrant=false}={}){
    if(assetBusy)return;
    setExistingPrefill(null);
    if(!embedded?.enabled){
      setAccountDiscoveryError('Facebook Login is not configured by Super Admin.');
      return;
    }
    // Facebook SDK is loaded on page mount so any login popup launches
    // synchronously in this user gesture, including on mobile Chrome.
    const FB=window.FB;
    if(!fbSdkReady||!FB){
      setAccountDiscoveryError('Facebook is still loading. Retry once the Connect button is ready.');
      return;
    }
    setAssetBusy(true);
    setAccountDiscoveryError('');
    setPermissionRetryAvailable(false);
    setMetaAssets(null);
    setChosenBusiness('');
    setChosenWaba('');
    setChosenPhone('');

    const fetchAssets=async token=>{
      try{
        const result=await api('/integrations/meta-portfolios/discover',{
          method:'POST',body:JSON.stringify({accessToken:token})
        });
        setMetaAssets(result);
        if(result.portfolios?.length)setChosenBusiness(result.portfolios[0].id);
      }catch(e){
        const detail=e.message||'Unable to list Meta portfolios.';
        setAccountDiscoveryError(detail);
        // Explicit opt-in re-request, never an automatic password/permission
        // loop. Reusing a valid Facebook session is still the default.
        setPermissionRetryAvailable(/permission|scope|not authorized|access denied|business_management|OAuth/i.test(detail));
        if(e.status===401||/expired|invalid.*token/i.test(detail)){
          fbAuthRef.current=null;
          setFbSessionAvailable(false);
        }
      }finally{setAssetBusy(false)}
    };

    if(shouldReuseFacebookSession(fbAuthRef.current,{forceLogin,regrant})){
      fetchAssets(fbAuthRef.current);
      return;
    }

    // Rerequest occurs only after the customer opts to review permissions.
    const opts=facebookDiscoveryLoginOptions({regrant});
    FB.login(response=>{
      const token=response?.authResponse?.accessToken;
      if(!token){
        setAssetBusy(false);
        setAccountDiscoveryError('Facebook did not authorize access to the business portfolios. You can retry with your current account or review permissions.');
        setPermissionRetryAvailable(true);
        return;
      }
      fbAuthRef.current=token;
      setFbSessionAvailable(true);
      fetchAssets(token);
    },opts);
  }

  const chosenPortfolio=metaAssets?.portfolios?.find(x=>x.id===chosenBusiness);
  const selectedWaba=chosenPortfolio?.wabas?.find(x=>x.id===chosenWaba);
  const availableNumbers=selectedWaba?.numbers||[];
  function useExistingApiPhone(waba,phone){
    // The user's choice is a Meta Phone Number ID, never an unverified
    // formatted phone number. An external provider is not disconnected.
    if(meta.some(p=>p.phoneNumberId===phone.id)){
      setErr('This number is already saved in the current workspace. Use its Edit / Reauthorize action instead.');
      return;
    }
    setChosenWaba(waba.id);
    setChosenPhone(phone.id);
    setExistingPrefill({businessAccountId:waba.id,phoneNumberId:phone.id,name:phone.verifiedName||waba.name});
    setConnectionMode('cloud_api');setShowForm(true);setErr('');
    setMsg('Selected '+(phone.displayPhoneNumber||phone.id)+'. Continue with Facebook to authorize this existing Cloud API number without deregistering it from any other provider. If Meta does not grant access, no connection will be created.');
    requestAnimationFrame(()=>document.getElementById('existingCloudConnectionForm')?.scrollIntoView({behavior:'smooth',block:'center'}));
  }

  async function connectWithFacebook({existing=false,browse=false}={}){
    if(fbBusy||(!canAdd&&!(existing&&editing)))return;
    // The primary one-click entry does NOT require a WABA/Phone Number ID.
    // Meta returns the authorized WABA, then the backend lists its phones.
    // The user must still confirm precisely which number(s) to activate.
    const requiresSpecificNumber=existing&&!browse;
    const senderForm=requiresSpecificNumber?document.getElementById('existingCloudConnectionForm'):null;
    if(requiresSpecificNumber&&!senderForm){
      setErr('Select an existing Meta Cloud API number or open its connection form before authorizing.');
      return;
    }
    const existingValues=senderForm?new FormData(senderForm):null;
    const expectedPhone=existing?String(existingValues?.get('phoneNumberId')||'').trim():'';
    const expectedWaba=existing?String(existingValues?.get('businessAccountId')||'').trim():'';
    if(requiresSpecificNumber&&(!/^[0-9]{5,30}$/.test(expectedPhone)||!/^[0-9]{5,30}$/.test(expectedWaba))){
      setErr('Enter the existing Meta Phone Number ID and WABA ID first. Facebook cannot look up an authorization token from the public phone number.');return;
    }
    if(!embedded?.enabled){
      setErr('Meta login is not configured by the Clever Connect Super Admin. Use an owner-authorized system-user token in the manual form.');
      return;
    }
    if(!fbSdkReady){
      setErr(fbSdkFailure||'Facebook Login is still loading. Check that popups and cookies are permitted, then try again.');
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
        const portfolioFromMeta=String(session.business_id||session.businessId||'');
        if(coexistence&&chosenBusiness&&portfolioFromMeta&&portfolioFromMeta!==chosenBusiness){
          throw new Error('Meta authorized a different business portfolio from the one you selected. Restart onboarding and choose the same portfolio in Facebook.');
        }
        const eventName=String(session.event||'').toUpperCase();
        if(requiresSpecificNumber&&String(session.waba_id)!==expectedWaba)
          throw new Error('Meta returned a different WABA from the one you selected. No credential was saved.');
        if(requiresSpecificNumber&&session.phone_number_id&&String(session.phone_number_id)!==expectedPhone)
          throw new Error('Meta returned a different WhatsApp number. No credential was saved.');
        const refreshExisting=requiresSpecificNumber&&!!editing;
        const y=await api(refreshExisting?'/integrations/embedded-signup/link-existing':'/meta-activation/prepare',{
          method:'POST',
          body:JSON.stringify({
            code:authCode,
            wabaId:session.waba_id,
            phoneNumberId:existing?expectedPhone:session.phone_number_id||'',
            businessPortfolioId:session.business_id||session.businessId||'',
            metaReportedPhoneNumberId:session.phone_number_id||'',
            ...(refreshExisting?{profileId:editing.id}:
              {existingCloud:existing,coexistence:eventName.includes('WHATSAPP_BUSINESS_APP_ONBOARDING'),
                ...(requiresSpecificNumber?{expectedBusinessAccountId:expectedWaba,expectedPhoneNumberId:expectedPhone}:{})})
          })
        });
        if(!refreshExisting){
          setPendingActivation(y);
          // Show the exact chosen phone pre-selected, but NEVER activate it
          // without the user's explicit "Activate selected numbers" action.
          const suggested=requiresSpecificNumber?expectedPhone:String(session.phone_number_id||'');
          setActivationSelected(y.numbers?.some(n=>n.id===suggested&&n.availability==='available')?[suggested]:[]);
          setActivationResults([]);
          setShowSetup(true);
          setMsg('Meta account authorized. Review the specific WhatsApp number(s) you wish to activate. Nothing is enabled until you click Activate selected numbers.');
          requestAnimationFrame(()=>document.getElementById('metaActivationPicker')?.scrollIntoView({behavior:'smooth',block:'start'}));
        }else{
          setMsg(y.warning||y.message||'Meta WhatsApp reauthorized.');
          setEditing(null);setShowForm(false);setShowSetup(false);
          await load();
        }
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
        const explanation=String(data.data?.error_message||data.data?.error||'Meta Embedded Signup reported an error.').slice(0,300);
        api('/integrations/embedded-signup/diagnostic',{
          method:'POST',body:JSON.stringify({event:name,status:'error',detail:explanation})
        }).catch(()=>{});
        cleanup();setFbBusy(false);setErr(explanation);
        setMetaLoginHelpOpen(true);
        return;
      }
      if(['FINISH','FINISH_ONLY_WABA','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(name)){
        session={...(data.data||{}),event:name};
        complete();
      }
    };

    window.addEventListener('message',listener);
    timer=setTimeout(()=>{
      if(!finished){cleanup();setFbBusy(false);setErr('Meta login did not finish. If Meta displayed “Feature unavailable”, review the app’s Required Actions, Data Use Checkup and App Review status before retrying.');setMetaLoginHelpOpen(true)}
    },120000);

    try{
      const FB=await loadFacebookSdk(embedded.appId,embedded.graphVersion||'v23.0');
      const extras={setup:{}};
      if(coexistence&&!existing)extras.featureType='whatsapp_business_app_onboarding';
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
              setErr('Facebook authorization did not complete. If the Meta popup says “Feature unavailable”, the developer app may have outstanding Required Actions, Data Use Checkup or App Review restrictions. See the Meta app checklist below. Meta status: '+status+'.');
              setMetaLoginHelpOpen(true);
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

  async function dismissActivation(){
    const id=pendingActivation?.sessionId;
    setPendingActivation(null);setActivationSelected([]);setActivationResults([]);
    if(id)try{
      await api('/meta-activation/pending/'+id,{method:'DELETE'});
    }catch(e){setErr('Could not dismiss the expired Meta authorization: '+e.message)}
  }

  async function activateSelectedNumbers(){
    if(!pendingActivation?.sessionId||!activationSelected.length||activationBusy)return;
    setActivationBusy(true);setErr('');setMsg('');
    try{
      const result=await api('/meta-activation/activate',{
        method:'POST',
        body:JSON.stringify({
          sessionId:pendingActivation.sessionId,phoneNumberIds:activationSelected
        })
      });
      setActivationResults(result.results||[]);
      const attempted=new Set((result.results||[]).filter(x=>x.connection).map(x=>x.phoneNumberId));
      setPendingActivation(previous=>previous?{
        ...previous,remainingSlots:result.remainingSlots,
        numbers:previous.numbers.map(p=>attempted.has(p.id)?{...p,availability:'already_connected'}:p)
      }:previous);
      setActivationSelected([]);
      setMsg([result.message||'Selected WhatsApp numbers processed.',result.routingNotice].filter(Boolean).join(' '));
      await load();
    }catch(e){setErr(e.message||'Unable to activate selected numbers')}
    finally{setActivationBusy(false)}
  }

  const activationAvailable=(pendingActivation?.numbers||[]).filter(p=>p.availability==='available');
  function toggleActivationPhone(id){
    setActivationSelected(old=>old.includes(id)?old.filter(x=>x!==id):
      old.length>=(pendingActivation?.remainingSlots||0)?old:[...old,id]);
  }

  async function save(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    if(!editing&&connectionMode==='cloud_api')o.connectionIntent='existing_cloud_api';
    try{
      if(editing){
        await api('/integrations/whatsapp-connections/'+editing.id,{method:'PUT',body:JSON.stringify(o)});
        setMsg('Meta WhatsApp connection updated.');
      }else{
        const y=await api('/integrations/whatsapp-connections',{method:'POST',body:JSON.stringify(o)});
        setMsg(y.warning||'Meta WhatsApp connection added and verified.');
      }
      setShowForm(false);setEditing(null);setManualTokenEntry(false);await load();
    }catch(e){setErr(e.message)}
  }

  async function act(x,type){
    setErr('');setMsg('');
    try{
      if(type==='test'){
        const y=await api('/integrations/whatsapp-connections/'+x.id+'/test',{method:'POST'});
        setMsg('Connection successful: '+(y.verifiedName||y.displayPhoneNumber||x.name));
      }
      if(type==='webhook'){
        const result=await api('/integrations/whatsapp-connections/'+x.id+'/webhook/sync',{method:'POST'});
        setMsg(result.message||'Meta WABA webhook subscription updated.');
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

  async function syncDetails(){
    if(syncing||!allowed||!meta.length)return;
    setSyncing(true);setErr('');setMsg('');
    let succeeded=0,failed=0;
    for(const x of meta.filter(x=>x.enabled)){
      try{await api('/integrations/whatsapp-connections/'+x.id+'/test',{method:'POST'});succeeded++}
      catch{failed++}
    }
    try{await load()}catch(e){setErr(e.message)}
    setMsg(succeeded+' account(s) synchronized with Meta'+(failed?', '+failed+' need attention.':'.'));
    setSyncing(false);
  }

  return <div className="page">
    <div className="title numbersHeading"><div><span>WHATSAPP MANAGER</span><h1>Meta Profiles & Numbers</h1><p>Connect and manage multiple authorized Meta businesses and WhatsApp senders independently within your subscription.</p></div><div className="numbersTopStat"><strong>{meta.length}</strong><span>saved phone profiles</span></div></div>
    <section className="metaMultiSummary" aria-label="Connected Meta profiles overview">
      <div><strong>{profileSummary?.total??meta.length}</strong><span>Saved senders</span></div>
      <div><strong>{profileSummary?.businessAccounts??businessGroups.length}</strong><span>WhatsApp Business Accounts</span></div>
      <div><strong>{profileSummary?.businessPortfolios??new Set(meta.map(x=>x.businessPortfolioId).filter(Boolean)).size}</strong><span>Meta portfolios</span></div>
      <div><strong>{profileSummary?.ready??meta.filter(x=>x.enabled&&x.connectionStatus==='connected'&&x.planAllowed!==false).length}</strong><span>Ready senders</span></div>
    </section>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>


    <section className="whatsappApiHero">
      <div><small>SUBSCRIPTION LIMIT</small><h2>{subscription?.used||0} of {subscription?.max||0} Meta connections used</h2><p>{subscription?.plan||'trial'} plan · {subscription?.access?.state||'loading'} access</p></div>
      <div className="apiUsageMeter"><i style={{width:Math.min(100,((subscription?.used||0)/Math.max(1,subscription?.max||1))*100)+'%'}}></i></div>
      {!allowed&&<Notice type="bad">Meta WhatsApp API management is locked until your subscription or trial is active.</Notice>}
      {allowed&&subscription?.used>=subscription?.max&&<Notice type="bad">You have reached your plan limit. Upgrade your subscription to connect another WhatsApp number.</Notice>}
    </section>


    <section className="metaWebhookHelp" aria-label="Meta webhook configuration">
      <div className="metaWebhookTitle">
        <div><small>STEP 1 · META DEVELOPER CONFIGURATION</small><h2>WhatsApp webhook verification</h2><p>Configure this in Meta for Developers → WhatsApp → Configuration → Webhook. Meta verifies the URL and token before your first phone number is connected.</p></div>
        <span className="metaWebhookReady">{verifyToken?'● Token ready':'◷ Loading'}</span>
      </div>
      <div className="metaWebhookFields">
        <div><span>Callback URL</span><code>{webhook}</code><button type="button" onClick={()=>navigator.clipboard?.writeText(webhook)}>Copy URL</button></div>
        <div><span>Exact Verify Token</span><code>{verifyToken||'Loading server verification token…'}</code><button type="button" disabled={!verifyToken} onClick={()=>navigator.clipboard?.writeText(verifyToken)}>Copy token</button></div>
      </div>
      <p className="metaWebhookInstruction">Use <strong>Copy token</strong> and paste it into Meta. Do not invent a token or use your App Secret, access token, or token from another application. Keep the backend awake during verification; a Free Render service may take a minute to wake up.</p>
    </section>

    <section className="numberManagerPanel" aria-label="WhatsApp numbers">
      <div className="numberControlBar">
        <label className="numberSearch"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search by business name or phone number" aria-label="Search WhatsApp numbers" value={numberSearch} onChange={e=>setNumberSearch(e.target.value)}/></label>
        <label className="numberFilterSelect"><span>Filter</span><select aria-label="Filter WhatsApp numbers" value={numberFilter} onChange={e=>setNumberFilter(e.target.value)}>
          <option value="all">All numbers</option><option value="ready">Ready to send</option><option value="attention">Needs attention</option><option value="default">Default sender</option>
        </select></label>
      </div>
      <div className="numbersActionStack">
        <button type="button" className="numbersSync" disabled={syncing||!allowed||!meta.length} onClick={syncDetails}>{syncing?'↻ Synchronizing numbers…':'↻  Sync Details'}</button>
        <button type="button" className="numbersAdd" disabled={!canAdd||fbBusy||!embedded?.enabled||!fbSdkReady}
          onClick={()=>connectWithFacebook({existing:true,browse:true})}>
          {fbBusy?'Connecting to Meta…':'ⓕ One-click Connect with Facebook'}
        </button>
        <button type="button" className="metaMultiSecondary" disabled={!canAdd} onClick={beginAnotherMetaProfile}>+ More connection options</button>
        {showSetup&&<button type="button" className="metaMultiSecondary" onClick={()=>setShowSetup(false)}>Close setup</button>}
        {!canAdd&&<small>{!allowed?'Subscription inactive — activate a plan to connect numbers.':'Your plan connection limit has been reached.'}</small>}
      </div>
      {showSetup&&<div className="numbersSetup" id="numbersSetup">
        <div className="numbersSetupIntro"><b>Connect a WhatsApp Business number</b><span>Choose the correct path. New numbers, WhatsApp Business App numbers, and existing Cloud API numbers use different Meta procedures.</span></div>
        {pendingActivation&&<section className="metaActivationPanel" id="metaActivationPicker" aria-label="Activate WhatsApp numbers">
          <div className="metaActivationHeading">
            <div><small>✓ META AUTHORIZATION SUCCESSFUL</small>
              <h2>Choose numbers to activate</h2>
              <p>Meta authorized WABA {pendingActivation.wabaId||'—'} and returned {pendingActivation.numbers.length} WhatsApp number(s).
                Select which numbers to activate. Saved profiles are preserved if Meta later rejects or revokes a token.</p>
            </div>
            <span>{pendingActivation.remainingSlots} subscription slot(s) available</span>
          </div>
          <div className="metaActivationNumbers">
            {pendingActivation.numbers.map(n=><label key={n.id} className={'metaActivationChoice '+(n.availability!=='available'?'unavailable':'')}>
              <input type="checkbox" checked={activationSelected.includes(n.id)}
                disabled={activationBusy||n.availability!=='available'||(!activationSelected.includes(n.id)&&activationSelected.length>=pendingActivation.remainingSlots)}
                onChange={()=>toggleActivationPhone(n.id)}/>
              <span className="metaActivationPhoneInfo"><b>{n.displayPhoneNumber||'Meta Phone ID '+n.id}</b>
                <small>{n.verifiedName||'WhatsApp Business Account'} · Phone Number ID {n.id}{n.status?' · Meta status '+n.status:''}</small></span>
              <span className={'metaActivationStatus '+(n.availability==='available'?'available':'unavailable')}>
                {n.availability==='available'?'Available':n.availability==='already_connected'?'Already linked here':'Linked to another workspace'}
              </span>
            </label>)}
          </div>
          {activationResults.length>0&&<div className="metaActivationResults" role="status">
            {activationResults.map(r=><p key={r.phoneNumberId}>
              <b>{r.ok?'✓ Connected':'! Needs attention'} · {r.phoneNumberId}</b>
              {' '}{r.reason||r.warning||r.connection?.name||''}
              {r.connection?.id&&<button type="button" className="metaActivationInspect" onClick={()=>{setPendingActivation(null);setNumberSearch(r.connection.displayPhoneNumber||r.phoneNumberId);}}>
                View saved number →
              </button>}
            </p>)}
          </div>}
          <div className="metaActivationFoot">
            <div><b>{activationSelected.length} selected</b><small>{activationAvailable.length} available · Select up to {pendingActivation.remainingSlots} number(s)</small></div>
            <button type="button" className="primary" disabled={activationBusy||!activationSelected.length}
              onClick={activateSelectedNumbers}>{activationBusy?'Activating…':'Activate selected numbers →'}</button>
            <button type="button" className="metaActivationDiscard" onClick={dismissActivation}>Finish / Close</button>
            {canAdd&&<button type="button" className="metaMultiSecondary" onClick={beginAnotherMetaProfile}>+ Connect another Meta business</button>}
          </div>
          {!activationAvailable.length&&<p className="metaActivationDone">No additional numbers are available in this authorization session. Your saved profiles are listed below.</p>}
        </section>}

        {!editing&&<div className="metaConnectionModes" role="radiogroup" aria-label="WhatsApp number connection type">
          {[
            ['new','New number','Register a new WhatsApp Cloud API sender.'],
            ['business_app','Existing Business App','Use Meta Coexistence with an eligible WhatsApp Business App number.'],
            ['cloud_api','Existing Cloud API','Link an existing WABA number with an authorized Meta system-user token.']
          ].map(([id,title,desc])=><button type="button" role="radio" aria-checked={connectionMode===id} key={id} className={connectionMode===id?'selected':''}
            onClick={()=>{setConnectionMode(id);setShowForm(id==='cloud_api');setErr('')}}>
            <strong>{connectionMode===id?'◉':'◯'} {title}</strong><small>{desc}</small>
          </button>)}
        </div>}
        {connectionMode==='cloud_api'&&!editing&&<div className="metaExistingHint">
          <b>Connect existing Cloud API in one click</b>
          <div className="metaOneClickInline">
            <button type="button" className="facebookButton" disabled={!canAdd||fbBusy||!embedded?.enabled||!fbSdkReady}
              onClick={()=>connectWithFacebook({existing:true,browse:true})}>
              {fbBusy?'Opening Meta authorization…':'ⓕ Continue with Facebook — choose my number'}
            </button>
            <small>No manual WABA ID, Phone Number ID, or token needed. After you approve Meta's login, choose numbers and activate them. Saved connections stay until you explicitly disconnect.</small>
            {fbSdkFailure&&<small role="alert">Facebook Login unavailable: {fbSdkFailure}. Check your browser's network and Meta App settings.</small>}
          </div>
          <b>Already registered with Fast2SMS or another provider?</b>
          <p>Login with Facebook below to browse all Cloud API numbers accessible to that Meta account. Select a specific number to authorize it through Meta Embedded Signup. When Meta grants sharing access, the same number can remain with another provider. Clever Connect does <strong>not</strong> automatically transfer, deregister or disconnect an external integration.</p>
          <p><strong>If Meta denies access:</strong> request the necessary WABA/phone asset sharing permissions from its owner or provider. Do not disconnect a working integration just to force activation. A blocked Meta account cannot be overridden from Clever Connect.</p>
          <p><strong>Existing provider protection:</strong> Clever Connect never automatically deregisters the number or changes its primary responder. After Meta authorizes sharing, you may need to configure <strong>Conversation Routing</strong> in Meta Business Suite to choose which provider handles incoming messages.</p>
        </div>}
        {(connectionMode==='business_app'||connectionMode==='cloud_api')&&!editing&&<div className="metaBusinessAccountPicker">
          <div className="metaExistingHint">
            <b>{connectionMode==='cloud_api'?'Browse existing Cloud API numbers by Meta account':'Connect an existing WhatsApp Business App number (Coexistence)'}</b>
            <p>{connectionMode==='cloud_api'
              ?'Sign in with the specific Facebook/Meta account. Browse every accessible portfolio, WhatsApp Business Account and Cloud API phone number, including shared WABAs. Select the number you want to authorize. Any other provider remains connected unless its owner or Meta changes that access.'
              :'First choose the Facebook/Meta account. Clever Connect lists portfolios, WABAs, and API numbers you have permission to view. WhatsApp Business App-only numbers may not appear until Meta Coexistence onboarding. Meta determines eligibility.'}</p>
          </div>
          <div className="metaPickerActions">
            <button type="button" className="facebookButton" disabled={assetBusy||!fbSdkReady} onClick={()=>discoverFacebookAssets()}>
              {assetBusy?'Checking Meta account…':fbSessionAvailable
                ?'① Continue with current Facebook session · Browse numbers'
                :'① Login with Facebook · Browse portfolios & numbers'}
            </button>
            {fbSessionAvailable&&<button type="button" className="metaManualTokenToggle" disabled={assetBusy}
              onClick={()=>discoverFacebookAssets({forceLogin:true})}>Use a different Facebook account</button>}
            {permissionRetryAvailable&&<button type="button" className="metaManualTokenToggle" disabled={assetBusy}
              onClick={()=>discoverFacebookAssets({forceLogin:true,regrant:true})}>Review Meta permissions</button>}
            {!fbSdkReady&&<small>{fbSdkFailure||'Preparing Facebook login…'}</small>}
            {metaAssets?.metaAccount&&<div className="metaSignedIn"><b>Signed in as {metaAssets.metaAccount.name}</b><small>Facebook account ID: {metaAssets.metaAccount.id}</small></div>}
          </div>
          {accountDiscoveryError&&<div className="metaPickerWarning" role="alert">{accountDiscoveryError}
              <p>{connectionMode==='cloud_api'
                ?'Meta must grant business_management and WhatsApp business management access before Clever Connect can list your Cloud API numbers. You may still use an authorized system-user token below.'
                :'You can still continue with Meta Coexistence below; Meta controls portfolio and phone selection in its signup window.'}</p>
            </div>}
          {metaAssets&&<div className="metaPortfolioResults">
            <div className="metaPortfolioResultHead"><b>② Choose a business portfolio</b><span>{metaAssets.portfolios?.length||0} accessible</span></div>
            {(metaAssets.portfolios||[]).length?
              <select aria-label="Business portfolio" value={chosenBusiness} onChange={e=>{setChosenBusiness(e.target.value);setChosenWaba('');setChosenPhone('')}}>
                {metaAssets.portfolios.map(x=><option key={x.id} value={x.id}>{x.name} · {x.id}</option>)}
              </select>:
              <p className="metaPickerWarning">No accessible portfolios returned. Confirm the selected Facebook identity has full portfolio access and approved business_management permission.</p>}
            {chosenPortfolio&&<>
              <div className="metaPortfolioResultHead"><b>③ WhatsApp Business Accounts in {chosenPortfolio.name}</b><span>{chosenPortfolio.wabas.length} visible</span></div>
              {chosenPortfolio.wabas.length?<div className="metaWabaOptions">{chosenPortfolio.wabas.map(w=><div className="metaWaba" key={w.id}>
                <button type="button" className={chosenWaba===w.id?'chosen':''} onClick={()=>{setChosenWaba(w.id);setChosenPhone('')}}>
                  <b>◉ {w.name}</b><small>WABA ID: {w.id} · {w.source==='owned'?'Owned':'Shared'} · {w.numbers.length} API number(s)</small>
                </button>
                {chosenWaba===w.id&&<div className="metaNumbers">{w.numbers.length?
                  w.numbers.map(n=><div className="metaPhoneRow" key={n.id}>
                    <label><input type="radio" name="metaPhone" checked={chosenPhone===n.id} onChange={()=>setChosenPhone(n.id)}/>
                      <span><b>{n.displayPhoneNumber||n.id}</b><small>{n.verifiedName||'Meta Cloud API number'} · Phone ID: {n.id}</small></span>
                    </label>
                    <button type="button"
                      disabled={meta.some(profile=>profile.phoneNumberId===n.id)}
                      onClick={()=>useExistingApiPhone(w,n)}>
                      {meta.some(profile=>profile.phoneNumberId===n.id)?'Saved in this workspace':'Select this API number →'}
                    </button>
                  </div>):
                  <div className="metaPickerHint">No Cloud API phone numbers visible for this WABA. A number used only in the WhatsApp Business phone app might be absent until Meta completes Coexistence onboarding.</div>}</div>}
              </div>)}</div>:<div className="metaPickerHint">No WABAs are visible for this portfolio with the current Meta permissions. Meta may still offer eligible Business App numbers during its hosted Coexistence flow.</div>}
              {connectionMode==='business_app'&&<label className="metaAppNumberInput">④ WhatsApp Business App number you want to connect (optional, for reference)
                <input type="tel" value={businessAppPhone} onChange={e=>setBusinessAppPhone(e.target.value)} placeholder="+91 98765 43210" maxLength={25}/>
                <small>Clever Connect cannot select an app-only number on your behalf. Enter and verify the same number inside Meta's onboarding popup.</small>
              </label>}
              <div className="metaPickerHint"><b>Selected portfolio:</b> {chosenPortfolio.name}.
                {connectionMode==='cloud_api'
                  ?' Choose an existing Cloud API phone number above, then authorize the same WABA and number through Facebook. The selected number stays on its current provider when Meta permits sharing.'
                  :' Continue with Meta Coexistence below. If Meta returns a portfolio ID, Clever Connect checks for a mismatch before saving.'}</div>
            </>}
            {(metaAssets.warnings||[]).map((warning,i)=><div className="metaPickerWarning" key={i}>{warning}</div>)}
            <small className="metaPickerSourceNote">{metaAssets.note}</small>
          </div>}
        </div>}
        {connectionMode==='new'&&!editing&&<div className="metaExistingHint">
          <b>Set up a new WhatsApp number</b>
          <p>Choose a number that is not attached to another WABA. Meta handles business selection, number verification and registration.</p>
        </div>}
        {connectionMode!=='cloud_api'&&!editing&&<section className="facebookConnectHero">
      <div className="facebookConnectCopy">
        <span className="facebookLogo">f</span>
        <div><small>RECOMMENDED</small><h2>Connect with Facebook</h2><p>Sign in to Meta, choose your Business Portfolio, WhatsApp Business Account and phone number. WA SANTA securely completes the API connection for you.</p><p className="metaPortfolioGuide">Existing portfolio unavailable? Meta determines portfolio eligibility. Confirm full admin control, no account restrictions, and an up-to-date Embedded Signup v4 configuration. A portfolio that owns the developer app may be ineligible for customer onboarding; you may instead connect its existing Cloud API number manually with an authorized system-user token.</p></div>
      </div>
      <div className="facebookConnectAction">
        <p className="metaModeInfo">{coexistence?'Existing WhatsApp Business App Coexistence onboarding — Meta eligibility required.':'New WhatsApp Cloud API number onboarding.'}</p>
        <button className="facebookButton" disabled={!canAdd||fbBusy||!embedded?.enabled} onClick={connectWithFacebook}>{fbBusy?'Connecting with Meta…':'Continue with Facebook'}</button>
        {!embedded?.enabled&&embedded&&<small>Admin setup required: {embedded.missing?.join(', ')||'Meta Embedded Signup configuration'}</small>}
        {embedded?.enabled&&<small>Meta-hosted login · WA SANTA never sees your Facebook password</small>}
        <button type="button" className="metaLoginHelpToggle" aria-expanded={metaLoginHelpOpen} onClick={()=>setMetaLoginHelpOpen(x=>!x)}>Meta says “Feature unavailable”? {metaLoginHelpOpen?'Hide checklist ↑':'Fix developer app settings →'}</button>
      </div>
    </section>}
        {metaLoginHelpOpen&&<section className="metaLoginTroubleshoot" aria-label="Resolve Meta Facebook Login unavailable">
          <div className="metaLoginTroubleshootHeading"><div><small>META DEVELOPER APP ACTION REQUIRED</small><h2>Facebook Login is unavailable</h2><p>This restriction is issued by Meta. Saving an App Secret or selecting Live mode alone does not clear pending compliance reviews.</p></div><span>Requires app administrator</span></div>
          <div className="metaLoginIdentifiers"><div><small>Meta App ID</small><b>{embedded?.appId||'Not configured'}</b></div><div><small>Embedded Signup Configuration ID</small><b>{embedded?.configId||'Not configured'}</b></div></div>
          <ol className="metaLoginChecklist">
            <li><b>Open Meta → Required Actions / Alerts</b><span>Resolve any outstanding Data Use Checkup, policy notice, missing app details or disabled functionality.</span></li>
            <li><b>Complete App Settings → Basic</b><span>Check the real business contact information, privacy policy URL, user data deletion instructions, category and app domain.</span></li>
            <li><b>Check App Review and business verification</b><span>Complete any review Meta requires for Facebook Login for Business, business_management, whatsapp_business_management and whatsapp_business_messaging. Verify advanced access where needed.</span></li>
            <li><b>Review Facebook Login for Business configuration</b><span>Confirm the selected WhatsApp Embedded Signup configuration ID, allowed JavaScript SDK domain and HTTPS website origin are correct.</span></li>
            <li><b>Retest only after Meta clears the restriction</b><span>If the popup still shows this exact error with no pending actions, open a Meta Developer Support case for the App ID displayed here.</span></li>
          </ol>
          <div className="metaLoginHelpLinks"><a href={embedded?.appId?'https://developers.facebook.com/apps/'+encodeURIComponent(embedded.appId)+'/':'https://developers.facebook.com/apps/'} target="_blank" rel="noopener noreferrer">Open this Meta Developer App ↗</a><a href="https://developers.facebook.com/support/" target="_blank" rel="noopener noreferrer">Meta Developer Support ↗</a></div>
          <p className="metaLoginSecurityNote">No WhatsApp sender, Meta token, Business Portfolio or subscription is modified by these checks. Existing Cloud API numbers can still be linked with an authorized system-user token through the manual option below, where Meta permits that access.</p>
        </section>}
        {(connectionMode==='cloud_api'||!!editing)&&<section className="manualConnectionBox">
      <div className="sectionHead">
        <div><small>EXISTING CLOUD API</small><h2>Connect an existing API number</h2><p>Link only with authorized WABA access. Meta verifies the phone belongs to this account. No registration or provider migration occurs.</p></div>
        {canAdd&&connectionMode==='cloud_api'&&!editing&&<button type="button" onClick={()=>setShowForm(v=>!v)}>{showForm?'Hide credentials':'Enter credentials'}</button>}
      </div>
      {(showForm||connectionMode==='cloud_api')&&<div className="panel metaConnectionForm">
        <form id="existingCloudConnectionForm" key={editing?.id||existingPrefill?.phoneNumberId||'new-meta'} className="formGrid" onSubmit={save}>
          <label>Connection name<input name="name" defaultValue={editing?.name||existingPrefill?.name||''} placeholder="Sales WhatsApp" required/></label>
          <label>Graph API version<input name="graphVersion" defaultValue={editing?.graphVersion||'v23.0'} placeholder="v23.0"/></label>
          <label>Phone Number ID<input name="phoneNumberId" defaultValue={editing?.phoneNumberId||existingPrefill?.phoneNumberId||''} required/></label>
          <label>WhatsApp Business Account (WABA) ID<input name="businessAccountId" defaultValue={editing?.businessAccountId||existingPrefill?.businessAccountId||''} required={!editing} placeholder="Meta numeric WABA ID"/></label>
          {!editing&&existingPrefill?.phoneNumberId&&<div className="metaSelectedExistingNumber full" role="status">
            <b>✓ Selected existing Cloud API number</b>
            <span>{existingPrefill.name||'Meta number'} · Phone Number ID {existingPrefill.phoneNumberId}</span>
            <small>WABA {existingPrefill.businessAccountId} · Clever Connect will not call Meta's registration, migration or deregistration endpoints for this existing sender.</small>
          </div>}
          <div className="metaAutoTokenPanel full">
            <div className="metaAutoTokenHead"><span aria-hidden="true">◈</span><div>
              <b>{editing?.hasAccessToken?'Access token saved securely':'Automatic authorization with Meta'}</b>
              <p>{editing?.hasAccessToken
                ?'The existing encrypted token is already saved on the server. It will be reused automatically; the browser never needs to fetch or display it.'
                :'Sign in to the Meta account that owns this WABA. When Meta grants access through Embedded Signup, Clever Connect exchanges the authorization code securely and stores the new token on the server.'}</p>
            </div></div>
            <button type="button" className="metaAutoTokenButton" disabled={fbBusy||!embedded?.enabled||(!canAdd&&!editing)}
              onClick={()=>connectWithFacebook({existing:true})}>
              {fbBusy?'Authorizing with Meta…':editing?'↻ Reauthorize with Facebook (refresh token)':'Continue with Facebook — authorize token automatically ↗'}
            </button>
            <small>Meta must authorize this exact WABA and Phone Number ID. Numbers already in another platform can be connected here only if Meta grants partner sharing/access; Clever Connect does not disconnect, migrate or re-register the existing provider's number.</small>
          </div>
          <div className="metaManualToken full">
            <button type="button" className="metaManualTokenToggle" aria-expanded={manualTokenEntry}
              onClick={()=>setManualTokenEntry(v=>!v)}>
              {manualTokenEntry?'− Hide manual token entry':'+ Use my own system-user token instead'}
            </button>
            {manualTokenEntry&&<label>Permanent/System-user access token
              <input type="password" name="accessToken" autoComplete="off"
                required={!editing} placeholder={editing?.hasAccessToken?'Enter a replacement token or leave blank to keep saved token':'Paste your authorized system-user access token'}/>
            </label>}
          </div>
          <label>OTP authentication template<input name="otpTemplateName" defaultValue={editing?.otpTemplateName||''} placeholder="login_otp"/></label>
          <label>OTP template language<input name="otpTemplateLanguage" defaultValue={editing?.otpTemplateLanguage||'en_US'} placeholder="en_US"/></label>
          <div className="actions full">
            <button type="button" onClick={()=>{setShowForm(false);setEditing(null);setManualTokenEntry(false);setShowSetup(false)}}>Cancel</button>
            {(editing||manualTokenEntry)&&<button className="primary">{editing?'Save changes':'Verify manually & link number'}</button>}
          </div>
        </form>
      </div>}
    </section>}
      </div>}
      <div className="numberListTitle"><div><h2>Connected Meta profiles</h2><p>Each number has independent credentials, WABA ownership, templates, connection health and sender selection. Default applies only in this workspace.</p></div><span>{shown.length} of {meta.length} shown</span></div>
      {businessGroups.length>1&&<div className="metaBusinessFilter">
        <label htmlFor="metaBusinessFilter">Filter by WhatsApp Business Account</label>
        <select id="metaBusinessFilter" value={businessFilter} onChange={e=>setBusinessFilter(e.target.value)}>
          <option value="all">All businesses · {meta.length} profiles</option>
          {businessGroups.map(g=><option value={g.key} key={g.key}>
            {g.wabaId?'WABA '+g.wabaId:'Business not assigned'}{g.portfolioId?' · Portfolio '+g.portfolioId:''} · {g.count} number(s)
          </option>)}
        </select>
      </div>}
      <div className="numberList" role="list">
        <div className="numberListLabels" aria-hidden="true"><span>S.No.</span><span>Business details</span><span>Connection status</span><span>Manage</span></div>
        {shown.map((x,index)=><article className="numberRow" role="listitem" key={x.id}>
          <span className="numberOrdinal">{String(index+1).padStart(2,'0')}</span>
          <div className="numberMainDetail"><b><span aria-hidden="true" className="numberMetaSymbol">∞</span>{x.name}</b><span className="numberPhone">{x.displayPhoneNumber||'Phone Number ID: '+x.phoneNumberId}</span>
            <small>Meta Cloud API · {x.connectMethod==='embedded'?'Connected with Facebook':'Manual setup'}</small>
            <small>WABA: {x.businessAccountId||'Not provided'} · Last checked: {fmt(x.lastCheckedAt)}</small>
            {x.businessPortfolioId&&<small>Meta Business Portfolio: {x.businessPortfolioId}</small>}</div>
          <div className="numberStates">
            {x.isDefault&&<span className="numberStatus default">Default sender</span>}
            {x.planAllowed===false&&<span className="numberStatus warning">Outside plan limit</span>}
            {!x.enabled&&<span className="numberStatus disabled">Disabled</span>}
            {x.enabled&&<span className={'numberStatus '+(x.connectionStatus==='connected'?'good':'warning')}>{x.connectionStatus==='connected'?'API connected':'Needs attention'}</span>}
            {x.webhookStatus==='subscribed'&&<small className="metaWebhookBadge ready">✓ Webhooks subscribed</small>}
            {x.webhookStatus==='needs_attention'&&<small className="metaWebhookBadge attention">Webhooks need attention</small>}
            {x.lastError&&<small className="numberStatusError">{x.lastError}</small>}</div>
          <div className="numberRowActions">
            <button type="button" onClick={()=>act(x,'test')} disabled={!x.enabled||!allowed}>Test / Sync</button>
            {x.webhookStatus!=='subscribed'&&
              <button type="button" onClick={()=>act(x,'webhook')} disabled={!x.enabled||!allowed||x.planAllowed===false}>
                Verify webhooks ↻
              </button>}
            <button type="button" onClick={()=>{localStorage.setItem('wa:template-profile',x.id);go('templates')}}>Templates</button>
            <button type="button" onClick={()=>{setEditing(x);setManualTokenEntry(false);setConnectionMode('cloud_api');setShowSetup(true);setShowForm(true);requestAnimationFrame(()=>document.getElementById('numbersSetup')?.scrollIntoView({behavior:'smooth',block:'start'}))}}>Edit</button>
            {!x.isDefault&&<button type="button" onClick={()=>act(x,'default')} disabled={x.planAllowed===false||!x.enabled}>Make default</button>}
            <button type="button" className="numberDanger" onClick={()=>act(x,'delete')}>Disconnect</button>
          </div>
        </article>)}
        {!shown.length&&<div className="numberEmpty">{meta.length?'No numbers match your search or filter.':'No WhatsApp numbers connected yet. Use Add New Number to get started.'}</div>}
      </div>
    </section>
    {showSetup&&<div className="accountGrid metaSetupGrid">

      <section>
        <h2>Facebook Embedded Signup requirements</h2>
        <div className="setupChecklist">
          <span>1 <b>Meta App + Facebook Login for Business</b><small>Embedded Signup configuration ID</small></span>
          <span>2 <b>Advanced Meta permissions</b><small>business_management and whatsapp_business_management</small></span>
          <span>3 <b>App Review / Access Verification</b><small>Required before public customer onboarding</small></span>
          <span>4 <b>HTTPS + Webhooks</b><small>Your current Render deployment already uses HTTPS</small></span>
        </div>
      </section>
    </div>}
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
  const[openaiSettings,setOpenaiSettings]=useState(()=>getCached('/admin/openai-settings')||null);
  const[editing,setEditing]=useState(null);
  const[showPlan,setShowPlan]=useState(false);
  const[msg,setMsg]=useState('');
  const[err,setErr]=useState('');
  const[workspacePlans,setWorkspacePlans]=useState({});
  const[adminSearch,setAdminSearch]=useState('');
  const[adminFilter,setAdminFilter]=useState('all');
  const[adminTab,setAdminTab]=useState('overview');
  const[auditEvents,setAuditEvents]=useState([]);
  async function load(){
    setErr('');
    try{
      const [overview,meta,openai]=await Promise.all([api('/admin/overview',{fresh:true}),api('/admin/meta-settings',{fresh:true}),api('/admin/openai-settings',{fresh:true})]);
      setData(overview);setMetaSettings(meta);setOpenaiSettings(openai);
    }catch(e){setErr(e.message)}
  }
  useEffect(()=>{load()},[]);
  useEffect(()=>{
    if(adminTab!=='audit')return;
    let live=true;
    api('/admin/audit?limit=100',{fresh:true}).then(events=>{if(live)setAuditEvents(events)}).catch(e=>{if(live)setErr(e.message)});
    return()=>{live=false};
  },[adminTab]);
  async function saveMetaSettings(e){
    e.preventDefault();setErr('');setMsg('');
    const o=Object.fromEntries(new FormData(e.currentTarget));
    try{
      const x=await api('/admin/meta-settings',{method:'PUT',body:JSON.stringify(o)});
      setMetaSettings(x);
      e.currentTarget.elements.appSecret.value='';
      setMsg('Meta App credentials and configuration saved. Facebook Login availability must still be approved by Meta.');
    }catch(e){setErr(e.message)}
  }
  async function testMetaSettings(){
    setErr('');setMsg('');
    try{
      const x=await api('/admin/meta-settings/test',{method:'POST'});
      setMsg((x.message||'Meta App credentials are valid.')+' This test cannot verify Meta App Review, Data Use Checkup or Facebook Login availability.');
    }catch(e){setErr(e.message)}
  }
  async function clearMetaSecret(){
    if(!confirm('Clear the saved Meta App Secret? Continue with Facebook will stop working until a new secret is saved.'))return;
    try{
      const x=await api('/admin/meta-settings/clear-secret',{method:'POST'});
      setMetaSettings(x);setMsg('Saved Meta App Secret cleared.');
    }catch(e){setErr(e.message)}
  }

  async function saveOpenAISettings(e){
    e.preventDefault();setErr('');setMsg('');
    const fd=new FormData(e.currentTarget);
    const o=Object.fromEntries(fd);
    o.enabled=fd.get('enabled')==='on';
    try{
      const x=await api('/admin/openai-settings',{method:'PUT',body:JSON.stringify(o)});
      setOpenaiSettings(x);
      if(e.currentTarget.elements.apiKey)e.currentTarget.elements.apiKey.value='';
      setMsg('OpenAI settings saved securely.');
    }catch(e){setErr(e.message)}
  }
  async function testOpenAISettings(){
    setErr('');setMsg('');
    try{
      const x=await api('/admin/openai-settings/test',{method:'POST'});
      setMsg(x.message||'OpenAI connection is valid.');
    }catch(e){setErr(e.message)}
  }
  async function clearOpenAIKey(){
    if(!confirm('Clear the saved OpenAI API key? WA SANTA AI will stop working until a new key is saved.'))return;
    try{
      const x=await api('/admin/openai-settings/clear-key',{method:'POST'});
      setOpenaiSettings(x);setMsg('Saved OpenAI API key cleared.');
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
  const filteredWorkspaces=data.workspaces.filter(w=>{
    const hay=[w.name,w.owner?.name,w.owner?.email,w._id].join(' ').toLowerCase();
    return hay.includes(adminSearch.trim().toLowerCase())&&(adminFilter==='all'||(adminFilter==='active'?w.access?.allowed:!w.access?.allowed));
  });
  const adminTabs=[['overview','Overview'],['tenants','Tenants'],['approvals','Approvals'],['plans','Plans'],['integrations','Integrations'],['audit','Audit trail']];
  return <div className="page adminEnterprise">
    <div className="adminHero">
      <div><span className="adminOverline"><i/> CONTROL CENTER · PLATFORM ADMINISTRATION</span><h1>Enterprise command center</h1><p>Govern tenants, subscription revenue, approvals and connected business infrastructure from one secure workspace.</p></div>
      <div className="adminHeroActions"><span className="adminLiveBadge">● Platform administration</span><button type="button" onClick={load}>↻ Refresh data</button><button type="button" className="primary" onClick={()=>{setAdminTab('plans');setEditing(null);setShowPlan(true)}}>+ New plan</button></div>
    </div>
    <nav className="adminTabs" aria-label="Admin workspace sections">{adminTabs.map(([id,label])=><button type="button" key={id} aria-current={adminTab===id?'page':undefined} className={adminTab===id?'active':''} onClick={()=>setAdminTab(id)}>{label}{id==='approvals'&&data.pendingRequests.length>0&&<b>{data.pendingRequests.length}</b>}</button>)}</nav>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>

    <div className="metrics adminKpis">
      <Metric label="Projected monthly plan value" value={'₹'+Number(data.insights?.projectedMonthlyRevenue||0).toLocaleString('en-IN')} sub="Active plan prices · not collected revenue"/>
      <Metric label="Active tenants" value={data.insights?.activeTenants??0} sub={data.workspaces.length+' workspaces shown'}/>
      <Metric label="Pending approvals" value={data.pendingRequests.length} sub="Require admin review"/>
      <Metric label="14-day delivery rate" value={(data.insights?.deliveryRateLast14Days||0)+'%'} sub={(data.insights?.deliveredLast14Days||0)+' delivered · '+(data.insights?.dispatchedLast14Days||0)+' dispatched'}/>
    </div>
    {adminTab==='overview'&&<div className="adminMiniInsights"><span><small>PLATFORM USERS</small><b>{data.insights?.totalUsers??0}</b></span><span><small>CAMPAIGNS CREATED</small><b>{data.insights?.totalCampaigns??0}</b></span><span><small>ACTIVE PLANS</small><b>{data.plans.filter(x=>x.active).length}</b></span><span><small>LOCKED WORKSPACES</small><b>{data.workspaces.filter(x=>!x.access?.allowed).length}</b></span></div>}

    {(adminTab==='overview'||adminTab==='audit')&&<section className="adminAudit">
      <div className="sectionHead"><div><small>GOVERNANCE & COMPLIANCE</small><h2>Administration activity</h2><p>Read-only record of plan, subscription and integration administration. Sensitive credential values are never logged.</p></div></div>
      <div className="table"><div className="tr adminAuditRow th"><span>Activity</span><span>Actor</span><span>Target</span><span>Recorded</span></div>
        {(adminTab==='audit'?auditEvents:data.recentAudit||[]).map(x=><div className="tr adminAuditRow" key={x._id}>
          <span><b>{String(x.action||'').replaceAll('.',' · ')}</b><small>{x.description||'Administrative action'}</small></span>
          <span>{x.actorId?.name||x.actorId?.email||'Administrator'}</span>
          <span>{x.targetType||'—'} <small>{x.targetId||''}</small></span>
          <span>{fmt(x.createdAt)}</span>
        </div>)}{!(adminTab==='audit'?auditEvents:data.recentAudit||[]).length&&<Empty text="New administrator actions will be recorded here."/>}
      </div>
      {adminTab==='audit'&&<p className="muted">Showing up to 100 most recent administrator actions. Credential values and access tokens are never included in audit descriptions.</p>}
    </section>}

    {(adminTab==='overview'||adminTab==='integrations')&&<section className="adminMetaSettings">
      <div className="sectionHead">
        <div>
          <small>META PLATFORM</small>
          <h2>Meta Embedded Signup Settings</h2>
          <p>Configure the global Facebook/Meta app used by every tenant's “Continue with Facebook” WhatsApp onboarding flow.</p>
        </div>
        <em className={'status '+(metaSettings?.enabled?'completed':'failed')}>{metaSettings?.enabled?'Credentials saved':'Setup required'}</em>
      </div>
      <form className="formGrid" onSubmit={saveMetaSettings}>
        <label>Meta App ID<input name="appId" defaultValue={metaSettings?.appId||''} placeholder="123456789012345" required/></label>
        <label>Embedded Signup Config ID<input name="configId" defaultValue={metaSettings?.configId||''} placeholder="Facebook Login for Business config ID" required/></label>
        <label>Graph API version<input name="graphVersion" defaultValue={metaSettings?.graphVersion||'v23.0'} placeholder="v23.0" required/></label>
        <label>Meta App Secret<input type="password" name="appSecret" placeholder={metaSettings?.hasAppSecret?'Saved securely — leave blank to keep current secret':'Paste Meta App Secret'} required={!metaSettings?.hasAppSecret}/></label>
        <div className="metaSecretState full">
          <span><b>App Secret</b><small>{metaSettings?.hasAppSecret?'Encrypted and stored securely':'Not configured'}</small></span>
          <span><b>Config source</b><small>{metaSettings?.source==='admin'?'Managed in Super Admin':'Render environment fallback'}</small></span>
          <span><b>Configuration fields</b><small>{metaSettings?.missing?.length?metaSettings.missing.join(', '):'Saved; Meta login approval is not verified'}</small></span>
        </div>
        <div className="actions full">
          {metaSettings?.hasAppSecret&&<button type="button" className="danger" onClick={clearMetaSecret}>Clear secret</button>}
          <button type="button" onClick={testMetaSettings}>Test Meta credentials</button>
          <button className="primary">Save Meta settings</button>
        </div>
      </form>
      <div className="metaAdminCompliance">
        <b>Meta authorization status is not verified by the credential test.</b>
        <p>If Facebook displays “Feature unavailable”, visit Meta for Developers → Required Actions, complete outstanding Data Use Checkup or App Review requirements, and check business verification, app details and Embedded Signup settings. Clever Connect cannot lift a restriction imposed by Meta.</p>
        <a href={metaSettings?.appId?'https://developers.facebook.com/apps/'+encodeURIComponent(metaSettings.appId)+'/':'https://developers.facebook.com/apps/'} target="_blank" rel="noopener noreferrer">Open configured Meta App ↗</a>
      </div>
      <div className="adminMetaHelp">
        <span><b>Where to get these values</b><small>Meta for Developers → your app → App settings / Facebook Login for Business → Embedded Signup configuration.</small></span>
        <span><b>Security</b><small>The App Secret is encrypted before being stored and is never returned to the browser after save.</small></span>
      </div>
    </section>}

    {(adminTab==='overview'||adminTab==='integrations')&&<section className="adminOpenAISettings">
      <div className="sectionHead">
        <div>
          <small>OPENAI</small>
          <h2>WA SANTA AI Settings</h2>
          <p>Configure the OpenAI Responses API used for recommendations, campaigns, message generation, Meta templates and performance analysis.</p>
        </div>
        <em className={'status '+(openaiSettings?.enabled?'completed':'failed')}>{openaiSettings?.enabled?'AI ready':'Setup required'}</em>
      </div>
      <form className="formGrid" onSubmit={saveOpenAISettings}>
        <label>Fast model<input name="fastModel" defaultValue={openaiSettings?.fastModel||'gpt-6-luna'} required/></label>
        <label>Strategy model<input name="strategyModel" defaultValue={openaiSettings?.strategyModel||'gpt-6-sol'} required/></label>
        <label className="full">OpenAI API key<input type="password" name="apiKey" placeholder={openaiSettings?.hasApiKey?'Saved securely — leave blank to keep current key':'Paste OpenAI API key'} required={!openaiSettings?.hasApiKey}/></label>
        <label className="check full"><input type="checkbox" name="enabled" defaultChecked={openaiSettings?.enabled??true}/> Enable WA SANTA AI for eligible workspaces</label>
        <div className="metaSecretState full">
          <span><b>API key</b><small>{openaiSettings?.hasApiKey?'Encrypted and stored securely':'Not configured'}</small></span>
          <span><b>Fast generation</b><small>{openaiSettings?.fastModel||'gpt-6-luna'}</small></span>
          <span><b>Strategy / analysis</b><small>{openaiSettings?.strategyModel||'gpt-6-sol'}</small></span>
        </div>
        <div className="actions full">
          {openaiSettings?.hasApiKey&&<button type="button" className="danger" onClick={clearOpenAIKey}>Clear API key</button>}
          <button type="button" onClick={testOpenAISettings}>Test OpenAI</button>
          <button className="primary">Save AI settings</button>
        </div>
      </form>
      <div className="adminMetaHelp">
        <span><b>Privacy</b><small>AI recommendations use the business profile and aggregate workspace metrics. Contact names, phone numbers and email addresses are excluded from AI context.</small></span>
        <span><b>Control</b><small>AI creates recommendations and drafts only. Users must explicitly review and send or schedule campaigns.</small></span>
      </div>
    </section>}

    {(adminTab==='plans')&&showPlan&&<div className="panel"><form key={editing?editing._id:'new-plan'} className="formGrid" onSubmit={savePlan}>
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

    {(adminTab==='overview'||adminTab==='plans')&&<section>
      <div className="sectionHead"><div><h2>Subscription plans</h2><p>These are the only plans tenants can request.</p></div></div>
      <div className="adminPlanGrid">{data.plans.map(p=><article key={p._id}>
        <div className="cardTop"><div><small>{p.active?'PUBLISHED':'HIDDEN'}</small><h3>{p.name}</h3></div><em className={'status '+(p.active?'completed':'cancelled')}>{p.active?'active':'disabled'}</em></div>
        <div className="priceValue">{p.currency==='INR'?'₹':p.currency+' '}{Number(p.priceMonthly).toLocaleString()}<span>/month</span></div>
        <p>{p.metaConnections} WhatsApp · {p.teamMembers} team · {Number(p.monthlyMessages).toLocaleString()} messages</p>
        <footer><span>{p.slug}</span><div className="rowActions"><button onClick={()=>{setAdminTab('plans');setEditing(p);setShowPlan(true)}}>Edit</button><button className="danger" onClick={()=>deletePlan(p)}>Delete</button></div></footer>
      </article>)}</div>
    </section>}

    {(adminTab==='overview'||adminTab==='approvals')&&<section>
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
    </section>}

    {(adminTab==='overview'||adminTab==='tenants')&&<section>
      <div className="sectionHead"><div><h2>Tenant workspaces</h2><p>Search and manage tenant lifecycle, plan assignments and access.</p></div></div>
      <div className="adminDirectoryTools"><input type="search" placeholder="Search workspace, owner or email…" value={adminSearch} onChange={e=>setAdminSearch(e.target.value)}/><select value={adminFilter} onChange={e=>setAdminFilter(e.target.value)} aria-label="Workspace access filter"><option value="all">All workspaces</option><option value="active">Access active</option><option value="locked">Expired / locked</option></select><small>{filteredWorkspaces.length} of {data.workspaces.length} workspaces</small></div>
      <div className="table">
        <div className="tr adminWorkspace th"><span>Workspace</span><span>Owner</span><span>Access</span><span>Plan</span><span>Ends</span><span>Controls</span></div>
        {filteredWorkspaces.map(w=><div className="tr adminWorkspace" key={w._id}>
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
    </section>}
  </div>
}

function Page({id,go,session,onSessionUpdate}){
  if(id==='overview')return <Overview go={go}/>;
  if(id==='ai')return <LazyAICopilot go={go} session={session}/>;
  if(id==='send')return <LazySendMessage go={go}/>;
  if(id==='bulk')return <LazyBulkWhatsApp go={go}/>;
  if(id==='campaigns')return <Campaigns/>;
  if(id==='contacts')return <Contacts/>;
  if(id==='schedule')return <Schedule/>;
  if(id==='templates')return <LazyMetaTemplateManager/>;
  if(id==='reports')return <Reports go={go}/>;
  if(id==='inbox')return <LazyInbox/>;
  if(id==='chatbot')return <LazyFlowStudio session={session}/>;
  if(id==='whatsapp-api')return <WhatsAppApi go={go}/>;
  if(id==='payments')return <LazyPayments session={session} go={go}/>;
  if(id==='subscription')return <Subscription onSessionUpdate={onSessionUpdate}/>;
  if(id==='admin'&&session.user.isSuperAdmin)return <SuperAdmin/>;
  if(id==='profile')return <Profile session={session} go={go} onSessionUpdate={onSessionUpdate}/>;
  if(id==='edit-profile')return <EditProfile go={go} onSessionUpdate={onSessionUpdate}/>;
  return <Settings go={go}/>;
}

export default function App(){
  const[session,setSession]=useState(()=>getCached('/auth/me')??undefined);
  useEffect(()=>{
    api('/auth/me',{fresh:true}).then(x=>setSession(x)).catch(()=>setSession(null));
    const unauth=()=>setSession(null);
    window.addEventListener('wa:unauthorized',unauth);
    return()=>window.removeEventListener('wa:unauthorized',unauth);
  },[]);
  async function logout(){
    try{await api('/auth/logout',{method:'POST'})}catch{}
    setSession(null);
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+'#/overview');
  }
  if(session===undefined)return <Loading/>;
  return session?<Shell session={session} onLogout={logout} onSessionUpdate={setSession}/>:<Auth onAuth={setSession}/>;
}