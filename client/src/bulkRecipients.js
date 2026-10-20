export function canonicalPhone(input){
  const raw=String(input??'').trim();
  if(!/^\+?[0-9().\s-]+$/.test(raw))return '';
  const digits=raw.replace(/\D/g,'');
  return /^[0-9]{8,15}$/.test(digits)?digits:'';
}

export function splitManualNumbers(text){
  return String(text||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
}

export function parsePhoneCsv(content){
  const text=String(content||'').replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    }else if(ch===','&&!quoted){row.push(cell.trim());cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell.trim());cell='';
      if(row.some(Boolean))rows.push(row);
      row=[];
      if(rows.length>5001)throw new Error('CSV exceeds the 5,000-recipient limit.');
    }else cell+=ch;
  }
  if(quoted)throw new Error('CSV contains an unclosed quotation mark.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(!rows.length)throw new Error('CSV file is empty.');
  const headings=rows[0].map(s=>s.toLowerCase().replace(/[\s_-]/g,''));
  const index=headings.findIndex(x=>['phone','phonenumber','mobile','mobilenumber','whatsapp','whatsappnumber','contact','contactnumber'].includes(x));
  if(index<0&&rows[0].length>1)throw new Error('CSV needs a phone, mobile, or WhatsApp number column.');
  const values=(index>=0?rows.slice(1):rows).map(r=>r[Math.max(index,0)]||'').filter(Boolean);
  if(values.length>5000)throw new Error('CSV exceeds the 5,000-recipient limit.');
  return values;
}

export function matchConsentedNumbers(numbers,contacts){
  const lookup=new Map(contacts.map(c=>[canonicalPhone(c.phone),c]).filter(x=>x[0]));
  const seen=new Set(); const accepted=[];const rejected=[];let duplicate=0;
  for(const raw of numbers){
    const phone=canonicalPhone(raw);
    if(!phone){rejected.push({number:String(raw),reason:'Invalid phone number'});continue}
    if(seen.has(phone)){duplicate++;continue}
    seen.add(phone);
    const c=lookup.get(phone);
    if(!c){rejected.push({number:String(raw),reason:'Not in address book'});continue}
    if(c.consentStatus!=='opted_in'||c.suppressed){rejected.push({number:String(raw),reason:'No active WhatsApp opt-in'});continue}
    accepted.push(c);
  }
  return {accepted,rejected,duplicate,unique:seen.size};
}
