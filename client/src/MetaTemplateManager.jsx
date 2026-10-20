import React,{useEffect,useMemo,useState} from 'react';
import {api} from './api.js';
import './metaTemplateManager.css';

const NEW={name:'',metaTemplateName:'',language:'en_US',category:'UTILITY',body:'',
  headerFormat:'NONE',headerText:'',headerHandle:'',headerMediaUrl:'',footerText:'',
  bodyExamples:[],buttons:[]};
const statuses=['ALL','DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','UNKNOWN'];
const badgeText=v=>String(v||'DRAFT').replaceAll('_',' ');
const variableCount=body=>Math.min(20,Math.max(0,...[...String(body||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(x=>Number(x[1]))));
const preview=(body,values)=>String(body||'').replace(/{{\s*(\d+)\s*}}/g,(_,n)=>values?.[Number(n)-1]||'{{'+n+'}}');
const profileOf=t=>String(t.integrationId?._id||t.integrationId||'');
const editCopy=d=>({...NEW,...d,
  bodyExamples:Array.isArray(d.bodyExamples)?d.bodyExamples:[],
  buttons:(d.buttons||[]).map(x=>({...x}))});
const goodForSend=(t,profile)=>t.metaStatus==='APPROVED'&&!!t.metaTemplateId&&
  t.category!=='AUTHENTICATION'&&!!profile&&profile.enabled&&profile.planAllowed!==false&&
  profile.connectionStatus==='connected'&&
  (!['IMAGE','VIDEO','DOCUMENT'].includes(t.headerFormat)||!!t.headerMediaUrl);
function TemplatePreview({draft}){
  return <div className="mtmPreview">
    <div className="mtmPreviewHead">LIVE WHATSAPP PREVIEW <span>Sample customer · Alex</span></div>
    <div className="mtmPreviewWindow">
      <div className="mtmPreviewBubble">
        {draft.headerFormat==='TEXT'&&draft.headerText&&<b>{draft.headerText}</b>}
        {['IMAGE','VIDEO','DOCUMENT'].includes(draft.headerFormat)&&
          <div className="mtmPreviewMedia">{draft.headerFormat==='IMAGE'?'▧':draft.headerFormat==='VIDEO'?'▶':'▤'} {draft.headerFormat} HEADER
            {draft.headerMediaUrl&&draft.headerFormat==='IMAGE'&&<small>Media URL configured</small>}</div>}
        <div>{preview(draft.category==='AUTHENTICATION'?'Your verification code: 123456':draft.body||'Your template message preview appears here.',draft.bodyExamples)}</div>
        {draft.footerText&&<small className="mtmPreviewFooter">{draft.footerText}</small>}
        {(draft.buttons||[]).map((button,i)=><div className="mtmPreviewButton" key={i}>{button.type==='URL'?'↗':button.type==='PHONE_NUMBER'?'☎':'↩'} {button.text||'Button label'}</div>)}
      </div>
    </div>
    <small>Preview is illustrative. Meta reviews the template and may render its components differently.</small>
  </div>;
}
export default function MetaTemplateManager({go}){
  const [rows,setRows]=useState([]);
  const [profiles,setProfiles]=useState([]);
  const [profileId,setProfileId]=useState(()=>localStorage.getItem('wa:template-profile')||'');
  const [statusFilter,setStatusFilter]=useState('ALL');
  const [search,setSearch]=useState('');
  const [draft,setDraft]=useState(null);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [syncing,setSyncing]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [purpose,setPurpose]=useState('');
  const [recommendation,setRecommendation]=useState(null);
  const [loadingSuggestion,setLoadingSuggestion]=useState(false);
  const [busy,setBusy]=useState(true);
  async function load(){
    const [data,connectionData]=await Promise.all([
      api('/templates',{fresh:true}),api('/integrations/whatsapp-connections',{fresh:true})
    ]);
    setRows(data||[]);
    setProfiles((connectionData.connections||[]).filter(x=>x.provider==='meta'));
  }
  useEffect(()=>{let mounted=true;
    load().catch(e=>{if(mounted)setError(e.message)}).finally(()=>{if(mounted)setBusy(false)});
    return()=>{mounted=false};
  },[]);
  const profile=profiles.find(x=>x.id===profileId);
  const entitled=profile?.enabled&&profile?.planAllowed!==false&&profile?.connectionStatus==='connected';
  const senderNeedsAuthorization=profile?.enabled&&profile?.connectionStatus==='error';
  const filtered=useMemo(()=>rows.filter(t=>(!profileId||profileOf(t)===profileId)&&
    (statusFilter==='ALL'||String(t.metaStatus||'DRAFT')===statusFilter)&&
    (!search||[t.name,t.body,t.metaTemplateName,t.metaRejectedReason].some(x=>String(x||'').toLowerCase().includes(search.toLowerCase())))),[rows,profileId,statusFilter,search]);
  const availableStatuses=[...new Set([...statuses,...rows.map(x=>x.metaStatus||'DRAFT')])];
  const stat=key=>rows.filter(t=>(!profileId||profileOf(t)===profileId)&&t.metaStatus===key).length;
  const update=(key,value)=>setDraft(old=>({...old,[key]:value}));
  function newDraft(seed={}){
    if(!profileId){setError('Select a WhatsApp account before creating templates.');return}
    if(!entitled){setError('Select a connected WhatsApp account allowed by your subscription.');return}
    setError('');setMessage('');setDraft({...NEW,...seed,integrationId:profileId,_id:undefined,
      bodyExamples:seed.bodyExamples||[],buttons:seed.buttons||[]});
  }
  function edit(row){
    if(!['DRAFT','LOCAL','REJECTED'].includes(row.metaStatus)){
      setError('This template cannot be edited in its current Meta status. Create a new version instead.');return;
    }
    const id=profileOf(row);setProfileId(id);
    setError('');setMessage('');setDraft(editCopy(row));
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function save({submit=false,resubmit=false}={}){
    if(!draft)return;
    setSaving(true);setError('');setMessage('');
    const normalized={...draft,bodyExamples:Array.isArray(draft.bodyExamples)?draft.bodyExamples:[],
      metaTemplateName:draft.metaTemplateName||draft.name};
    try{
      let id=draft._id;
      if(id){
        const saved=await api('/templates/'+id,{method:'PUT',body:JSON.stringify(normalized)});
        id=saved._id;
      }else{
        const saved=await api('/templates',{method:'POST',body:JSON.stringify({...normalized,integrationId:profileId})});
        id=saved._id;
      }
      if(submit||resubmit){
        const route='/templates/'+id+'/'+(resubmit?'resubmit':'submit');
        const response=await api(route,{method:'POST'});
        setMessage('Meta submission accepted. Current review status: '+response.status+'. Sync to check for approval or rejection.');
      }else setMessage('Draft saved in Clever Connect. Nothing has been submitted to Meta.');
      setDraft(null);
      await load();
    }catch(e){setError(e.message)}
    finally{setSaving(false)}
  }
  async function sync(id){
    const ids=id?[id]:profiles.filter(p=>p.enabled&&p.planAllowed!==false).map(p=>p.id);
    if(!ids.length)return setError('Connect a WhatsApp account first');
    setSyncing(id||'all');setError('');setMessage('');
    try{
      const result=await Promise.allSettled(ids.map(x=>api('/templates/meta/'+x+'/sync',{method:'POST'})));
      let succeeded=0,completed=0;
      const warnings=[];
      for(const r of result){
        if(r.status==='rejected'){
          // Hide database internals and preserve a useful recovery path.
          const message=r.reason?.message||'Meta synchronization failed.';
          warnings.push(/E11000|duplicate key|Plan executor/i.test(message)
            ?'A template synchronization conflict occurred. Please retry Sync once.'
            :message);
        }else{
          succeeded+=r.value.synced||0;
          completed++;
          if(r.value.failed)warnings.push(...(r.value.warnings||['Some templates could not be synchronized.']));
        }
      }
      setMessage(succeeded+' template(s) synchronized from Meta across '+completed+' account(s).');
      if(warnings.length)setError(warnings.join(' • '));
      await load().catch(e=>setError(e.message));
    }finally{setSyncing('')}
  }
  async function remove(row){
    const remote=!!row.metaTemplateId;
    if(!window.confirm((remote?'Delete this template from Meta and Clever Connect?':'Delete this local draft?')+' This cannot be undone.'))return;
    setError('');setMessage('');
    try{
      await api('/templates/'+(remote?'meta/':'')+row._id,{method:'DELETE'});
      setMessage('Template deleted.');await load();
    }catch(e){setError(e.message)}
  }
  async function upload(e){
    const file=e.target.files?.[0];
    if(!file)return;
    if(!profileId)return setError('Select WhatsApp sender first');
    setUploading(true);setError('');
    const data=new FormData();data.append('file',file);
    try{
      const response=await api('/templates/meta/'+profileId+'/upload-header',{method:'POST',body:data});
      setDraft(old=>({...old,headerFormat:response.format,headerHandle:response.headerHandle}));
      setMessage('Sample file uploaded to Meta. Add a public HTTPS media URL for actual sends.');
    }catch(err){setError(err.message)}
    finally{setUploading(false);e.target.value=''}
  }
  async function suggest(){
    if(!profileId||!purpose.trim())return;
    setLoadingSuggestion(true);setError('');setRecommendation(null);
    try{
      const r=await api('/templates/recommend?integrationId='+encodeURIComponent(profileId)+'&q='+encodeURIComponent(purpose.trim()),{fresh:true});
      setRecommendation(r);
    }catch(e){setError(e.message)}finally{setLoadingSuggestion(false)}
  }
  function appendButton(){
    if(draft.buttons.length>=10)return;
    update('buttons',[...draft.buttons,{type:'QUICK_REPLY',text:'',url:'',phoneNumber:''}]);
  }
  function updateButton(i,key,value){
    update('buttons',draft.buttons.map((b,j)=>j===i?{...b,[key]:value}:b));
  }
  const maxVar=draft?variableCount(draft.body):0;
  return <div className="page mtmPage">
    <header className="mtmHeading">
      <div><span>META WHATSAPP MANAGER</span><h1>Template Manager</h1><p>Create, review and synchronize message templates for each connected WhatsApp Business Account.</p></div>
      <button className="primary" type="button" disabled={!entitled} onClick={()=>newDraft()}>+ Create Template</button>
    </header>
    {error&&<div className="mtmNotice bad" role="alert">{error}</div>}
    {message&&<div className="mtmNotice" role="status">{message}</div>}
    {senderNeedsAuthorization&&<div className="mtmNotice mtmSenderAuthNotice" role="status">
      <b>WhatsApp sending needs authorization.</b> Template synchronization can work with Meta management permission while message sending fails. Renew the selected sender's token with <code>whatsapp_business_messaging</code>, then test it under Numbers.
      <button type="button" onClick={()=>go('whatsapp-api')}>Manage sender →</button>
    </div>}
    <div className="mtmToolbar">
      <label>WhatsApp account<select value={profileId} onChange={e=>{setProfileId(e.target.value);localStorage.setItem('wa:template-profile',e.target.value);setRecommendation(null)}}>
        <option value="">All accounts</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.displayPhoneNumber||p.phoneNumberId}{p.planAllowed===false?' (plan limit)':''}</option>)}</select></label>
      <button type="button" disabled={!!syncing||!profiles.length} onClick={()=>sync(profileId)}>{syncing?'Syncing from Meta…':'↻ Sync '+(profileId?'Account':'All Accounts')}</button>
    </div>
    <div className="mtmKpis">
      {[['TOTAL',rows.filter(t=>!profileId||profileOf(t)===profileId).length],
        ['DRAFT',stat('DRAFT')+stat('LOCAL')],['PENDING',stat('PENDING')],['APPROVED',stat('APPROVED')],['REJECTED',stat('REJECTED')]].map(([label,value])=>
        <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
    </div>
    <section className="mtmSuggestion">
      <div><span>SMART TEMPLATE RECOMMENDATIONS</span><h2>Find the right template before creating one</h2><p>Match your message purpose with an existing approved template, or prepare a new draft for your review. Suggestions are never automatically submitted.</p></div>
      <div className="mtmSuggestionInput"><input placeholder="e.g. Confirm tomorrow’s service appointment" value={purpose} onChange={e=>setPurpose(e.target.value)} maxLength={160}/>
        <button type="button" disabled={!profileId||!purpose.trim()||loadingSuggestion} onClick={suggest}>{loadingSuggestion?'Searching…':'Find template'}</button></div>
      {recommendation&&<div className="mtmSuggestionResult">
        {recommendation.matches?.length?<><b>Matching approved templates</b>{recommendation.matches.map(x=><div key={x.id}><strong>{x.name}</strong><small>{x.body}</small><button type="button" onClick={()=>{setSearch(x.name);setStatusFilter('APPROVED')}}>View match →</button></div>)}</>:
          <><b>No suitable approved template found</b><p>Here is a draft suggestion. Review its wording, category, variables and policy compliance before saving or submitting.</p>
            <button type="button" onClick={()=>newDraft(recommendation.suggestedDraft||{})}>+ Review suggested draft</button></>}
      </div>}
    </section>

    {draft&&<section className="mtmEditor">
      <div className="mtmEditorHead"><div><small>{draft._id?'EDIT TEMPLATE':'NEW TEMPLATE'}</small><h2>{draft._id?'Edit '+draft.name:'Create Template'}</h2></div>
        <button type="button" onClick={()=>setDraft(null)}>Close ×</button></div>
      <div className="mtmEditorGrid">
        <div className="mtmFields">
          <div className="mtmPair"><label>Display name<input value={draft.name} onChange={e=>update('name',e.target.value)} maxLength={120} placeholder="Appointment reminder"/></label>
            <label>Meta template name<input value={draft.metaTemplateName||''} onChange={e=>update('metaTemplateName',e.target.value)} disabled={!!draft.metaTemplateId} placeholder="appointment_reminder"/></label></div>
          <div className="mtmPair"><label>Language<select value={draft.language} disabled={!!draft.metaTemplateId} onChange={e=>update('language',e.target.value)}>
            {['en_US','en_GB','hi','hi_IN','bn','ta','te','as','es','fr','pt_BR'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
            <label>Category<select value={draft.category} disabled={!!draft.metaTemplateId} onChange={e=>update('category',e.target.value)}>
              <option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select></label></div>
          {draft.category==='AUTHENTICATION'?<p className="mtmHelp">Authentication uses Meta’s predefined OTP body and Copy Code button. For other layouts, choose Utility or Marketing.</p>:<>
          <div className="mtmPair"><label>Header type<select value={draft.headerFormat} onChange={e=>update('headerFormat',e.target.value)}>
            {['NONE','TEXT','IMAGE','VIDEO','DOCUMENT'].map(x=><option key={x}>{x}</option>)}</select></label>
            {draft.headerFormat==='TEXT'&&<label>Header text<input maxLength={60} value={draft.headerText} onChange={e=>update('headerText',e.target.value)}/></label>}</div>
          {['IMAGE','VIDEO','DOCUMENT'].includes(draft.headerFormat)&&<div className="mtmMedia">
            <label>Upload a sample to Meta <input type="file" accept={draft.headerFormat==='IMAGE'?'.jpg,.jpeg,.png':draft.headerFormat==='VIDEO'?'.mp4':'.pdf'} onChange={upload} disabled={uploading}/></label>
            <small>{uploading?'Uploading to Meta…':draft.headerHandle?'Sample uploaded ✓':'Sample file must be uploaded to Meta for review'}</small>
            <label>Public HTTPS media URL for actual sends<input type="url" placeholder="https://cdn.example.com/image.jpg" value={draft.headerMediaUrl||''} onChange={e=>update('headerMediaUrl',e.target.value)}/></label>
            <small>Sample upload handles are for approval only. Actual sends use this public media URL.</small>
          </div>}
          <label>Message body<textarea rows={6} maxLength={1024} value={draft.body} placeholder="Hi {{1}}, your order {{2}} is ready." onChange={e=>update('body',e.target.value)}/></label>
          {maxVar>0&&<div className="mtmVariableFields"><b>Example values for Meta review</b>{Array.from({length:maxVar},(_,i)=><label key={i}>{'{{'+(i+1)+'}}'}<input value={draft.bodyExamples[i]||''} placeholder={i===0?'Alex':'Example value'} onChange={e=>update('bodyExamples',Array.from({length:maxVar},(_,j)=>j===i?e.target.value:draft.bodyExamples[j]||''))}/></label>)}</div>}
          <label>Footer (optional)<input maxLength={60} value={draft.footerText} onChange={e=>update('footerText',e.target.value)}/></label>
          <div className="mtmButtonBuilder"><div><b>Buttons</b><button type="button" disabled={draft.buttons.length>=10} onClick={appendButton}>+ Add button</button></div>
            {draft.buttons.map((b,i)=><div className="mtmButtonRow" key={i}>
              <select value={b.type} onChange={e=>updateButton(i,'type',e.target.value)}><option value="QUICK_REPLY">Quick reply</option><option value="URL">Website</option><option value="PHONE_NUMBER">Call phone</option></select>
              <input maxLength={25} placeholder="Button label" value={b.text||''} onChange={e=>updateButton(i,'text',e.target.value)}/>
              {b.type==='URL'&&<input value={b.url||''} placeholder="https://…" onChange={e=>updateButton(i,'url',e.target.value)}/>}
              {b.type==='PHONE_NUMBER'&&<input value={b.phoneNumber||''} placeholder="+91…" onChange={e=>updateButton(i,'phoneNumber',e.target.value)}/>}
              <button type="button" onClick={()=>update('buttons',draft.buttons.filter((_,j)=>j!==i))}>Remove</button>
            </div>)}</div>
          </>}
        </div>
        <TemplatePreview draft={draft}/>
      </div>
      <div className="mtmEditorActions">
        <button type="button" onClick={()=>save()} disabled={saving}>{saving?'Saving…':'Save draft'}</button>
        <button type="button" className="primary" disabled={saving||uploading} onClick={()=>save({submit:true,resubmit:draft.metaStatus==='REJECTED'})}>
          {saving?'Submitting…':draft.metaStatus==='REJECTED'?'Save & Resubmit for Meta Review':'Save & Submit to Meta'}
        </button>
        <small>Meta decides approval. A submitted template cannot be sent until Meta returns APPROVED.</small>
      </div>
    </section>}

    <section className="mtmList">
      <div className="mtmListHead"><div><h2>Templates</h2><p>{filtered.length} template(s) in this view</p></div>
        <div><input aria-label="Search templates" placeholder="Search templates" value={search} onChange={e=>setSearch(e.target.value)}/>
          <select aria-label="Filter template status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            {availableStatuses.map(s=><option key={s} value={s}>{s==='ALL'?'All statuses':badgeText(s)}</option>)}</select></div></div>
      {busy?<p>Loading templates…</p>:<div className="mtmCards">{filtered.map(row=>{
        const p=profiles.find(p=>p.id===profileOf(row));
        const usable=goodForSend(row,p);
        return <article key={row._id} className="mtmCard">
          <div className="mtmCardTop"><div><small>{row.category} · {row.language}</small><h3>{row.name}</h3></div>
            <span className={'mtmStatus mtm'+row.metaStatus}>{badgeText(row.metaStatus)}</span></div>
          <div className="mtmCardText">{row.headerFormat==='TEXT'&&<b>{row.headerText}</b>}
            {['IMAGE','VIDEO','DOCUMENT'].includes(row.headerFormat)&&<small>{row.headerFormat} header</small>}
            <p>{row.body||'Meta authentication template'}</p>
            {row.footerText&&<small>{row.footerText}</small>}
          </div>
          <div className="mtmCardMeta"><span><b>WhatsApp account</b>{p?.name||row.integrationId?.name||'Disconnected'}</span>
            <span><b>Meta name</b>{row.metaTemplateName||'—'}</span>
            <span><b>Last sync</b>{row.metaLastSyncedAt?new Date(row.metaLastSyncedAt).toLocaleString():'Not submitted'}</span></div>
          {row.metaRejectedReason&&<div className="mtmReject"><b>Meta rejection feedback</b><p>{row.metaRejectedReason}</p></div>}
          {row.metaStatus==='APPROVED'&&!usable&&<div className="mtmCardNote">Approved by Meta, but unavailable to send with this account or media configuration.</div>}
          {row.metaStatus==='APPROVED'&&usable&&<div className="mtmSendable">✓ Currently usable in Send Message</div>}
          <div className="mtmCardButtons">
            {['DRAFT','LOCAL','REJECTED'].includes(row.metaStatus)&&<button onClick={()=>edit(row)}>Edit {row.metaStatus==='REJECTED'?'& resubmit':'draft'}</button>}
            {['DRAFT','LOCAL'].includes(row.metaStatus)&&<button disabled={!entitled||profileOf(row)!==profileId} onClick={async()=>{setSaving(true);try{await api('/templates/'+row._id+'/submit',{method:'POST'});setMessage('Submitted to Meta for review.');await load()}catch(e){setError(e.message)}finally{setSaving(false)}}}>Submit to Meta</button>}
            <button onClick={()=>remove(row)} className="danger">Delete</button>
          </div>
        </article>;
      })}{!filtered.length&&<div className="mtmEmpty">No templates match your filters. Create a draft or synchronize a connected WhatsApp account.</div>}</div>}
    </section>
  </div>;
}
