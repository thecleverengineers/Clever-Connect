const BASE=(import.meta.env.VITE_API_URL||'http://localhost:5000/api').replace(/\/$/,'');
const GET_TTL=45_000;
const cache=new Map();
const inflight=new Map();

export function getCached(path){
  return cache.get(path)?.data;
}
export function invalidateCache(prefix=''){
  if(!prefix){cache.clear();return}
  for(const key of cache.keys())if(key.startsWith(prefix))cache.delete(key);
}
function remember(path,data){
  cache.set(path,{data,at:Date.now()});
  return data;
}

export async function api(path,opts={}){
  const {fresh=false,cache:cacheOption,...requestOpts}=opts;
  const method=String(requestOpts.method||'GET').toUpperCase();
  const isGet=method==='GET';
  const isForm=requestOpts.body instanceof FormData;
  const cacheable=isGet&&cacheOption!==false;

  if(cacheable){
    if(!fresh){
      const hit=cache.get(path);
      if(hit&&Date.now()-hit.at<GET_TTL)return hit.data;
    }
    // Even forced refreshes share a concurrent GET. Rapid sidebar switching
    // must not produce multiple identical DB queries.
    if(inflight.has(path))return inflight.get(path);
  }

  const run=(async()=>{
    let res;
    try{
      res=await fetch(BASE+path,{
        ...requestOpts,
        credentials:'include',
        headers:{...(isForm?{}:{'Content-Type':'application/json'}),...(requestOpts.headers||{})}
      });
    }catch(e){
      throw new Error('Unable to reach WA SANTA. Check your connection and try again.');
    }
    const type=res.headers.get('content-type')||'';
    const data=type.includes('json')?await res.json():await res.text();
    if(res.status===401&&typeof window!=='undefined'){
      // Never reuse protected endpoint cache after a genuine session failure.
      invalidateCache();
      window.dispatchEvent(new Event('wa:unauthorized'));
    }
    if(res.status===402&&typeof window!=='undefined') window.dispatchEvent(new CustomEvent('wa:subscription-required',{detail:data}));
    if(!res.ok){
      const error=new Error(data?.message||('Request failed ('+res.status+')'));
      error.status=res.status;
      error.code=data?.code||'';
      error.action=data?.action||'';
      throw error;
    }
    if(cacheable)return remember(path,data);
    if(!isGet)invalidateCache();
    return data;
  })();

  if(cacheable){
    inflight.set(path,run);
    try{return await run}
    finally{inflight.delete(path)}
  }
  return run;
}

// Optional low-priority prefetch for the route the user actually requested.
// Never preload every workspace table: that caused unnecessary simultaneous
// requests on login and amplified Render free-tier cold starts.
export function warmWorkspace(page='overview'){
  const routeQueries={
    overview:['/dashboard'],
    campaigns:['/campaigns'],
    contacts:['/contacts'],
    schedule:['/campaigns?status=scheduled'],
    reports:['/dashboard'],
    templates:['/templates'],
    'whatsapp-api':['/integrations/whatsapp-connections']
  };
  for(const path of routeQueries[page]||[]){
    api(path).catch(()=>{});
  }
}

export{BASE};
