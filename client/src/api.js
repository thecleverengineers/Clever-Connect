const BASE=(import.meta.env.VITE_API_URL||'http://localhost:5000/api').replace(/\/$/,'');
export async function api(path,opts={}){const isForm=opts.body instanceof FormData;const res=await fetch(`${BASE}${path}`,{...opts,credentials:'include',headers:{...(isForm?{}:{'Content-Type':'application/json'}),...(opts.headers||{})}});const type=res.headers.get('content-type')||'';const data=type.includes('json')?await res.json():await res.text();if(!res.ok)throw new Error(data?.message||`Request failed (${res.status})`);return data}
export{BASE};
