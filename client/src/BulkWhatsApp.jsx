import React,{useEffect,useMemo,useState} from 'react';
import {api} from './api.js';
import {canonicalPhone,splitManualNumbers,parsePhoneCsv,matchConsentedNumbers} from './bulkRecipients.js';
import './bulkWhatsapp.css';

const localDatetime=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
const displayNumber=n=>Number(n||0).toLocaleString('en-IN');

function Preview({template,values,recipientCount,sender}){
  const sample=String(template?.body||'Select an approved WhatsApp template to see its preview.');
  const content=sample.replace(/{{\s*(\d+)\s*}}/g,(_,n)=>values[Number(n)-1]||'{{'+n+'}}')
    .replace(/{{\s*name\s*}}/gi,'Customer').replace(/{{\s*phone\s*}}/gi,'+91••••••••••');
  return <div className="bwPreview">
    <div className="bwPreviewHeader"><span>◉</span><div><b>{sender?.name||'Your WhatsApp Business'}</b><small>Template preview · not a sent message</small></div></div>
    <div className="bwMessageBubble">{content.split('\n').map((line,i)=><React.Fragment key={i}>{i>0&&<br/>}{line||'\u00a0'}</React.Fragment>)}<small>9:41 ✓✓</small></div>
    <div className="bwPreviewFooter"><span>◷</span> {displayNumber(recipientCount)} eligible recipients · Delivery subject to Meta acceptance and policies</div>
  </div>;
}

