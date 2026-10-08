import React,{useEffect,useMemo,useRef,useState} from 'react';
import {api} from './api.js';
import './payments.css';

const inr=paise=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format((Number(paise)||0)/100);
const phoneDigits=v=>String(v||'').replace(/\D/g,'');
const when=x=>x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const gatewayUrl='https://business.facebook.com/wa/manage';

export default function Payments({session,go}){
  const [profiles,setProfiles]=useState([]);
  const [contacts,setContacts]=useState([]);
  const [orders,setOrders]=useState([]);
  const [windows,setWindows]=useState([]);
  const [profileId,setProfileId]=useState('');
  const [configName,setConfigName]=useState('');
  const [confirmLinked,setConfirmLinked]=useState(false);
  const [contactId,setContactId]=useState('');
  const [title,setTitle]=useState('');
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [info,setInfo]=useState('');
  const token=useRef(null);
  const canManage=['owner','admin'].includes(session?.user?.role)||session?.user?.isSuperAdmin;
  const makeToken=()=>globalThis.crypto?.randomUUID?.()||('a'+Math.random().toString(16).slice(2)+Date.now().toString(16));
  const selected=profiles.find(p=>p.integrationId===profileId);
  const eligible=useMemo(()=>{
    const active=new Set(windows.map(w=>phoneDigits(w.phone)));
    return contacts.filter(c=>c.consentStatus==='opted_in'&&!c.suppressed&&active.has(phoneDigits(c.phone)));
  },[windows,contacts]);

  async function refresh(){
    const [p,c,o]=await Promise.all([
      api('/payments/configs',{fresh:true}),api('/contacts'),api('/payments/orders',{fresh:true})
    ]);
    setProfiles(p);setContacts(c);setOrders(o);
    setProfileId(old=>p.some(x=>x.integrationId===old)?old:(p[0]?.integrationId||''));
  }
  useEffect(()=>{
    let alive=true;
    Promise.all([api('/payments/configs'),api('/contacts'),api('/payments/orders')])
      .then(([p,c,o])=>{if(!alive)return;setProfiles(p);setContacts(c);setOrders(o);setProfileId(p[0]?.integrationId||'')})
      .catch(e=>{if(alive)setError(e.message)})
      .finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};
  },[]);
  useEffect(()=>{
    const p=profiles.find(x=>x.integrationId===profileId);
    setConfigName(p?.paymentConfig?.configurationName||'');
    setConfirmLinked(false);setContactId('');setWindows([]);
    if(!profileId)return;
    let active=true;
    api('/payments/window?integrationId='+encodeURIComponent(profileId),{fresh:true})
      .then(x=>{if(active)setWindows(x.windows||[])})
      .catch(e=>{if(active)setError(e.message)});
    return()=>{active=false};
  },[profileId,profiles.map(p=>p.integrationId).join('|')]);

  async function saveConfig(e){
    e.preventDefault();if(!selected||busy)return;
    setBusy(true);setError('');setInfo('');
    try{
      await api('/payments/configs/'+selected.integrationId,{
        method:'PUT',body:JSON.stringify({configurationName:configName,confirmLinked,enabled:true})
      });
      await refresh();
      setInfo('Razorpay payment configuration saved for '+selected.name+'. Send a test order to verify Meta checkout is enabled.');
      setConfirmLinked(false);
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  }

  async function sendOrder(e){
    e.preventDefault();if(busy)return;
    const form=e.currentTarget;
    setBusy(true);setError('');setInfo('');
    token.current||=makeToken();
    try{
      const result=await api('/payments/orders/send',{
        method:'POST',body:JSON.stringify({
          integrationId:profileId,contactId,title:title.trim(),amountRupees:Number(amount),
          idempotencyKey:token.current
        })
      });
      token.current=null;
      await refresh();
      setTitle('');setAmount('');
      setInfo(result.duplicate?'This payment request already exists; nothing was sent twice.':'Review & Pay request submitted to Meta. Confirm the payment using Verify status.');
      form?.querySelector('input[name="title"]')?.focus();
    }catch(e){setError(e.message+' If Meta timed out, check the transaction before sending again.')}
    finally{setBusy(false)}
  }

  async function verifyOrder(order){
    if(busy)return;
    setBusy(true);setError('');setInfo('');
    try{
      const result=await api('/payments/orders/'+order._id+'/verify',{method:'POST'});
      await refresh();
      setInfo('Verified '+result.order.referenceId+' with Meta: '+result.order.status+'.');
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  }

  const live=orders.filter(o=>o.status==='captured');
  return <div className="page waPayments">
    <div className="title"><div><span>WA SANTA · COMMERCE</span><h1>WhatsApp Payments</h1>
      <p>Collect INR payments through Meta's native Review & Pay checkout, powered by each business's own Razorpay account.</p>
    </div></div>
    {error&&<div className="notice bad" role="alert">{error}</div>}
    {info&&<div className="notice" role="status">{info}</div>}
    <div className="metrics">
      <div className="metric"><span>Checkout requests</span><strong>{orders.length}</strong><small>Most recent 200</small></div>
      <div className="metric"><span>Verified paid</span><strong>{live.length}</strong><small>Confirmed through Meta lookup</small></div>
      <div className="metric"><span>Verified amount</span><strong>{inr(live.reduce((n,o)=>n+o.amountPaise,0))}</strong><small>No payments held by WA SANTA</small></div>
    </div>
    {loading?<div className="loading">Loading payment settings…</div>:<>
      <div className="paymentGrid">
        <section>
          <div className="sectionHead"><div><h2>1 · Connect Razorpay</h2><p>Configure payments separately for every Meta WhatsApp profile.</p></div></div>
          {!profiles.length?<div className="empty">Connect a Meta WhatsApp API profile first. <button onClick={()=>go('whatsapp-api')}>Open Meta connections</button></div>:<>
            <label className="paymentField">Meta WhatsApp profile
              <select value={profileId} onChange={e=>setProfileId(e.target.value)}>
                {profiles.map(p=><option key={p.integrationId} value={p.integrationId}>{p.name} · {p.phone}</option>)}
              </select>
            </label>
            <div className="paymentStatus"><span className={selected?.connected?'dot ok':'dot'}></span>
              {selected?.connected?'Meta profile connected':'Meta profile needs attention'}
              <small>{selected?.paymentConfig?' · Razorpay configuration saved':' · Razorpay not configured'}</small>
            </div>
            <p className="paymentHelp">In WhatsApp Manager, open <b>Account tools → Payment configurations → India</b>, connect Razorpay using the business's own merchant account, then enter that exact configuration name below.</p>
            <a href={gatewayUrl} target="_blank" rel="noopener noreferrer" className="paymentLink">Open WhatsApp Manager ↗</a>
            <form onSubmit={saveConfig} className="paymentForm">
              <label className="paymentField">Payment configuration name
                <input value={configName} onChange={e=>setConfigName(e.target.value)} placeholder="Example: my-razorpay-config" maxLength="60" required disabled={!canManage}/>
              </label>
              <label className="check paymentCheck"><input type="checkbox" checked={confirmLinked} onChange={e=>setConfirmLinked(e.target.checked)} disabled={!canManage}/> I confirm this configuration is linked to my own Razorpay account in WhatsApp Manager.</label>
              <button className="primary" disabled={!canManage||!selected?.connected||!confirmLinked||busy}>Save Razorpay configuration</button>
              {!canManage&&<small>Only a workspace owner or admin can change payment settings.</small>}
            </form>
          </>}
        </section>
        <section>
          <div className="sectionHead"><div><h2>2 · Request payment</h2><p>Send an itemised Review & Pay card to a consented customer.</p></div></div>
          <form className="paymentForm" onSubmit={sendOrder}>
            <label className="paymentField">Customer with an active 24-hour conversation
              <select value={contactId} onChange={e=>setContactId(e.target.value)} required>
                <option value="">Choose eligible contact</option>
                {eligible.map(c=><option key={c._id} value={c._id}>{c.name||c.phone} · {c.phone}</option>)}
              </select>
            </label>
            <label className="paymentField">Item / invoice title
              <input name="title" value={title} onChange={e=>{setTitle(e.target.value);token.current=null}} maxLength="120" placeholder="Website development invoice" required/>
            </label>
            <label className="paymentField">Amount (INR)
              <input type="number" inputMode="decimal" min="1" max="1000000" step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);token.current=null}} placeholder="2499.00" required/>
            </label>
            <button className="primary" disabled={busy||!selected?.connected||!selected.paymentConfig?.enabled||!eligible.some(c=>c._id===contactId)||!title.trim()||!amount}>
              {busy?'Processing…':'Send Review & Pay'}
            </button>
          </form>
          {selected&&!selected.paymentConfig&&<p className="paymentHint">Save the Razorpay configuration before sending a checkout.</p>}
          {selected&&eligible.length===0&&<p className="paymentHint">No currently eligible contacts. The customer must message this WhatsApp number, and be recorded as opted in, before a free-form checkout can be sent.</p>}
          <p className="paymentHelp">Free-form checkout is limited to the 24-hour service window. Outside it, Meta requires an approved order-details template. The current checkout form supports digital goods and services.</p>
        </section>
      </div>
      <section>
        <div className="sectionHead"><div><h2>Payment transactions</h2><p>Payment notifications never mark orders paid until Meta's payment lookup confirms the exact order amount and reference.</p></div><button onClick={()=>refresh().catch(e=>setError(e.message))}>↻ Refresh</button></div>
        <div className="paymentTableScroll">
          <table className="paymentTable"><thead><tr><th>Reference</th><th>Customer</th><th>Amount</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>{orders.map(o=><tr key={o._id}>
              <td><b>{o.referenceId}</b><small>{o.title}</small></td>
              <td>{o.contactId?.name||o.phone}<small>{o.phone}</small></td>
              <td className="money">{inr(o.amountPaise)}</td>
              <td><span className={'payBadge '+(o.status==='captured'?'paid':o.status==='failed'||o.status==='send_failed'?'failed':'pending')}>{String(o.status).replaceAll('_',' ')}</span></td>
              <td>{when(o.createdAt)}</td>
              <td>{o.messageId&&o.status!=='captured'?<button disabled={busy} onClick={()=>verifyOrder(o)}>Verify status</button>:o.status==='captured'?'Verified':<small>{o.lastError||'Not sent'}</small>}</td>
            </tr>)}
              {!orders.length&&<tr><td colSpan="6" className="paymentEmpty">No payment requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </div>;
}
