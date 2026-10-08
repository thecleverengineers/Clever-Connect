import express from 'express';
import {Campaign,Contact,ContactList,Delivery,Template} from '../models.js';
import {requireAuth} from '../middleware/auth.js';

const r=express.Router();
r.use(requireAuth);

r.get('/',async(req,res)=>{
  const since=new Date(Date.now()-14*86400000);
  const [
    contacts, optedIn, pendingConsent, suppressed, lists, templates, scheduled, recent, deliveries
  ]=await Promise.all([
    Contact.countDocuments({workspaceId:req.workspaceId}),
    Contact.countDocuments({workspaceId:req.workspaceId,consentStatus:'opted_in',suppressed:false}),
    Contact.countDocuments({workspaceId:req.workspaceId,consentStatus:'pending'}),
    Contact.countDocuments({workspaceId:req.workspaceId,$or:[{suppressed:true},{consentStatus:'opted_out'}]}),
    ContactList.countDocuments({workspaceId:req.workspaceId}),
    Template.countDocuments({workspaceId:req.workspaceId}),
    Campaign.countDocuments({workspaceId:req.workspaceId,status:'scheduled'}),
    Campaign.find({workspaceId:req.workspaceId}).sort({createdAt:-1}).limit(8).populate('listId','name').populate('templateId','name').lean(),
    Delivery.find({workspaceId:req.workspaceId,createdAt:{$gte:since}}).lean()
  ]);

  const submitted=deliveries.filter(x=>['submitted','sent','delivered','read'].includes(x.status)).length;
  const delivered=deliveries.filter(x=>['delivered','read'].includes(x.status)).length;
  const read=deliveries.filter(x=>x.status==='read').length;
  const failed=deliveries.filter(x=>x.status==='failed').length;

  const days=Array.from({length:14},(_,i)=>{
    const d=new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-(13-i));
    return{date:d.toISOString().slice(0,10),submitted:0,delivered:0,failed:0};
  });
  const map=Object.fromEntries(days.map(x=>[x.date,x]));
  for(const x of deliveries){
    const k=new Date(x.createdAt).toISOString().slice(0,10);
    if(map[k]){
      if(['submitted','sent','delivered','read'].includes(x.status)) map[k].submitted++;
      if(['delivered','read'].includes(x.status)) map[k].delivered++;
      if(x.status==='failed') map[k].failed++;
    }
  }

  res.json({
    metrics:{
      submitted,delivered,read,failed,
      deliveryRate:submitted?Math.round(delivered/submitted*1000)/10:0,
      contacts,optedIn,pendingConsent,suppressed,lists,templates,scheduled
    },
    activity:days,
    recent
  });
});

export default r;