export default function BulkWhatsApp({go}){
  const [profiles,setProfiles]=useState([]);
  const [subscription,setSubscription]=useState(null);
  const [contacts,setContacts]=useState([]);
  const [templates,setTemplates]=useState([]);
  const [senderId,setSenderId]=useState('');
  const [mode,setMode]=useState('numbers');
  const [manual,setManual]=useState('');
  const [addressSearch,setAddressSearch]=useState('');
  const [selected,setSelected]=useState([]);
  const [csvNumbers,setCsvNumbers]=useState([]);
  const [csvName,setCsvName]=useState('');
  const [templateId,setTemplateId]=useState('');
  const [variables,setVariables]=useState([]);
  const [campaignName,setCampaignName]=useState('');
  const [scheduledAt,setScheduledAt]=useState('');
  const [showSchedule,setShowSchedule]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [createdId,setCreatedId]=useState('');
  useEffect(()=>{
    let active=true;
    Promise.all([api('/integrations/whatsapp-connections',{fresh:true}),api('/contacts',{fresh:true}),api('/templates',{fresh:true})])
      .then(([connections,book,allTemplates])=>{
        if(!active)return;
        setProfiles((connections.connections||[]).filter(p=>p.provider==='meta'));
        setSubscription(connections.subscription||null);
        setContacts(book||[]);
        setTemplates(allTemplates||[]);
      }).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const sender=profiles.find(p=>p.id===senderId);
  const senderReady=sender&&sender.enabled&&sender.connectionStatus==='connected'&&sender.planAllowed!==false;
  const senderTemplates=useMemo(()=>templates.filter(t=>{
    return t.metaStatus==='APPROVED'&&t.metaTemplateName&&t.category!=='AUTHENTICATION'&&
      String(t.integrationId?._id||t.integrationId||'')===senderId;
  }),[templates,senderId]);
  const chosenTemplate=senderTemplates.find(t=>t._id===templateId);
  const required=chosenTemplate?[...String(chosenTemplate.body||'').matchAll(/{{\s*(\d+)\s*}}/g)]
    .reduce((max,m)=>Math.max(max,Number(m[1])),0):0;

  const ready=useMemo(()=>{
    if(mode==='address'){
      const index=new Set(selected);
      const accepted=contacts.filter(c=>index.has(c._id)&&c.consentStatus==='opted_in'&&!c.suppressed);
      return {accepted,rejected:[],duplicate:0,unique:accepted.length};
    }
    return matchConsentedNumbers(mode==='numbers'?splitManualNumbers(manual):csvNumbers,contacts);
  },[mode,selected,contacts,manual,csvNumbers]);

  const addressMatches=useMemo(()=>{
    const q=addressSearch.trim().toLowerCase();
    return contacts.filter(c=>!q||[c.name,c.phone,c.email].some(s=>String(s||'').toLowerCase().includes(q))).slice(0,100);
  },[contacts,addressSearch]);
  const optInCount=contacts.filter(c=>c.consentStatus==='opted_in'&&!c.suppressed).length;

  function changeSender(id){
    setSenderId(id);setTemplateId('');setVariables([]);setError('');setCreatedId('');
  }
  function changeTemplate(id){
    setTemplateId(id);setVariables([]);setError('');setCreatedId('');
  }
  function toggle(id){
    setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
    setCreatedId('');
  }
  async function loadCsv(file){
    if(!file)return;
    setError('');setCsvNumbers([]);setCsvName('');
    if(!/\.csv$/i.test(file.name)){setError('Please upload a .csv file. You can import Excel in Contacts first.');return}
    if(file.size>5*1024*1024){setError('CSV file must be 5 MB or smaller.');return}
    try{
      const parsed=parsePhoneCsv(await file.text());
      setCsvNumbers(parsed);setCsvName(file.name);setCreatedId('');
    }catch(e){setError(e.message)}
  }

  async function submit(e){
    e.preventDefault();
    if(busy||createdId)return;
    setError('');setNotice('');
    if(!subscription?.access?.allowed)return setError('An active trial or subscription is required.');
    if(!senderReady)return setError('Choose a connected WhatsApp sender within your plan allowance.');
    if(!chosenTemplate)return setError('Choose a Meta-approved template for this sender.');
    if(!ready.accepted.length)return setError('Select at least one saved, opted-in contact.');
    if(ready.accepted.length>5000)return setError('Limit this bulk send to 5,000 recipients per campaign.');
    if(variables.length<required||Array.from({length:required},(_,i)=>variables[i]).some(x=>!String(x||'').trim()))
      return setError('Fill in all '+required+' template variable(s).');
    if(showSchedule&&(!scheduledAt||new Date(scheduledAt).getTime()<=Date.now()))
      return setError('Choose a future schedule date and time.');
    const label=campaignName.trim()||'Bulk WhatsApp · '+new Date().toLocaleString();
    const prompt='Confirm '+(showSchedule?'scheduling':'sending')+' to '+ready.accepted.length+' opted-in contacts from '+sender.name+
      '?\nTemplate: '+chosenTemplate.name+(ready.rejected.length?'\n'+ready.rejected.length+' unmatched or non-consented numbers will be excluded.':'');
    if(!window.confirm(prompt))return;
    setBusy(true);
    let id='';
    try{
      const payload={
        name:label,sendMode:'template',integrationId:senderId,templateId:templateId,
        templateParams:Array.from({length:required},(_,i)=>variables[i].trim()),
        audienceType:'contacts',contactIds:ready.accepted.map(c=>c._id),
        ...(showSchedule?{scheduledAt:new Date(scheduledAt).toISOString()}:{})
      };
      const campaign=await api('/campaigns',{method:'POST',body:JSON.stringify(payload)});
      id=campaign._id;setCreatedId(id);
      if(!showSchedule)await api('/campaigns/'+id+'/send',{method:'POST'});
      setNotice(showSchedule?'Campaign scheduled. You can monitor it under Campaigns.':'Campaign accepted for processing. Track delivery under Campaigns and Reports.');
    }catch(e){
      setError(id?'Campaign #'+id+' was created, but starting delivery failed: '+e.message+'. Open Campaigns to inspect it; do not create another copy.':e.message);
    }finally{setBusy(false)}
  }

  return <div className="page bulkWhatsApp">
    <div className="bwHeading"><div><div className="bwEyebrow"><span>◉</span> WHATSAPP CAMPAIGN STUDIO</div><h1>Bulk WhatsApp</h1><p>One simple workflow for approved WhatsApp templates, consented contacts and scheduled campaigns.</p></div>
      <button type="button" className="bwOutline" onClick={()=>go('campaigns')}>View campaigns ↗</button></div>
    {loading&&<div className="bwNotice">Loading WhatsApp senders, contacts and approved templates…</div>}
    {!!error&&<div className="bwNotice bwError" role="alert">{error}</div>}
    {!!notice&&<div className="bwNotice bwSuccess" role="status">{notice} <button type="button" onClick={()=>go('campaigns')}>Open campaigns →</button></div>}

    <form className="bwLayout" onSubmit={submit}>
      <div className="bwMain">
        <section className="bwCard">
          <div className="bwCardHeader"><span className="bwStep">01</span><div><h2>Sending account</h2><p>Select the number your recipients will see.</p></div><span className="bwHeaderIcon">☏</span></div>
          <label className="bwLabel" htmlFor="bwSender">WhatsApp sender</label>
          <select id="bwSender" value={senderId} onChange={e=>changeSender(e.target.value)} required>
            <option value="">Choose sender number</option>
            {profiles.map(p=><option key={p.id} value={p.id} disabled={!p.enabled||p.connectionStatus!=='connected'||p.planAllowed===false}>
              {p.name}{p.displayPhoneNumber?' · '+p.displayPhoneNumber:''}{p.planAllowed===false?' · Plan limit':p.connectionStatus!=='connected'?' · Needs attention':''}
            </option>)}
          </select>
          <div className="bwAccountFoot"><span className={subscription?.access?.allowed?'bwBadge':'bwBadge bwBadgeMuted'}>● {subscription?.access?.allowed?'Active subscription':'Subscription inactive'}</span>
            <span>{displayNumber(subscription?.used)} / {displayNumber(subscription?.max)} connected numbers</span>
            <button type="button" onClick={()=>go('whatsapp-api')}>Manage accounts ↗</button></div>
          {!profiles.length&&!loading&&<div className="bwInlineAlert">No Meta numbers connected. <button type="button" onClick={()=>go('whatsapp-api')}>Connect an account →</button></div>}
        </section>

        <section className="bwCard">
          <div className="bwCardHeader"><span className="bwStep">02</span><div><h2>Recipients</h2><p>Choose contacts you have permission to message.</p></div><span className="bwHeaderIcon">◎</span></div>
          <div className="bwModeTabs" role="tablist" aria-label="Recipient source">
            {[['numbers','List of numbers','☷'],['address','Address book','♙'],['csv','CSV file','⇧']].map(([id,title,icon])=>
              <button key={id} type="button" role="tab" aria-selected={mode===id} className={mode===id?'active':''}
                onClick={()=>{setMode(id);setError('');setCreatedId('')}}><span>{icon}</span>{title}</button>)}
          </div>
          {mode==='numbers'&&<div className="bwRecipientArea">
            <label className="bwLabel" htmlFor="bwManual">Mobile numbers</label>
            <textarea id="bwManual" rows={5} value={manual} onChange={e=>{setManual(e.target.value);setCreatedId('')}} placeholder={'+919876543210\n+919876543211\n+919876543212'}/>
            <small>One international number per line, or separate with commas. Only matching saved contacts with recorded opt-in can receive messages.</small>
          </div>}
          {mode==='address'&&<div className="bwRecipientArea">
            <label className="bwLabel" htmlFor="bwSearch">Find contacts</label>
            <input id="bwSearch" value={addressSearch} onChange={e=>setAddressSearch(e.target.value)} placeholder="Search by name, phone or email"/>
            <div className="bwBookTools"><span>{selected.length} selected · {optInCount} opted in</span>
              <button type="button" onClick={()=>{const ids=addressMatches.filter(c=>c.consentStatus==='opted_in'&&!c.suppressed).map(c=>c._id);setSelected(old=>[...new Set([...old,...ids])])}}>Select visible</button>
              <button type="button" onClick={()=>setSelected([])}>Clear</button>
            </div>
            <div className="bwBook">{addressMatches.map(c=><label className="bwContact" key={c._id}>
              <input type="checkbox" checked={selected.includes(c._id)} disabled={c.consentStatus!=='opted_in'||c.suppressed} onChange={()=>toggle(c._id)}/>
              <span className="bwContactAvatar">{(c.name||c.phone||'?').charAt(0).toUpperCase()}</span>
              <span className="bwContactInfo"><b>{c.name||'Unnamed contact'}</b><small>{c.phone}</small></span>
              <span className={c.consentStatus==='opted_in'&&!c.suppressed?'bwContactReady':'bwContactBlocked'}>{c.consentStatus==='opted_in'&&!c.suppressed?'Opted in':'Not eligible'}</span>
            </label>)}{!addressMatches.length&&<div className="bwEmpty">No matching contacts. Import contacts with documented consent in the Contacts module.</div>}</div>
          </div>}
          {mode==='csv'&&<div className="bwRecipientArea">
            <label className="bwLabel" htmlFor="bwCsv">Upload CSV with a phone or mobile column</label>
            <label className="bwDrop" htmlFor="bwCsv"><span>⇧</span><strong>{csvName||'Choose a CSV file'}</strong><small>CSV · max 5 MB · up to 5,000 numbers</small>
              <input id="bwCsv" type="file" accept=".csv,text/csv" onChange={e=>loadCsv(e.target.files?.[0])}/></label>
            <small>Numbers are matched against your saved consented contacts. CSV upload here does not automatically import unknown contacts or grant consent.</small>
            <button type="button" className="bwTextAction" onClick={()=>go('contacts')}>Need to import new contacts first? Open Contacts →</button>
          </div>}
          <div className="bwRecipientSummary"><div><strong>{displayNumber(ready.accepted.length)}</strong><span>Ready to send</span></div><div><strong>{displayNumber(ready.rejected.length)}</strong><span>Excluded</span></div><div><strong>{displayNumber(ready.duplicate)}</strong><span>Duplicates removed</span></div></div>
          {ready.rejected.length>0&&<div className="bwInlineAlert">Only verified opted-in contacts will be included. {ready.rejected.slice(0,3).map(x=>x.reason).join(' · ')}{ready.rejected.length>3?' · +more':''}.</div>}
        </section>

        <section className="bwCard">
          <div className="bwCardHeader"><span className="bwStep">03</span><div><h2>Message template</h2><p>Business-initiated sends require an approved Meta template.</p></div><span className="bwHeaderIcon">▤</span></div>
          <label className="bwLabel" htmlFor="bwTemplate">Approved WhatsApp template</label>
          <select id="bwTemplate" value={templateId} disabled={!senderReady} onChange={e=>changeTemplate(e.target.value)} required>
            <option value="">Select message template</option>
            {senderTemplates.map(t=><option key={t._id} value={t._id}>{t.name} · {t.language} · {t.category}</option>)}
          </select>
          {senderReady&&!senderTemplates.length&&<div className="bwInlineAlert">This sender has no approved templates. <button type="button" onClick={()=>go('templates')}>Manage templates →</button></div>}
          {!!chosenTemplate&&<div className="bwTemplateDetails"><span className="bwBadge">✓ Approved by Meta</span><span>{chosenTemplate.category} · {chosenTemplate.language}</span></div>}
          {!!chosenTemplate&&Array.from({length:required},(_,i)=><label className="bwVariable" key={i}>Variable {'{{'+(i+1)+'}}'} <small>Use {'{{name}}'}, {'{{phone}}'} or {'{{email}}'} for personalization</small>
            <input maxLength={1024} value={variables[i]||''} onChange={e=>setVariables(old=>Array.from({length:required},(_,j)=>i===j?e.target.value:old[j]||''))} placeholder={i===0?'{{name}}':'Value for '+(i+1)} required/>
          </label>)}
          <label className="bwLabel" htmlFor="bwName">Campaign name <small>Optional</small></label>
          <input id="bwName" maxLength={140} value={campaignName} onChange={e=>setCampaignName(e.target.value)} placeholder="e.g. October customer update"/>
        </section>

        <section className="bwCard">
          <div className="bwCardHeader"><span className="bwStep">04</span><div><h2>Delivery</h2><p>Send now or schedule for a later date.</p></div><span className="bwHeaderIcon">◷</span></div>
          <div className="bwDeliveryChoice">
            <button type="button" className={!showSchedule?'active':''} onClick={()=>setShowSchedule(false)}>➤ &nbsp; Send now</button>
            <button type="button" className={showSchedule?'active':''} onClick={()=>setShowSchedule(true)}>◷ &nbsp; Schedule</button>
          </div>
          {showSchedule&&<label className="bwVariable">Send date & time (your local timezone)
            <input type="datetime-local" min={localDatetime()} value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)} required/>
          </label>}
          <div className="bwDisclaimer">Messages send through Meta Cloud API. Recipient consent, template approval, messaging allowances and provider delivery limits are enforced. Delivered and read confirmations appear in campaign reports.</div>
          <button className="bwSubmit" disabled={loading||busy||!!createdId||!senderReady||!chosenTemplate||!ready.accepted.length||!subscription?.access?.allowed}>
            {busy?'Preparing campaign…':createdId?'Campaign created ✓':showSchedule?'Schedule campaign →':'Send campaign →'}
          </button>
          {createdId&&<button type="button" className="bwViewCreated" onClick={()=>go('campaigns')}>View saved campaign →</button>}
        </section>
      </div>

      <aside className="bwSide">
        <div className="bwSidePanel"><div className="bwSideTitle"><span>LIVE PREVIEW</span><span className="bwPreviewMark">● &nbsp; WhatsApp</span></div>
          <Preview template={chosenTemplate} values={variables} sender={sender} recipientCount={ready.accepted.length}/>
          <div className="bwSideDivider"/>
          <h3>Campaign summary</h3>
          <div className="bwSummaryLine"><span>Sender</span><b>{sender?.displayPhoneNumber||sender?.name||'Not selected'}</b></div>
          <div className="bwSummaryLine"><span>Audience</span><b>{displayNumber(ready.accepted.length)} eligible</b></div>
          <div className="bwSummaryLine"><span>Template</span><b>{chosenTemplate?.name||'Not selected'}</b></div>
          <div className="bwSummaryLine"><span>Delivery</span><b>{showSchedule&&scheduledAt?new Date(scheduledAt).toLocaleString():'Send immediately'}</b></div>
          <div className="bwSummaryLine"><span>Plan allowance</span><b>{displayNumber(subscription?.max)} sender(s)</b></div>
          <small className="bwSideFine">Monthly message limits are shared across the workspace; Meta delivery fees and rules are separate from platform allowances.</small>
        </div>
      </aside>
    </form>
  </div>;
}
