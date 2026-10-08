import mongoose from 'mongoose';

const mediaSchema=new mongoose.Schema({
  workspaceId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  ownerId:{type:mongoose.Schema.Types.ObjectId,required:true},
  tokenDigest:{type:String,required:true},
  contentType:{type:String,enum:['image/jpeg','image/png'],required:true},
  originalName:{type:String,default:'image'},
  bytes:{type:Buffer,required:true},
  length:{type:Number,required:true,min:1,max:5242880},
  sha256:{type:String,required:true},
  status:{type:String,enum:['active','removed'],default:'active',index:true}
},{timestamps:true});
mediaSchema.index({workspaceId:1,createdAt:-1});
export const CampaignMedia=mongoose.model('CampaignMedia',mediaSchema);
