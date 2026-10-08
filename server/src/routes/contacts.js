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

router.get('/template.xlsx',(req,res)=>{
  const wb=XLSX.utils.book_new();
  const rows=[{name:'Example Contact',phone:'+919876543210',email:'example@yourcompany.com',consent:'yes',opt_in_source:'Website signup',opt_in_date:'2026-10-01',tags:'customer,newsletter',notes:'Replace this sample row'}];
  const ws=XLSX.utils.json_to_sheet(rows,{header:['name','phone','email','consent','opt_in_source','opt_in_date','tags','notes']});
  ws['!cols']=[{wch:23},{wch:22},{wch:34},{wch:16},{wch:27},{wch:18},{wch:26},{wch:38}];
  XLSX.utils.book_append_sheet(wb,ws,'Contacts');
  const help=XLSX.utils.aoa_to_sheet([
    ['WA SANTA — WhatsApp Contacts'],
    ['Replace the sample row on Contacts sheet and import the saved .xlsx file.'],
    ['phone','International E.164 with country code: +919876543210 (8-15 digits).'],
    ['consent','yes = documented opt-in, no = opted out, blank = pending.'],
    ['opt_in_source','Where permission was obtained (optional audit field).'],
    ['opt_in_date','YYYY-MM-DD date permission was obtained.'],
    ['tags','Comma-separated tags.'],
    ['Import limits','5 MB and maximum 5,000 rows per batch (WA SANTA upload cap, not a Meta messaging quota).'],
    ['Meta limits','Meta sets messaging limits per portfolio; imports do not bypass template approval or recipient opt-in.']
  ]);help['!cols']=[{wch:24},{wch:110}];
  XLSX.utils.book_append_sheet(wb,help,'Instructions');
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="WA-SANTA-Contacts-Template.xlsx"');
  res.send(XLSX.write(wb,{bookType:'xlsx',type:'buffer'}));
});

router.post('/import',upload.single('file'),async(req,res)=>{
  if(!req.file) return res.status(400).json({message:'File required'});
  const wb=XLSX.read(req.file.buffer,{type:'buffer'});
  const data=XLSX.utils.sheet_to_json(wb.Sheets['Contacts']||wb.Sheets[wb.SheetNames[0]],{defval:''});
  if(data.length>5000)return res.status(413).json({message:'Maximum 5,000 contacts per import file. Split your workbook into smaller batches.'});
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
    const tags=String(r.tags||r.Tags||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);
    const auditNote=[
      r.opt_in_source?'Consent source: '+String(r.opt_in_source).slice(0,100):'',
      r.opt_in_date?'Consent date: '+String(r.opt_in_date).slice(0,30):'',
      r.notes?String(r.notes).slice(0,300):''
    ].filter(Boolean).join(' | ').slice(0,1000);
    const existing=await Contact.findOne({workspaceId:req.workspaceId,phone});
    if(existing){
      existing.name=name||existing.name;
      existing.email=email||existing.email;
      existing.source='import';
      if(tags.length)existing.tags=[...new Set([...(existing.tags||[]),...tags])].slice(0,20);
      if(auditNote)existing.notes=auditNote;
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
        lists:list?[list]:[],source:'import',consentStatus,tags,notes:auditNote,
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
