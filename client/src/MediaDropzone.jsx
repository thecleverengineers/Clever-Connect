import React,{useRef,useState} from 'react';
import {api} from './api.js';
import './mediaDropzone.css';

// Native file picker plus desktop drag/drop. Files are saved to persistent
// MongoDB-backed campaign media before a carousel campaign can be saved.
export default function MediaDropzone({value,onUpload,disabled=false,label='Image',help='JPG or PNG, up to 5 MB'}){
  const input=useRef(null);
  const [dragging,setDragging]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState('');
  async function choose(file){
    if(!file||disabled||uploading)return;
    const mime=String(file.type||'');
    if(!['image/jpeg','image/png'].includes(mime)){setError('Choose a JPG or PNG image.');return}
    if(file.size<1||file.size>5*1024*1024){setError('Images must be 5 MB or smaller.');return}
    const fd=new FormData();fd.append('image',file);
    setError('');setUploading(true);
    try{
      const result=await api('/media/upload',{method:'POST',body:fd});
      onUpload(result.url);
    }catch(e){setError(e.message)}
    finally{setUploading(false);if(input.current)input.current.value=''}
  }
  function drop(e){e.preventDefault();e.stopPropagation();setDragging(false);choose(e.dataTransfer?.files?.[0])}
  return <div className="waImageUpload">
    <div className={'waImageDrop '+(dragging?'dragging ':'')+(value?'hasImage ':'')+(disabled||uploading?'disabled':'')}
      role="button" tabIndex={disabled||uploading?-1:0}
      aria-label={value?'Replace '+label:'Upload '+label}
      onClick={()=>!disabled&&!uploading&&input.current?.click()}
      onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&!disabled&&!uploading){e.preventDefault();input.current?.click()}}}
      onDragEnter={e=>{e.preventDefault();setDragging(true)}}
      onDragOver={e=>{e.preventDefault();if(!disabled)setDragging(true)}}
      onDragLeave={e=>{e.preventDefault();setDragging(false)}}
      onDrop={drop}>
      <input ref={input} type="file" accept="image/jpeg,image/png" aria-label={label}
        onChange={e=>choose(e.target.files?.[0])} disabled={disabled||uploading} hidden/>
      {value?<img src={value} alt={label+' preview'} loading="lazy"/>:<span className="waDropIcon">⇧</span>}
      <span className="waDropText"><strong>{uploading?'Uploading image…':value?'Replace image':'Choose or drop an image'}</strong>
        <small>{uploading?'Saving securely to WA SANTA…':help}</small></span>
    </div>
    {error&&<small className="waDropError" role="alert">{error}</small>}
  </div>;
}
