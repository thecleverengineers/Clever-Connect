import React,{useEffect,useMemo,useState}from'react';
import{api}from'./api.js';
import{BUSINESS_TYPES,BUSINESS_GOALS,BRAND_TONES,LANGUAGES}from'./business.js';
import'./aiCopilot.css';

const Notice=({children,type='ok'})=>children?<div className={'aiNotice '+type}>{children}</div>:null;
const Loader=({text='WA SANTA AI is thinking…'})=><div className="aiLoader"><span></span><b>{text}</b></div>;

function BusinessProfile({status,onSaved}){
  const[edit,setEdit]=useState(!status?.profileComplete);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState('');
  const p=status?.businessProfile||{};
  async function save(e){
    e.preventDefault();setBusy(true);setErr('');
    try{
      const o=Object.fromEntries(new FormData(e.currentTarget));
      await api('/ai/business-profile',{method:'PUT',body:JSON.stringify(o)});
      setEdit(false);await onSaved();
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return <section className="aiBusinessCard">
    <div className="aiSectionHead"><div><small>AI BUSINESS PROFILE</small><h2>{p.businessType||'Set up your business'}</h2><p>WA SANTA uses this profile to tailor campaign, message and template recommendations.</p></div><button onClick={()=>setEdit(v=>!v)}>{edit?'Cancel':'Edit profile'}</button></div>
    <Notice type="bad">{err}</Notice>
    {edit?<form className="aiProfileForm" onSubmit={save}>
      <label>Business type<select name="businessType" required defaultValue={p.businessType||''}><option value="">Choose business type</option>{BUSINESS_TYPES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Business subtype<input name="businessSubtype" defaultValue={p.businessSubtype||''} placeholder="e.g. Rental properties, Dental clinic"/></label>
      <label>Primary goal<select name="primaryGoal" required defaultValue={p.primaryGoal||''}><option value="">Choose primary goal</option>{BUSINESS_GOALS.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Brand tone<select name="brandTone" defaultValue={p.brandTone||'Professional'}>{BRAND_TONES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Preferred language<select name="preferredLanguage" defaultValue={p.preferredLanguage||'English'}>{LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Country<input name="country" defaultValue={p.country||'India'}/></label>
      <label className="full">Products / services<textarea name="productsServices" rows="2" defaultValue={p.productsServices||''} placeholder="What do you sell or provide?"/></label>
      <label className="full">Target customers<textarea name="targetCustomers" rows="2" defaultValue={p.targetCustomers||''} placeholder="Who are your ideal customers?"/></label>
      <div className="full aiActions"><button className="primary" disabled={busy}>{busy?'Saving…':'Save AI business profile'}</button></div>
    </form>:<div className="aiProfileSummary">
      <span><small>Goal</small><b>{p.primaryGoal||'—'}</b></span>
      <span><small>Subtype</small><b>{p.businessSubtype||'—'}</b></span>
      <span><small>Audience</small><b>{p.targetCustomers||'Not specified'}</b></span>
      <span><small>Language / tone</small><b>{p.preferredLanguage||'English'} · {p.brandTone||'Professional'}</b></span>
    </div>}
  </section>
}

function RecommendationCard({x,onUse}){
  return <article className="aiRecommendation">
    <div className="aiRecTop"><span>{x.type}</span><em className={'aiPriority '+x.priority}>{x.priority}</em></div>
    <h3>{x.title}</h3>
    <p>{x.reason}</p>
    <div className="aiRecMeta"><span><small>Objective</small><b>{x.objective}</b></span><span><small>Audience</small><b>{x.audience}</b></span><span><small>Suggested time</small><b>{x.suggestedTime}</b></span></div>
    {x.message&&<blockquote>{x.message}</blockquote>}
    <footer><span>{Math.round((x.confidence||0)*100)}% confidence</span><button onClick={()=>onUse(x)}>Use recommendation</button></footer>
  </article>
}

function CampaignBuilder({status,onCreated}){
  const[result,setResult]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function generate(e){
    e.preventDefault();setBusy(true);setErr('');setResult(null);
    try{const x=await api('/ai/campaign',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setResult(x.campaign)}
    catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function saveDraft(){
    try{
      const x=await api('/campaigns',{method:'POST',body:JSON.stringify({
        name:result.campaignName,message:result.message,audienceType:'all',contentType:'text'
      })});
      onCreated('Campaign draft created: '+x.name);
    }catch(e){setErr(e.message)}
  }
  return <div className="aiToolGrid"><section><div className="aiSectionHead"><div><small>AI CAMPAIGN BUILDER</small><h2>Build a complete campaign</h2><p>Strategy, copy, audience direction, timing, CTA and follow-up.</p></div></div>
    <form className="aiToolForm" onSubmit={generate}>
      <label className="full">Campaign objective<textarea name="objective" rows="2" placeholder="e.g. Re-engage inactive customers this weekend" required/></label>
      <label>Offer / context<input name="offer" placeholder="Optional offer or event"/></label>
      <label>Audience hint<input name="audienceHint" placeholder="e.g. Previous buyers, rental leads"/></label>
      <label>Language<select name="language" defaultValue={status?.businessProfile?.preferredLanguage||'English'}>{LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Tone<select name="tone" defaultValue={status?.businessProfile?.brandTone||'Professional'}>{BRAND_TONES.map(x=><option key={x}>{x}</option>)}</select></label>
      <button className="primary full" disabled={busy}>{busy?'Building campaign…':'Generate campaign'}</button>
    </form><Notice type="bad">{err}</Notice></section>
    <section className="aiResultPanel">{busy?<Loader/>:result?<>
      <small>AI CAMPAIGN DRAFT</small><h2>{result.campaignName}</h2><p>{result.reasoningSummary}</p>
      <div className="aiResultStats"><span><small>Audience</small><b>{result.audienceRecommendation}</b></span><span><small>Suggested time</small><b>{result.recommendedSendTime}</b></span><span><small>CTA</small><b>{result.cta}</b></span></div>
      <div className="aiMessagePreview">{result.message}</div>
      <div className="aiAlternatives">{result.alternativeMessages?.map((m,i)=><button key={i} onClick={()=>setResult({...result,message:m})}>Alternative {i+1}</button>)}</div>
      <div className="aiActions"><button onClick={()=>navigator.clipboard?.writeText(result.message)}>Copy message</button><button className="primary" onClick={saveDraft}>Create WA SANTA draft</button></div>
    </>:<div className="aiEmpty">Describe a business objective and WA SANTA AI will build the campaign here.</div>}</section></div>
}

function MessageStudio({status,onCreated}){
  const[result,setResult]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function generate(e){
    e.preventDefault();setBusy(true);setErr('');
    try{const x=await api('/ai/messages',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setResult(x.messages)}
    catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function draft(m){
    try{
      const x=await api('/campaigns',{method:'POST',body:JSON.stringify({name:'AI message — '+result.purpose,message:m.body,audienceType:'all',contentType:'text'})});
      onCreated('Draft campaign created: '+x.name);
    }catch(e){setErr(e.message)}
  }
  return <div className="aiToolGrid"><section><div className="aiSectionHead"><div><small>MESSAGE STUDIO</small><h2>Generate message variations</h2><p>Get distinct copy options instead of repeatedly rewriting one message.</p></div></div>
    <form className="aiToolForm" onSubmit={generate}>
      <label className="full">Message purpose<textarea name="purpose" rows="2" required placeholder="e.g. Thank customers and invite them back with a weekend offer"/></label>
      <label className="full">Additional context<textarea name="context" rows="2" placeholder="Offer, product, deadline or constraints"/></label>
      <label>Language<select name="language" defaultValue={status?.businessProfile?.preferredLanguage||'English'}>{LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Tone<select name="tone" defaultValue={status?.businessProfile?.brandTone||'Professional'}>{BRAND_TONES.map(x=><option key={x}>{x}</option>)}</select></label>
      <button className="primary full" disabled={busy}>{busy?'Writing…':'Generate messages'}</button>
    </form><Notice type="bad">{err}</Notice></section>
    <section className="aiResultPanel">{busy?<Loader/>:result?<div className="aiMessageList">{result.messages.map((m,i)=><article key={i}><div><b>{m.label}</b><small>{m.tone}</small></div><p>{m.body}</p><footer><span>{m.cta}</span><div><button onClick={()=>navigator.clipboard?.writeText(m.body)}>Copy</button><button className="primary" onClick={()=>draft(m)}>Create draft</button></div></footer></article>)}</div>:<div className="aiEmpty">Your AI message options will appear here.</div>}</section></div>
}

function TemplateStudio({onCreated}){
  const[result,setResult]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const[profiles,setProfiles]=useState([]),[profileId,setProfileId]=useState('');
  useEffect(()=>{api('/integrations/whatsapp-connections').then(x=>{const m=(x.connections||[]).filter(p=>p.provider==='meta'&&p.enabled);setProfiles(m);if(!profileId&&m[0])setProfileId(m[0].id)}).catch(()=>{})},[]);
  async function generate(e){
    e.preventDefault();setBusy(true);setErr('');
    try{const x=await api('/ai/template',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setResult(x.template)}
    catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function save(){
    try{
      await api('/templates',{method:'POST',body:JSON.stringify({name:result.name,body:result.body,category:result.category,language:result.language})});
      onCreated('AI template saved locally.');
    }catch(e){setErr(e.message)}
  }
  async function submitMeta(){
    if(!profileId)return setErr('Choose a connected Meta WhatsApp profile first.');
    try{
      const bodyExamples=(result.variables||[]).map(v=>v.example);
      await api('/templates/meta/'+profileId,{method:'POST',body:JSON.stringify({
        name:result.name,
        metaTemplateName:result.name,
        body:result.body,
        category:result.category,
        language:result.language,
        bodyExamples
      })});
      onCreated('AI template submitted to Meta for review.');
    }catch(e){setErr(e.message)}
  }
  return <div className="aiToolGrid"><section><div className="aiSectionHead"><div><small>META TEMPLATE STUDIO</small><h2>Draft WhatsApp templates</h2><p>Generate a structured template draft for review before Meta submission.</p></div></div>
    <form className="aiToolForm" onSubmit={generate}>
      <label className="full">Template purpose<textarea name="purpose" rows="3" required placeholder="e.g. Appointment reminder for dental clinic one day before visit"/></label>
      <label>Category<select name="category" defaultValue="UTILITY"><option>MARKETING</option><option>UTILITY</option><option>AUTHENTICATION</option></select></label>
      <label>Meta language code<input name="language" defaultValue="en_US"/></label>
      <button className="primary full" disabled={busy}>{busy?'Drafting template…':'Generate template'}</button>
    </form><Notice type="bad">{err}</Notice></section>
    <section className="aiResultPanel">{busy?<Loader/>:result?<>
      <small>{result.category} · {result.language}</small><h2>{result.name}</h2><p>{result.reason}</p>
      <div className="aiMessagePreview">{result.body}</div>
      <div className="aiVariables">{result.variables?.map((v,i)=><span key={i}><b>{v.key}</b><small>{v.example}</small></span>)}</div>
      {!!profiles.length&&<label className="aiMetaProfileSelect">Submit using Meta profile<select value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">Choose profile</option>{profiles.map(p=><option value={p.id} key={p.id}>{p.name}{p.displayPhoneNumber?' · '+p.displayPhoneNumber:''}</option>)}</select></label>}
      <div className="aiActions"><button onClick={()=>navigator.clipboard?.writeText(result.body)}>Copy</button><button onClick={save}>Save local draft</button>{profiles.length>0&&<button className="primary" onClick={submitMeta}>Submit to Meta</button>}</div>
    </>:<div className="aiEmpty">Describe the use case and WA SANTA AI will generate a Meta-ready draft.</div>}</section></div>
}

function PerformanceAnalysis(){
  const[data,setData]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function run(){
    setBusy(true);setErr('');
    try{const x=await api('/ai/analysis',{method:'POST'});setData(x.analysis)}catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return <section className="aiAnalysis"><div className="aiSectionHead"><div><small>AI PERFORMANCE ANALYST</small><h2>Understand what to improve next</h2><p>Analysis is based on aggregate delivery/read/failure data and recent campaign outcomes—not customer PII.</p></div><button className="primary" onClick={run} disabled={busy}>{busy?'Analyzing…':'Analyze performance'}</button></div>
    <Notice type="bad">{err}</Notice>{busy?<Loader/>:data?<><div className="aiAnalysisSummary">{data.summary}</div><div className="aiAnalysisGrid"><div><h3>Findings</h3>{data.findings.map((x,i)=><p key={i}>• {x}</p>)}</div><div><h3>Opportunities</h3>{data.opportunities.map((x,i)=><p key={i}>• {x}</p>)}</div><div><h3>Risks</h3>{data.risks.map((x,i)=><p key={i}>• {x}</p>)}</div><div><h3>Next actions</h3>{data.actions.map((x,i)=><p key={i}>{i+1}. {x}</p>)}</div></div></>:<div className="aiEmpty">Run an analysis whenever you want an AI review of the last 30 days.</div>}
  </section>
}

function CopilotChat({onAction}){
  const[history,setHistory]=useState([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function send(e){
    e.preventDefault();const text=input.trim();if(!text)return;
    const next=[...history,{role:'user',content:text}];setHistory(next);setInput('');setBusy(true);setErr('');
    try{
      const x=await api('/ai/copilot',{method:'POST',body:JSON.stringify({message:text,history:history.slice(-6)})});
      setHistory([...next,{role:'assistant',content:x.reply.answer,actions:x.reply.actions}]);
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return <section className="aiChat"><div className="aiSectionHead"><div><small>ASK WA SANTA AI</small><h2>Your WhatsApp growth copilot</h2><p>Ask what to send, what to improve, or what campaign to run next.</p></div></div>
    <div className="aiChatStream">{!history.length&&<div className="aiChatWelcome"><b>Try asking:</b><button onClick={()=>setInput('What should I send to my customers this week?')}>What should I send this week?</button><button onClick={()=>setInput('Create a campaign to bring inactive customers back.')}>Create a re-engagement idea</button><button onClick={()=>setInput('What can I improve based on my campaign performance?')}>Analyze my performance</button></div>}
      {history.map((m,i)=><div className={'aiBubble '+m.role} key={i}><p>{m.content}</p>{m.actions?.length>0&&<div className="aiChatActions">{m.actions.filter(a=>a.type!=='none').map((a,j)=><button key={j} onClick={()=>onAction(a)}>{a.label}</button>)}</div>}</div>)}
      {busy&&<Loader text="Thinking…"/>}</div>
    <Notice type="bad">{err}</Notice>
    <form className="aiChatForm" onSubmit={send}><textarea rows="2" value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask WA SANTA AI…"/><button className="primary" disabled={busy}>Send</button></form>
  </section>
}

export default function AICopilot({go,session}){
  const[status,setStatus]=useState(null),[recommendations,setRecommendations]=useState(null),[tab,setTab]=useState('recommend'),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[err,setErr]=useState('');

  async function loadStatus(){
    try{const x=await api('/ai/status',{fresh:true});setStatus(x);return x}catch(e){setErr(e.message);return null}
  }
  async function loadRecommendations(refresh=false){
    setBusy(true);setErr('');
    try{const x=await api('/ai/recommendations'+(refresh?'?refresh=1':''),{fresh:refresh});setRecommendations(x)}
    catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  useEffect(()=>{loadStatus().then(x=>{if(x?.enabled&&x.profileComplete)loadRecommendations(false)})},[]);

  async function useRecommendation(x){
    setErr('');setMsg('');
    try{
      if(x.type==='campaign'){
        const y=await api('/campaigns',{method:'POST',body:JSON.stringify({name:x.title,message:x.message||x.reason,audienceType:'all',contentType:'text'})});
        setMsg('Campaign draft created: '+y.name);go('campaigns');return;
      }
      if(x.type==='template'){
        const name=x.title.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,80)||'ai_template';
        await api('/templates',{method:'POST',body:JSON.stringify({name,body:x.message||x.reason,category:x.templateCategory==='NONE'?'MARKETING':x.templateCategory,language:'en_US'})});
        setMsg('Template draft saved.');go('templates');return;
      }
      navigator.clipboard?.writeText(x.message||x.reason);setMsg('Recommended message copied.');
    }catch(e){setErr(e.message)}
  }
  function handleChatAction(a){
    if(a.type==='campaign')setTab('campaign');
    else if(a.type==='message')setTab('messages');
    else if(a.type==='template')setTab('template');
    else if(a.type==='analysis')setTab('analysis');
  }

  if(!status)return <div className="page"><Loader text="Preparing AI workspace…"/><Notice type="bad">{err}</Notice></div>;
  if(!status.enabled)return <div className="page"><div className="aiHero disabled"><div><span>WA SANTA AI</span><h1>AI Copilot</h1><p>OpenAI is not configured yet. A Super Admin must add the API key and models before AI features can run.</p></div>{session?.user?.isSuperAdmin&&<button className="primary" onClick={()=>go('admin')}>Open Super Admin</button>}</div></div>;

  return <div className="page aiPage">
    <div className="aiHero"><div><span>WA SANTA AI</span><h1>AI Campaign Copilot</h1><p>Business-aware recommendations, campaign strategy, message generation, Meta template drafts and performance analysis.</p></div><div className="aiModelPills"><span>Fast: {status.models.fast}</span><span>Strategy: {status.models.strategy}</span></div></div>
    <Notice>{msg}</Notice><Notice type="bad">{err}</Notice>
    <BusinessProfile status={status} onSaved={async()=>{const x=await loadStatus();if(x?.profileComplete)await loadRecommendations(true)}}/>
    <div className="aiTabs">{[['recommend','Recommendations'],['campaign','Campaign Builder'],['messages','Message Studio'],['template','Template Studio'],['analysis','Performance'],['chat','Ask AI']].map(([id,label])=><button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{label}</button>)}</div>

    {tab==='recommend'&&<section><div className="aiSectionHead"><div><small>NEXT BEST ACTIONS</small><h2>{recommendations?.recommendations?.headline||'Recommended for your business'}</h2><p>{recommendations?.recommendations?.summary||'Recommendations combine your business profile with aggregate WA SANTA performance.'}</p></div><button onClick={()=>loadRecommendations(true)} disabled={busy}>{busy?'Refreshing…':'Refresh recommendations'}</button></div>
      {!status.profileComplete?<Notice type="bad">Complete your AI business profile first.</Notice>:busy&&!recommendations?<Loader/>:<div className="aiRecommendationGrid">{recommendations?.recommendations?.recommendations?.map((x,i)=><RecommendationCard x={x} onUse={useRecommendation} key={i}/>)}</div>}
    </section>}
    {tab==='campaign'&&<CampaignBuilder status={status} onCreated={setMsg}/>}
    {tab==='messages'&&<MessageStudio status={status} onCreated={setMsg}/>}
    {tab==='template'&&<TemplateStudio onCreated={setMsg}/>}
    {tab==='analysis'&&<PerformanceAnalysis/>}
    {tab==='chat'&&<CopilotChat onAction={handleChatAction}/>}
    <div className="aiPrivacyNote">AI context uses business profile and aggregate workspace metrics. WA SANTA does not send contact names, phone numbers or email addresses to OpenAI for these recommendations.</div>
  </div>
}
