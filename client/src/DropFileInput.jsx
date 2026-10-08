import React,{useRef,useState} from 'react';
import './mediaDropzone.css';

export default function DropFileInput({name,accept,onFile,required=false,description='Drag and drop a file or browse',disabled=false}){
  const element=useRef(null);
  const [dragging,setDragging]=useState(false);
  const [filename,setFilename]=useState('');
  function handle(file){
    if(!file)return;
    setFilename(file.name);
    onFile?.(file);
  }
  function drop(e){
    e.preventDefault();e.stopPropagation();setDragging(false);
    if(disabled||!element.current)return;
    const file=e.dataTransfer?.files?.[0];
    if(!file)return;
    // Ensure the selected file is included in the parent form's FormData.
    const transfer=new DataTransfer();transfer.items.add(file);
    element.current.files=transfer.files;
    handle(file);
  }
  return <div className={'waGenericDrop '+(dragging?'dragging':'')}
    onDragOver={e=>{e.preventDefault();if(!disabled)setDragging(true)}}
    onDragLeave={e=>{e.preventDefault();setDragging(false)}}
    onDrop={drop}>
    <strong>{filename||description}</strong>
    <input ref={element} type="file" name={name} accept={accept} required={required}
      disabled={disabled} onChange={e=>handle(e.target.files?.[0])}/>
  </div>;
}
