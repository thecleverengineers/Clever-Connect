import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import './campaignComposer.css';

export const blankCard=()=>({imageUrl:'',caption:'',buttonText:'View details',buttonUrl:''});
export const blankCampaignDraft=()=>({
  contentType:'text',message:'',integrationId:'',
  carouselCards:[blankCard(),blankCard()]
});
export const existingCampaignDraft=c=>({
  contentType:c?.contentType==='carousel'?'carousel':'text',
  message:c?.message||'',
  integrationId:String(c?.integrationId?._id||c?.integrationId||''),
  carouselCards:c?.carouselCards?.length?c.carouselCards.map(x=>({
    imageUrl:x.imageUrl||'',caption:x.caption||'',
    buttonText:x.buttonText||'View details',buttonUrl:x.buttonUrl||''
  })):[blankCard(),blankCard()]
});

function StyledText({text}){
  return <div className="waPreviewText">{String(text||'').split('\n').map((line,i)=>{
    const quote=/^> /.test(line);
    const bullet=/^[-*] /.test(line);
    const number=/^\d+\. /.test(line);
    const value=quote?line.slice(2):line;
    const tokens=value.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|\x60{3}[^\n]+\x60{3}|\x60[^\x60\n]+\x60)/g);
    return <div className={'waLine '+(quote?'quote ':'')+(bullet||number?'waListLine':'')} key={i}>
      {tokens.map((part,j)=>{
        if(/^\*[^*\n]+\*$/.test(part))return <strong key={j}>{part.slice(1,-1)}</strong>;
        if(/^_[^_\n]+_$/.test(part))return <em key={j}>{part.slice(1,-1)}</em>;
        if(/^~[^~\n]+~$/.test(part))return <del key={j}>{part.slice(1,-1)}</del>;
        if(part.startsWith('\x60\x60\x60')&&part.endsWith('\x60\x60\x60'))return <code key={j}>{part.slice(3,-3)}</code>;
        if(part.startsWith('\x60')&&part.endsWith('\x60')&&part.length>2)return <code key={j}>{part.slice(1,-1)}</code>;
        return part;
      })}
      {!line&&'\u00a0'}
    </div>;
  })}</div>;
}

function Toolbar({inputRef,value,onChange}){
  const formats=[
    ['B','*','Bold'],['I','_','Italic'],['S','~','Strikethrough'],
    ['Mono','\x60\x60\x60','Monospace'],['•','- ','Bullet list'],
    ['1.','1. ','Numbered list'],['❝','> ','Quote'],['Code','\x60','Inline code']
  ];
  function apply(mark,label){
    const input=inputRef.current;
    const a=input?.selectionStart??value.length;
    const b=input?.selectionEnd??a;
    const selected=value.slice(a,b);
    const line=mark==='- '||mark==='1. '||mark==='> ';
    const insert=line?mark+(selected||'text'):mark+(selected||'text')+mark;
    onChange(value.slice(0,a)+insert+value.slice(b));
    requestAnimationFrame(()=>{
      input?.focus();
      const cursor=a+insert.length;
      input?.setSelectionRange(cursor,cursor);
    });
  }
  return <div className="waFormatBar" aria-label="WhatsApp formatting controls">
    {formats.map(([label,mark,title])=><button key={title} type="button" title={title} onClick={()=>apply(mark,title)}>{label}</button>)}
  </div>;
}

