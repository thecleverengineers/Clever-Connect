import mongoose from 'mongoose';

const {Schema,model}=mongoose;
const options={timestamps:true};

const paymentConfigSchema=new Schema({
  workspaceId:{type:Schema.Types.ObjectId,required:true,index:true},
  integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true,index:true},
  provider:{type:String,enum:['razorpay'],default:'razorpay'},
  configurationName:{type:String,required:true,trim:true,maxlength:60},
  enabled:{type:Boolean,default:true},
  linkedConfirmedAt:{type:Date,default:Date.now}
},options);
paymentConfigSchema.index({workspaceId:1,integrationId:1},{unique:true});

const paymentOrderSchema=new Schema({
  workspaceId:{type:Schema.Types.ObjectId,required:true,index:true},
  integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true},
  contactId:{type:Schema.Types.ObjectId,ref:'Contact',required:true},
  createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
  phone:{type:String,required:true},
  referenceId:{type:String,required:true,maxlength:35,unique:true},
  idempotencyKey:{type:String,required:true},
  title:{type:String,required:true,maxlength:120},
  amountPaise:{type:Number,required:true,min:100,max:100000000},
  currency:{type:String,enum:['INR'],default:'INR'},
  configurationName:{type:String,required:true},
  status:{type:String,enum:['created','sending','submitted','pending','captured','failed','canceled','verification_pending','send_failed'],default:'created',index:true},
  messageId:{type:String,default:''},
  paymentId:{type:String,default:''},
  statusMessageId:{type:String,default:''},
  submittedAt:Date,
  capturedAt:Date,
  lastCheckedAt:Date,
  lastError:{type:String,default:''}
},options);
paymentOrderSchema.index({workspaceId:1,idempotencyKey:1},{unique:true});
paymentOrderSchema.index({workspaceId:1,createdAt:-1});

const inboundWindowSchema=new Schema({
  workspaceId:{type:Schema.Types.ObjectId,required:true},
  integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true},
  phone:{type:String,required:true},
  lastInboundAt:{type:Date,required:true}
},options);
inboundWindowSchema.index({workspaceId:1,integrationId:1,phone:1},{unique:true});

export const PaymentConfig=model('PaymentConfig',paymentConfigSchema);
export const PaymentOrder=model('PaymentOrder',paymentOrderSchema);
export const InboundWindow=model('InboundWindow',inboundWindowSchema);
