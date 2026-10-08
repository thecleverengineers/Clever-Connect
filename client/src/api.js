const BASE=(import.meta.env.VITE_API_URL||'http://localhost:5000/api').replace(/\/$/,'');
export async function api(path,opts={}){
  const isForm=opts.body instanceof FormData;
  let res;
  try{
    res=await fetch(BASE+path,{
      ...opts,
      credentials:'include',
      headers:{...(isForm?{}:{'Content-Type':'application/json'}),...(opts.headers||{})}
    });
  }catch(e){
    throw new Error('Unable to reach Clever Connect. Check your connection and try again.');
  }
  const type=res.headers.get('content-type')||'';
  const data=type.includes('json')?await res.json():await res.text();
  if(res.status===401&&typeof window!=='undefined') window.dispatchEvent(new Event('wa:unauthorized'));
  if(res.status===402&&typeof window!=='undefined') window.dispatchEvent(new CustomEvent('wa:subscription-required',{detail:data}));
  if(!res.ok) throw new Error(data?.message||('Request failed ('+res.status+')'));
  return data;
}
export{BASE};
