import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import { Contact, ContactList } from '../models.js';
import { requireAuth } from '../middleware/auth.js';

const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
router.use(requireAuth);

const cleanPhone=v=>{
  const raw=String(v||'').trim();
  const digits=raw.replace(/\D/g,'');
  if(digits.length<8||digits.length>15) return '';
  return '+'+digits;
};
const consent=v=>['opted_in','pending','opted_out'].includes(v)?v:'pending';
async function validListIds(workspaceId, ids=[]){
  const clean=[...new Set(ids.filter(Boolean).map(String))].filter(mongoose.isValidObjectId);
  if(!clean.length) return [];
  const rows=await ContactList.find({workspaceId,_id:{$in:clean}}).select('_id').lean();
  return rows.map(x=>x._id);
}

router.get('/',async(req,res)=>{
  const q={workspaceId:req.workspaceId};
  if(req.query.list) q.lists=req.query.list;
  if(req.query.consent&&['opted_in','pending','opted_out'].includes(req.query.consent)) q.consentStatus=req.query.consent;
  if(req.query.suppressed==='true') q.suppressed=true;
  if(req.query.suppressed==='false') q.suppressed=false;
  if(req.query.search){
    const s=String(req.query.search).slice(0,80);
    q.$or=[{name:{$regex:s,$options:'i'}},{phone:{$regex:s,$options:'i'}},{email:{$regex:s,$options:'i'}}];
  }
  const rows=await Contact.find(q).sort({createdAt:-1}).populate('lists','name').lean();
  res.json(rows);
});

router.post('/',async(req,res)=>{
  try{
    const phone=cleanPhone(req.body.phone);
    if(!phone) return res.status(400).json({message:'Enter a valid international phone number'});
    const lists=await validListIds(req.workspaceId,req.body.lists||[]);
    const consentStatus=consent(req.body.consentStatus);
    const row=await Contact.create({
      workspaceId:req.workspaceId,
      name:String(req.body.name||'').trim(),
      phone,
      email:String(req.body.email||'').trim().toLowerCase(),
      lists,
      tags:Array.isArray(req.body.tags)?req.body.tags.slice(0,20):[],
      notes:String(req.body.notes||'').slice(0,1000),
      consentStatus,
      consentAt:consentStatus==='opted_in'?new Date():undefined,
      suppressed:req.body.suppressed===true||consentStatus==='opted_out',
      source:'manual'
    });
    res.status(201).json(row);
  }catch(e){
    res.status(e.code===11000?409:400).json({message:e.code===11000?'Phone already exists':'Unable to save contact'});
  }
});

router.post('/bulk-consent',async(req,res)=>{
  const ids=(req.body.ids||[]).filter(mongoose.isValidObjectId);
  const status=consent(req.body.consentStatus);
  if(!ids.length) return res.status(400).json({message:'Select at least one contact'});
  const set={consentStatus:status,suppressed:status==='opted_out'};
  if(status==='opted_in') set.consentAt=new Date();
  const result=await Contact.updateMany({_id:{$in:ids},workspaceId:req.workspaceId},{$set:set});
  res.json({updated:result.modifiedCount});
});

router.post('/bulk-delete',async(req,res)=>{
  const ids=(req.body.ids||[]).filter(mongoose.isValidObjectId);
  if(!ids.length) return res.status(400).json({message:'Select at least one contact'});
  const result=await Contact.deleteMany({_id:{$in:ids},workspaceId:req.workspaceId});
  res.json({deleted:result.deletedCount});
});

router.post('/import',upload.single('file'),async(req,res)=>{
  if(!req.file) return res.status(400).json({message:'File required'});
  const wb=XLSX.read(req.file.buffer,{type:'buffer'});
  const data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
  const listId=req.body.listId||null;
  const importAsOptedIn=req.body.confirmConsent==='true';
  const validLists=listId?await validListIds(req.workspaceId,[listId]):[];
  const list=validLists[0]||null;
  let added=0,updated=0,skipped=0;
  for(const r of data){
    const phone=cleanPhone(r.phone||r.Phone||r.mobile||r.Mobile||r['Phone Number']);
    if(!phone){skipped++;continue;}
    const name=String(r.name||r.Name||r.full_name||r['Full Name']||'').trim();
    const email=String(r.email||r.Email||'').trim().toLowerCase();
    const rawConsent=String(r.consent||r.Consent||r.opt_in||r['Opt In']||'').toLowerCase();
    const explicitOptIn=['yes','true','1','opted_in','opted in'].includes(rawConsent);
    const explicitOptOut=['no','false','0','opted_out','opted out'].includes(rawConsent);
    const consentStatus=explicitOptOut?'opted_out':(explicitOptIn||importAsOptedIn?'opted_in':'pending');
    const existing=await Contact.findOne({workspaceId:req.workspaceId,phone});
    if(existing){
      existing.name=name||existing.name;
      existing.email=email||existing.email;
      existing.source='import';
      if(list&&!existing.lists.some(x=>String(x)===String(list))) existing.lists.push(list);
      if(consentStatus!=='pending'){
        existing.consentStatus=consentStatus;
        existing.suppressed=consentStatus==='opted_out';
        if(consentStatus==='opted_in') existing.consentAt=new Date();
      }
      await existing.save();
      updated++;
    }else{
      await Contact.create({
        workspaceId:req.workspaceId,name,phone,email,
        lists:list?[list]:[],source:'import',consentStatus,
        suppressed:consentStatus==='opted_out',
        consentAt:consentStatus==='opted_in'?new Date():undefined
      });
      added++;
    }
  }
  res.json({added,updated,skipped,total:data.length});
});

router.put('/:id',async(req,res)=>{
  const current=await Contact.findOne({_id:req.params.id,workspaceId:req.workspaceId});
  if(!current) return res.sendStatus(404);
  if(req.body.phone!==undefined){
    const phone=cleanPhone(req.body.phone);
    if(!phone) return res.status(400).json({message:'Enter a valid international phone number'});
    current.phone=phone;
  }
  if(req.body.name!==undefined) current.name=String(req.body.name||'').trim();
  if(req.body.email!==undefined) current.email=String(req.body.email||'').trim().toLowerCase();
  if(req.body.notes!==undefined) current.notes=String(req.body.notes||'').slice(0,1000);
  if(req.body.lists!==undefined) current.lists=await validListIds(req.workspaceId,req.body.lists||[]);
  if(req.body.consentStatus!==undefined){
    current.consentStatus=consent(req.body.consentStatus);
    current.suppressed=current.consentStatus==='opted_out';
    if(current.consentStatus==='opted_in') current.consentAt=new Date();
  }
  if(req.body.suppressed!==undefined) current.suppressed=!!req.body.suppressed;
  try{await current.save();res.json(current)}
  catch(e){res.status(e.code===11000?409:400).json({message:e.code===11000?'Phone already exists':'Unable to update contact'})}
});

router.delete('/:id',async(req,res)=>{
  await Contact.deleteOne({_id:req.params.id,workspaceId:req.workspaceId});
  res.json({ok:true});
});

export default router;
