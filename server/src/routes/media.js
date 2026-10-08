import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {CampaignMedia} from '../mediaModel.js';

const router=express.Router();
export const publicMedia=express.Router();
const MAX=5*1024*1024;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX,files:1}});
const origin=()=>{
  const value=String(process.env.PUBLIC_API_URL||process.env.RENDER_EXTERNAL_URL||
    (process.env.NODE_ENV==='production'?'https://clever-connect-api-y2hn.onrender.com':'http://localhost:5000')).replace(/\/$/,'');
  if(!/^https?:\/\//.test(value))throw new Error('Invalid public API origin');
  return value;
};
export const publicMediaUrl=(id,token)=>origin()+'/api/media/public/'+encodeURIComponent(id)+'/'+token;
export const parsePublicMediaUrl=url=>{
  const base=origin()+'/api/media/public/';
  if(!String(url||'').startsWith(base))return null;
  const relative=String(url).slice(base.length);
  const parts=relative.split('/');
  if(parts.length!==2||!mongoose.isValidObjectId(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return null;
  return {id:parts[0],token:parts[1]};
};
export const digestToken=token=>crypto.createHash('sha256').update(token).digest('hex');
function mimeFor(data){
  if(data.length>3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
  if(data.length>8&&data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  return '';
}
const throttle=new Map();
router.post('/upload',(req,res)=>{
  upload.single('image')(req,res,async e=>{
    if(e)return res.status(413).json({message:'Image must be JPEG or PNG, under 5 MB'});
    if(!req.file)return res.status(400).json({message:'Choose an image to upload'});
    const type=mimeFor(req.file.buffer);
    if(!type)return res.status(415).json({message:'Only genuine JPG and PNG image files are supported for WhatsApp carousel cards'});
    const key=String(req.workspaceId);
    const now=Date.now();
    const attempts=(throttle.get(key)||[]).filter(time=>time>now-60000);
    if(attempts.length>=20)return res.status(429).json({message:'Limit 20 uploaded images per minute per workspace'});
    attempts.push(now);throttle.set(key,attempts);
    try{
      const token=crypto.randomBytes(32).toString('hex');
      const item=await CampaignMedia.create({
        workspaceId:req.workspaceId,ownerId:req.user._id,tokenDigest:digestToken(token),
        contentType:type,originalName:String(req.file.originalname||'image').slice(0,150),
        bytes:req.file.buffer,length:req.file.buffer.length,
        sha256:crypto.createHash('sha256').update(req.file.buffer).digest('hex')
      });
      res.status(201).json({
        id:String(item._id),url:publicMediaUrl(String(item._id),token),
        contentType:type,size:item.length,name:item.originalName
      });
    }catch(err){console.error('Campaign image upload failed',err);res.status(500).json({message:'Could not save campaign image'})}
  });
});
// This route is intentionally public so Meta can download the image. The
// unguessable token is a bearer capability; never list it in workspace APIs.
publicMedia.get('/:id/:token',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id)||!/^[a-f0-9]{64}$/.test(req.params.token))return res.sendStatus(404);
  const row=await CampaignMedia.findOne({_id:req.params.id,status:'active',tokenDigest:digestToken(req.params.token)})
    .select('bytes contentType length');
  if(!row)return res.sendStatus(404);
  res.set('Content-Type',row.contentType);
  res.set('Content-Length',String(row.length));
  res.set('X-Content-Type-Options','nosniff');
  res.set('Cache-Control','public, max-age=86400');
  res.send(Buffer.from(row.bytes));
});
export default router;
