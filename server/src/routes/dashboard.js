import express from 'express';
import {Campaign,Contact,ContactList,Delivery,Template} from '../models.js';
import {summarizeDeliveryActivity,deliveryAggregationPipeline} from '../services/dashboardStats.js';
import {requireAuth} from '../middleware/auth.js';

const r=express.Router();
r.use(requireAuth);

r.get('/',async(req,res)=>{
  const now=new Date();
  const since=new Date(now);
  since.setUTCHours(0,0,0,0);
  since.setUTCDate(since.getUTCDate()-13);
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
    Delivery.aggregate(deliveryAggregationPipeline(req.workspaceId,since))
  ]);

  const {submitted,delivered,read,failed,deliveryRate,activity}=summarizeDeliveryActivity(deliveries,now);

  res.json({
    metrics:{
      submitted,delivered,read,failed,
      deliveryRate,
      contacts,optedIn,pendingConsent,suppressed,lists,templates,scheduled
    },
    activity,
    recent
  });
});

export default r;
