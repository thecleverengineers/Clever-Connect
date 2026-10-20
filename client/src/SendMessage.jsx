import React,{useEffect,useMemo,useState} from 'react';
import {api} from './api.js';
import './sendMessage.css';

const numberedVariables=body=>{
  const numbers=[...String(body||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(m=>Number(m[1]));
  return Math.min(20,Math.max(0,...numbers));
};
const substitute=(value,contact)=>String(value||'').replace(/{{\s*(name|phone|email)\s*}}/gi,(_,key)=>String(contact?.[key.toLowerCase()]||''));
const previewTemplate=(value,params,contact)=>substitute(String(value||'').replace(/{{\s*(\d+)\s*}}/g,(_,n)=>params[Number(n)-1]||'{{'+n+'}}'),contact);

export default function SendMessage({go}){
  const [tab,setTab]=useState('freeform');
  const [profiles,setProfiles]=useState([]);
  const [contacts,setContacts]=useState([]);
  const [templates,setTemplates]=useState([]);
  const [subscription,setSubscription]=useState(null);
  const [loading,setLoading]=useState(true);
  const [senderId,setSenderId]=useState('');
  const [recipientMode,setRecipientMode]=useState('contact');
  const [contactId,setContactId]=useState('');
  const [phone,setPhone]=useState('');
  const [consent,setConsent]=useState(false);
  const [message,setMessage]=useState('');
  const [templateId,setTemplateId]=useState('');
  const [params,setParams]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [uncertain,setUncertain]=useState(false);

  useEffect(()=>{
    let active=true;
    Promise.all([
      api('/integrations/whatsapp-connections',{fresh:true}),
      api('/contacts',{fresh:true}),
      api('/templates',{fresh:true})
    ]).then(([data,book,all])=>{
      if(!active)return;
      const senders=(data.connections||[]).filter(x=>x.provider==='meta');
      setProfiles(senders);
      setContacts(book||[]);
      setTemplates(all||[]);
      setSubscription(data.subscription||null);
      setSenderId(old=>old||senders.find(x=>x.enabled&&x.connectionStatus==='connected'&&x.planAllowed!==false&&data.subscription?.access?.allowed)?.id||'');
    }).catch(e=>{if(active)setError(e.message)})
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const sender=profiles.find(x=>x.id===senderId);
  const senderReady=!!sender&&sender.enabled&&sender.connectionStatus==='connected'&&sender.planAllowed!==false&&subscription?.access?.allowed;
  const opted=contacts.filter(x=>x.consentStatus==='opted_in'&&!x.suppressed);
  const recipient=recipientMode==='contact'?opted.find(x=>x._id===contactId):null;
  const recipientDetails={
    name:recipient?.name||'',
    phone:recipient?.phone||phone.trim()||'+91 ••••• •••••',
    email:recipient?.email||''
  };
  const approved=useMemo(()=>templates.filter(t=>t.metaStatus==='APPROVED'&&t.metaTemplateName&&
    t.category!=='AUTHENTICATION'&&String(t.integrationId?._id||t.integrationId||'')===senderId),[templates,senderId]);
  const chosen=approved.find(t=>t._id===templateId);
  const variableCount=chosen?numberedVariables(chosen.body):0;
  const personalParams=Array.from({length:variableCount},(_,i)=>substitute(params[i]||'',recipientDetails));
  const bodyText=tab==='template'
    ?chosen?previewTemplate(chosen.body,personalParams,recipientDetails):'Choose a Meta-approved template to preview it.'
    :substitute(message,recipientDetails)||'Write a personal WhatsApp message to preview it here.';
  const canSend=senderReady&&!busy&&!uncertain&&(recipientMode==='contact'?!!recipient:phone.trim().length>=8&&consent)&&
    (tab==='freeform'?message.trim().length>0&&message.trim().length<=4096:!!chosen&&Array.from({length:variableCount},(_,i)=>params[i]).every(x=>String(x||'').trim()));

  function switchTab(next){
    setTab(next);setError('');setSuccess('');
  }
  function senderChange(id){
    setSenderId(id);setTemplateId('');setParams([]);setError('');setSuccess('');
  }
  async function submit(e){
    e.preventDefault();
    if(!canSend)return;
    if(!window.confirm('Send '+(tab==='freeform'?'a FreeForm message':'the approved template '+chosen.name)+
      ' from '+(sender.displayPhoneNumber||sender.name)+' to '+(recipient?.name||phone)+'?'))return;
    setBusy(true);setError('');setSuccess('');
    const payload={
      sendMode:tab,integrationId:senderId,
      ...(recipientMode==='contact'?{contactId}:{phone:phone.trim(),consentConfirmed:consent}),
      ...(tab==='freeform'?{message:message.trim()}:
        {templateId,templateParams:Array.from({length:variableCount},(_,i)=>String(params[i]||'').trim())})
    };
    try{
      const result=await api('/campaigns/single/send',{method:'POST',body:JSON.stringify(payload)});
      setSuccess(result.status==='delivered'?'Delivery confirmed.':'Message submitted successfully. Track delivery status in Reports.');
      if(tab==='freeform')setMessage('');
      else setParams([]);
    }catch(err){
      const detail=err.message||'Unable to send';
      if(/acceptance is uncertain|may have been sent/i.test(detail))setUncertain(true);
      setError(detail);
    }finally{setBusy(false)}
  }

  return <div className="page singleSendPage">
    <div className="singleSendHeading">
      <div><span className="singleSendEyebrow">WHATSAPP MESSAGING</span><h1>Send Message</h1>
        <p>Send an individual message from your connected Meta WhatsApp number.</p></div>
      <button type="button" className="singleSendOutline" onClick={()=>go('inbox')}>Open Live Chat ↗</button>
    </div>
    <div className="singleSendTabs" role="tablist" aria-label="Message type">
      <button type="button" role="tab" aria-selected={tab==='freeform'} className={tab==='freeform'?'selected':''} onClick={()=>switchTab('freeform')}>
        <span aria-hidden="true">✎</span><span><b>FreeForm Message</b><small>Within the 24-hour customer window</small></span>
      </button>
      <button type="button" role="tab" aria-selected={tab==='template'} className={tab==='template'?'selected':''} onClick={()=>switchTab('template')}>
        <span aria-hidden="true">▤</span><span><b>Meta Approved Template</b><small>Approved business-initiated messages</small></span>
      </button>
    </div>
    {error&&<div className="singleSendAlert error" role="alert">{error}</div>}
    {success&&<div className="singleSendAlert success" role="status">{success}</div>}
    {uncertain&&<div className="singleSendAlert caution">Meta may already have accepted this message. Sending is disabled for this draft to prevent accidental duplicates. Review provider logs before another attempt.</div>}
    <div className="singleSendLayout">
      <form className="singleSendMain" onSubmit={submit}>
        <section className="singleSendCard">
          <div className="singleSendCardHeader"><span className="singleSendStep">01</span><div><h2>Sender Number</h2><p>Choose the connected WhatsApp Business number.</p></div></div>
          <label htmlFor="singleSender">WhatsApp account</label>
          <select id="singleSender" value={senderId} onChange={e=>senderChange(e.target.value)} disabled={loading}>
            <option value="">{loading?'Loading senders…':'Select WhatsApp sender'}</option>
            {profiles.map(x=><option key={x.id} value={x.id} disabled={!x.enabled||x.planAllowed===false||x.connectionStatus!=='connected'}>
              {x.name}{x.displayPhoneNumber?' · '+x.displayPhoneNumber:''}{x.planAllowed===false?' · Subscription limit':!x.enabled?' · Disabled':x.connectionStatus!=='connected'?' · Not connected':''}
            </option>)}
          </select>
          <div className="singleSendSubline">
            <span className={senderReady?'singleSendReady':'singleSendMuted'}>● {senderReady?'Ready to send':'Select an active, plan-entitled number'}</span>
            <button type="button" onClick={()=>go('whatsapp-api')}>Manage Numbers →</button>
          </div>
        </section>
        <section className="singleSendCard">
          <div className="singleSendCardHeader"><span className="singleSendStep">02</span><div><h2>Recipient</h2><p>Choose an opted-in contact or enter a number.</p></div></div>
          <div className="singleSendRecipientTabs" role="group" aria-label="Recipient source">
            <button type="button" className={recipientMode==='contact'?'selected':''} onClick={()=>{setRecipientMode('contact');setError('');setUncertain(false)}}>Address Book</button>
            <button type="button" className={recipientMode==='direct'?'selected':''} onClick={()=>{setRecipientMode('direct');setError('');setUncertain(false)}}>Direct Number</button>
          </div>
          {recipientMode==='contact'?<><label htmlFor="singleContact">Saved contact</label>
            <select id="singleContact" value={contactId} onChange={e=>{setContactId(e.target.value);setUncertain(false)}}>
              <option value="">Choose an opted-in contact</option>
              {opted.map(x=><option key={x._id} value={x._id}>{x.name||'Unnamed'} · {x.phone}</option>)}
            </select><small className="singleSendHelp">{opted.length} eligible contacts. Suppressed or non-consenting contacts are excluded.</small>
          </>:<><label htmlFor="singlePhone">Mobile number (with country code)</label>
            <input id="singlePhone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={e=>{setPhone(e.target.value);setUncertain(false)}}/>
            <label className="singleSendConsent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
              <span>I confirm that this recipient has explicitly opted in to WhatsApp messaging.</span></label>
          </>}
        </section>
        <section className="singleSendCard">
          <div className="singleSendCardHeader"><span className="singleSendStep">03</span>
            <div><h2>{tab==='freeform'?'Compose FreeForm Message':'Select Meta Approved Template'}</h2>
              <p>{tab==='freeform'?'Personalize a reply within an active customer conversation.':'Only approved templates belonging to the selected sender are available.'}</p></div></div>
          {tab==='freeform'?<>
            <div className="singleSendPolicy"><span>◷</span><div><b>24-hour customer service window</b><p>FreeForm messages are permitted only when the customer has messaged this sender within the last 24 hours. The server verifies this before sending.</p></div></div>
            <label htmlFor="singleMessage">Message</label>
            <textarea id="singleMessage" rows={6} maxLength={4096} placeholder="Type your reply… Use {{name}}, {{phone}} or {{email}}." value={message} onChange={e=>{setMessage(e.target.value);setUncertain(false)}}/>
            <div className="singleSendComposerFooter"><span>Use <code>{'{{name}}'}</code>, <code>{'{{phone}}'}</code> or <code>{'{{email}}'}</code> to personalize.</span><span>{message.length}/4096</span></div>
          </>:<>
            <label htmlFor="singleTemplate">Meta-approved template</label>
            <select id="singleTemplate" value={templateId} onChange={e=>{setTemplateId(e.target.value);setParams([]);setUncertain(false)}} disabled={!senderReady}>
              <option value="">Choose approved template</option>
              {approved.map(t=><option value={t._id} key={t._id}>{t.name} · {t.language} · {t.category}</option>)}
            </select>
            {senderReady&&!approved.length&&<div className="singleSendPolicy"><span>▤</span><div>
              <b>No approved templates for this sender</b><p>Templates must be submitted, approved by Meta, and synchronized for the chosen WhatsApp account.</p>
              <button type="button" onClick={()=>go('templates')}>Open Templates →</button></div></div>}
            {chosen&&<><div className="singleSendTemplateMeta"><span>✓ Meta approved</span><span>{chosen.category} · {chosen.language}</span></div>
              {Array.from({length:variableCount},(_,i)=><div className="singleSendVariable" key={i}>
                <label htmlFor={'singleVar'+i}>Variable {'{{'+(i+1)+'}}'}</label>
                <input id={'singleVar'+i} maxLength={1024} value={params[i]||''} placeholder={i===0?'{{name}}':'Enter variable value'} onChange={e=>{setParams(old=>Array.from({length:variableCount},(_,j)=>i===j?e.target.value:old[j]||''));setUncertain(false)}}/>
              </div>)}
            </>}
            <small className="singleSendHelp">Meta templates can start a new conversation outside the 24-hour window, subject to Meta policy and recipient consent.</small>
          </>}
        </section>
        <div className="singleSendActions">
          <button className="singleSendSubmit" type="submit" disabled={!canSend}>
            {busy?'Submitting to Meta…':tab==='freeform'?'➤  Send FreeForm Message':'➤  Send Approved Template'}
          </button>
          <small>Submitting does not guarantee delivery. Check the delivery receipt in Reports.</small>
        </div>
      </form>
      <aside className="singleSendAside">
        <div className="singleSendPreviewHead"><span>MESSAGE PREVIEW</span><b>● WhatsApp</b></div>
        <div className="singleSendPhone">
          <div className="singleSendPhoneBar"><span className="singleSendAvatar">☏</span><div><b>{sender?.name||'Your WhatsApp Business'}</b><small>{sender?.displayPhoneNumber||'Choose sender number'}</small></div></div>
          <div className="singleSendBubble">{bodyText.split('\n').map((line,i)=><React.Fragment key={i}>{i>0&&<br/>}{line||'\u00a0'}</React.Fragment>)}<small>Preview only</small></div>
          <div className="singleSendPreviewFooter">To: {recipient?.name||recipientDetails.phone}</div>
        </div>
        <div className="singleSendPreviewSummary">
          <h3>Message details</h3>
          <div><span>Type</span><b>{tab==='freeform'?'FreeForm':'Meta template'}</b></div>
          <div><span>Sender</span><b>{sender?.displayPhoneNumber||sender?.name||'Not selected'}</b></div>
          <div><span>Recipient</span><b>{recipient?.phone||phone||'Not selected'}</b></div>
          {tab==='template'&&<div><span>Template</span><b>{chosen?.name||'Not selected'}</b></div>}
          <div><span>Delivery</span><b>Send immediately</b></div>
        </div>
      </aside>
    </div>
  </div>;
}
