import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const opts = { timestamps: true };

const workspaceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  plan: { type: String, default:'trial', index:true },
  subscriptionPlanId: { type: Schema.Types.ObjectId, ref:'SubscriptionPlan', default:null },
  subscriptionStatus: { type: String, enum:['trialing','active','past_due','cancelled','expired'], default:'trialing', index:true },
  trialStartedAt: { type:Date, default:Date.now },
  trialEndsAt: { type:Date, default:()=>new Date(Date.now()+7*24*60*60*1000), index:true },
  currentPeriodStart: Date,
  currentPeriodEnd: Date
}, opts);

const userSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['owner','admin','member'], default: 'owner' },
  isSuperAdmin: { type:Boolean, default:false, index:true },
  phone: { type: String, default:'' },
  jobTitle: { type: String, default:'' },
  avatarData: { type: String, default:'' },
  twoFactorEnabled: { type:Boolean, default:false },
  twoFactorPhone: { type:String, default:'' },
  twoFactorIntegrationId: { type:Schema.Types.ObjectId, ref:'Integration', default:null },
  twoFactorOtpHash: { type:String, default:'' },
  twoFactorOtpExpiresAt: Date,
  twoFactorOtpAttempts: { type:Number, default:0 }
}, opts);

const subscriptionPlanSchema = new Schema({
  name:{type:String,required:true,trim:true},
  slug:{type:String,required:true,trim:true,lowercase:true,unique:true,index:true},
  description:{type:String,default:''},
  priceMonthly:{type:Number,required:true,min:0},
  currency:{type:String,default:'INR',uppercase:true},
  active:{type:Boolean,default:true,index:true},
  sortOrder:{type:Number,default:0},
  metaConnections:{type:Number,default:1,min:0},
  teamMembers:{type:Number,default:3,min:1},
  monthlyMessages:{type:Number,default:1000,min:0},
  features:[{type:String,trim:true}]
}, opts);

const subscriptionRequestSchema = new Schema({
  workspaceId:{type:Schema.Types.ObjectId,ref:'Workspace',required:true,index:true},
  planId:{type:Schema.Types.ObjectId,ref:'SubscriptionPlan',required:true,index:true},
  requestedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
  status:{type:String,enum:['pending','approved','rejected','cancelled'],default:'pending',index:true},
  adminNote:{type:String,default:''},
  approvedBy:{type:Schema.Types.ObjectId,ref:'User',default:null},
  approvedAt:Date
},opts);

const listSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, index: true, required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' }
}, opts);
listSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

const contactSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, index: true, required: true },
  name: { type: String, trim: true, default: '' },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  lists: [{ type: Schema.Types.ObjectId, ref: 'ContactList' }],
  tags: [{ type: String, trim: true }],
  custom: { type: Map, of: String },
  consentStatus: { type: String, enum: ['opted_in','pending','opted_out'], default: 'pending', index: true },
  consentAt: Date,
  suppressed: { type: Boolean, default: false, index: true },
  source: { type: String, enum: ['manual','import','api'], default: 'manual' },
  notes: { type: String, default: '' }
}, opts);
contactSchema.index({ workspaceId: 1, phone: 1 }, { unique: true });

const templateSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, index: true, required: true },
  integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', default: null, index: true },
  name: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  metaTemplateName: { type: String, default: '' },
  metaTemplateId: { type: String, default: '', index: true },
  metaStatus: { type: String, enum: ['LOCAL','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','UNKNOWN'], default: 'LOCAL', index: true },
  metaRejectedReason: { type: String, default: '' },
  metaQualityScore: { type: String, default: '' },
  metaLastSyncedAt: Date,
  language: { type: String, default: 'en_US' },
  category: { type: String, enum: ['MARKETING','UTILITY','AUTHENTICATION'], default: 'MARKETING' }
}, opts);
templateSchema.index(
  { workspaceId: 1, integrationId: 1, metaTemplateName: 1, language: 1 },
  { unique: true, partialFilterExpression: { metaTemplateName: { $gt: '' } } }
);

const campaignSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, index: true, required: true },
  name: { type: String, required: true, trim: true },
  message: { type: String, default: '' },
  contentType:{type:String,enum:['text','carousel'],default:'text'},
  integrationId:{type:Schema.Types.ObjectId,ref:'Integration',default:null},
  carouselCards:[{
    _id:false,imageUrl:{type:String,trim:true},caption:{type:String,default:''},
    buttonText:{type:String,trim:true},buttonUrl:{type:String,trim:true}
  }],
  templateId: { type: Schema.Types.ObjectId, ref: 'Template', default: null },
  audienceType: { type: String, enum: ['all','list','contacts'], default: 'all' },
  listId: { type: Schema.Types.ObjectId, ref: 'ContactList', default: null },
  contactIds: [{ type: Schema.Types.ObjectId, ref: 'Contact' }],
  scheduledAt: Date,
  status: { type: String, enum: ['draft','scheduled','processing','completed','partial','failed','cancelled'], default: 'draft', index: true },
  totals: {
    submitted: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  startedAt: Date,
  completedAt: Date,
  lastError: { type: String, default: '' }
}, opts);

const deliverySchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, index: true, required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', index: true, default: null },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
  phone: { type: String, required: true },
  message: { type: String, default: '' },
  providerMessageId: { type: String, index: true },
  provider: { type: String, enum: ['demo','meta'], default: 'demo' },
  status: { type: String, enum: ['queued','submitted','sent','delivered','read','failed'], default: 'queued', index: true },
  error: { type: String, default: '' },
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date
}, opts);

const systemSettingSchema = new Schema({
  key:{type:String,required:true,unique:true,index:true},
  metaAppId:{type:String,default:''},
  metaAppSecretEncrypted:{type:String,default:''},
  metaEmbeddedSignupConfigId:{type:String,default:''},
  metaGraphVersion:{type:String,default:'v23.0'},
  updatedBy:{type:Schema.Types.ObjectId,ref:'User',default:null}
},opts);

const integrationSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, required: true, index: true },
  name: { type:String, default:'Primary WhatsApp', trim:true },
  provider: { type: String, enum: ['demo','meta'], default: 'demo' },
  enabled: { type: Boolean, default: true },
  isDefault: { type:Boolean, default:false, index:true },
  phoneNumberId: { type: String, default: '', index: true },
  displayPhoneNumber: { type:String, default:'' },
  businessAccountId: { type: String, default: '' },
  businessPortfolioId: { type:String, default:'' },
  accessTokenEncrypted: { type: String, default: '' },
  registrationPinEncrypted: { type:String, default:'' },
  connectMethod: { type:String, enum:['manual','embedded'], default:'manual', index:true },
  graphVersion: { type: String, default: 'v23.0' },
  otpTemplateName: { type:String, default:'' },
  otpTemplateLanguage: { type:String, default:'en_US' },
  connectionStatus: { type:String, enum:['connected','error','disabled'], default:'connected', index:true },
  connectedAt: { type:Date, default:Date.now },
  lastCheckedAt: Date,
  lastError: { type:String, default:'' }
}, opts);
integrationSchema.index({workspaceId:1,name:1},{unique:true});

export const Workspace = model('Workspace', workspaceSchema);
export const User = model('User', userSchema);
export const SubscriptionPlan = model('SubscriptionPlan',subscriptionPlanSchema);
export const SubscriptionRequest = model('SubscriptionRequest',subscriptionRequestSchema);
export const ContactList = model('ContactList', listSchema);
export const Contact = model('Contact', contactSchema);
export const Template = model('Template', templateSchema);
export const Campaign = model('Campaign', campaignSchema);
export const Delivery = model('Delivery', deliverySchema);
export const Integration = model('Integration', integrationSchema);
export const SystemSetting = model('SystemSetting',systemSettingSchema);