export default function CampaignComposer({draft,onChange}){
  const field=useRef(null);
  const [profiles,setProfiles]=useState([]);
  const [eligibility,setEligibility]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    api('/integrations/whatsapp-connections').then(data=>{
      if(active)setProfiles((data.connections||[]).filter(x=>x.provider==='meta'&&x.enabled));
    }).catch(e=>{if(active)setError(e.message)});
    return()=>{active=false};
  },[]);
  useEffect(()=>{
    if(!draft.integrationId){setEligibility(null);return}
    let active=true;
    api('/campaigns/eligibility?integrationId='+encodeURIComponent(draft.integrationId),{fresh:true})
      .then(x=>{if(active){setEligibility(x);setError('')}})
      .catch(e=>{if(active){setEligibility(null);setError(e.message)}});
    return()=>{active=false};
  },[draft.integrationId]);
  const isCarousel=draft.contentType==='carousel';
  const update=(key,value)=>onChange(prev=>({...prev,[key]:value}));
  const updateCard=(i,key,value)=>onChange(prev=>({
    ...prev,carouselCards:prev.carouselCards.map((c,j)=>i===j?{...c,[key]:value}:c)
  }));
  const move=(i,to)=>onChange(prev=>{
    const cards=[...prev.carouselCards];const x=cards.splice(i,1)[0];cards.splice(to,0,x);
    return {...prev,carouselCards:cards};
  });
  const cards=draft.carouselCards||[];
  return <div className="waComposer">
    <div className="waComposerTop">
      <div><b>Message composer</b><small>WhatsApp-native formatting only — no custom fonts, colours or font sizes.</small></div>
      <div className="waComposerSwitch" role="group" aria-label="Message format">
        <button type="button" aria-pressed={!isCarousel} className={!isCarousel?'selected':''} onClick={()=>update('contentType','text')}>Formatted text</button>
        <button type="button" aria-pressed={isCarousel} className={isCarousel?'selected':''} onClick={()=>update('contentType','carousel')}>Image carousel</button>
      </div>
    </div>
    <label className="waComposerField">Sending Meta profile
      <select value={draft.integrationId||''} onChange={e=>update('integrationId',e.target.value)} required={isCarousel}>
        <option value="">Default profile (text only)</option>
        {profiles.map(p=><option key={p.id} value={p.id}>{p.name}{p.displayPhoneNumber?' · '+p.displayPhoneNumber:''}</option>)}
      </select>
    </label>
    {eligibility&&<div className="waEligibility">
      <b>{eligibility.eligible}</b> eligible contacts across this workspace for this phone number; <b>{eligibility.outsideWindow}</b> opted-in contacts outside the 24-hour window.
      <small>Campaign audience filters may reduce the eligible count. Eligibility is rechecked at sending time.</small>
    </div>}
    {error&&<div className="waComposerWarning" role="alert">{error}</div>}
    <div className="waComposerLayout">
      <div className="waComposerEdit">
        <label className="waComposerField">
          {isCarousel?'Carousel intro message (up to 1024 characters)':'Message (up to 4096 characters)'}
          <Toolbar inputRef={field} value={draft.message} onChange={v=>update('message',v)}/>
          <textarea ref={field} rows={5} value={draft.message} onChange={e=>update('message',e.target.value)}
            maxLength={isCarousel?1024:4096} placeholder="Hi {{name}}, have a look at our new collection!" />
          <small>{draft.message.length} / {isCarousel?1024:4096} · Variables: {'{{name}}, {{phone}}, {{email}}'}</small>
        </label>
        {isCarousel&&<div className="waCardsEdit">
          <div className="waCardsHead"><b>Carousel images</b><small>{cards.length} / 10 cards</small></div>
          <p>2–10 public HTTPS image URLs, each with a URL button. Images must be accessible to Meta. Card captions allow formatting and contact variables.</p>
          {cards.map((c,i)=><div className="waCardEdit" key={i}>
            <div className="waCardEditTitle">
              <b>Card {i+1}</b>
              <div>
                <button type="button" disabled={i===0} onClick={()=>move(i,i-1)} aria-label={'Move card '+(i+1)+' left'}>←</button>
                <button type="button" disabled={i===cards.length-1} onClick={()=>move(i,i+1)} aria-label={'Move card '+(i+1)+' right'}>→</button>
                <button type="button" disabled={cards.length<=2} onClick={()=>onChange(prev=>({...prev,carouselCards:prev.carouselCards.filter((_,j)=>i!==j)}))}>Remove</button>
              </div>
            </div>
            <label className="waComposerField">Image URL (HTTPS)
              <input type="url" value={c.imageUrl} onChange={e=>updateCard(i,'imageUrl',e.target.value)} placeholder="https://your-site.com/product.jpg" required/>
            </label>
            <label className="waComposerField">Caption (160 characters, max 2 line breaks)
              <textarea rows={2} value={c.caption} maxLength={160} onChange={e=>updateCard(i,'caption',e.target.value)} placeholder="*New arrival* — shop now"/>
            </label>
            <div className="waCardRow">
              <label className="waComposerField">Button label
                <input value={c.buttonText} maxLength={20} onChange={e=>updateCard(i,'buttonText',e.target.value)} required/>
              </label>
              <label className="waComposerField">Button URL (HTTPS)
                <input type="url" value={c.buttonUrl} onChange={e=>updateCard(i,'buttonUrl',e.target.value)} placeholder="https://your-site.com/item" required/>
              </label>
            </div>
          </div>)}
          <button type="button" className="waAddCard" disabled={cards.length>=10} onClick={()=>onChange(prev=>({...prev,carouselCards:[...prev.carouselCards,blankCard()]}))}>+ Add image card</button>
        </div>}
      </div>
      <div className="waPreviewArea">
        <div className="waPreviewTop">WHATSAPP PREVIEW</div>
        <div className="waPreviewBubble"><StyledText text={draft.message||'Your formatted message appears here…'}/>
          {isCarousel&&<div className="waPreviewCarousel">
            {cards.map((c,i)=><div className="waPreviewCard" key={i}>
              {/^https:\/\//i.test(c.imageUrl)?<img src={c.imageUrl} alt={'Card '+(i+1)+' preview'} loading="lazy"/>:<div className="waImagePlaceholder">Image {i+1}</div>}
              {c.caption&&<StyledText text={c.caption}/>}
              <span className="waPreviewButton">{c.buttonText||'View details'} ↗</span>
            </div>)}
          </div>}
          <small className="waPreviewTime">Preview · actual appearance depends on WhatsApp</small>
        </div>
        <div className="waPreviewNote">Free-form text and interactive carousels require an inbound customer message within 24 hours. Outside that window, use approved Meta templates.</div>
      </div>
    </div>
  </div>;
}
