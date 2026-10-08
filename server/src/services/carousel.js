// Meta Cloud API session (free-form) image carousel, CTA URL cards only.
// This deliberately does not implement template carousels, unsupported CSS, or rich HTML.
export function publicHttpsUrl(input,label='URL'){
  const value=String(input||'').trim();
  if(value.length>2048)throw new Error(label+' must be at most 2048 characters');
  let u;
  try{u=new URL(value)}catch{throw new Error(label+' must be a valid HTTPS URL')}
  const h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(h)||h==='0'){
    throw new Error(label+' must be a public HTTPS URL (not a local or IP address)');
  }
  return value;
}

export function validateCarousel({text,cards}){
  const body=String(text||'').trim();
  if(!body||body.length>1024)throw new Error('Carousel message must contain 1–1024 characters');
  if(!Array.isArray(cards)||cards.length<2||cards.length>10)throw new Error('Carousel requires 2–10 image cards');
  const normalized=cards.map((item,index)=>{
    const imageUrl=publicHttpsUrl(item?.imageUrl,'Card '+(index+1)+' image');
    const buttonUrl=publicHttpsUrl(item?.buttonUrl,'Card '+(index+1)+' button URL');
    const caption=String(item?.caption||'').trim();
    const buttonText=String(item?.buttonText||'').trim();
    if(caption.length>160||(caption.match(/\n/g)||[]).length>2){
      throw new Error('Card '+(index+1)+' caption must have at most 160 characters and 2 line breaks');
    }
    if(!buttonText||buttonText.length>20)throw new Error('Card '+(index+1)+' URL button label must contain 1–20 characters');
    return {imageUrl,caption,buttonText,buttonUrl};
  });
  return {text:body,cards:normalized};
}

export function buildCarouselPayload({to,text,cards}){
  const data=validateCarousel({text,cards});
  if(!/^\d{8,15}$/.test(String(to||'')))throw new Error('Invalid WhatsApp recipient number');
  return {
    messaging_product:'whatsapp',
    recipient_type:'individual',
    to:String(to),
    type:'interactive',
    interactive:{
      type:'carousel',
      body:{text:data.text},
      action:{cards:data.cards.map((card,index)=>({
        card_index:index,
        type:'cta_url',
        header:{type:'image',image:{link:card.imageUrl}},
        ...(card.caption?{body:{text:card.caption}}:{}),
        action:{name:'cta_url',parameters:{display_text:card.buttonText,url:card.buttonUrl}}
      }))}
    }
  };
}
