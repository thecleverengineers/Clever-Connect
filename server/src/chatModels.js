import mongoose from 'mongoose';
const {Schema,model}=mongoose;
const opts={timestamps:true};

const conversation=new Schema({
 workspaceId:{type:Schema.Types.ObjectId,required:true,index:true},
 integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true,index:true},
 phone:{type:String,required:true},
 contactId:{type:Schema.Types.ObjectId,ref:'Contact',default:null},
 lastMessageAt:{type:Date,default:Date.now,index:true},
 lastInboundAt:Date,
 lastPreview:{type:String,default:''},
 unreadCount:{type:Number,default:0,min:0},
 assignedTo:{type:Schema.Types.ObjectId,ref:'User',default:null},
 botPaused:{type:Boolean,default:false},
 activeFlowId:{type:Schema.Types.ObjectId,ref:'ChatFlow',default:null},
 awaitingNodeId:{type:String,default:''},
 flowVariables:{type:Map,of:String,default:{}}
},opts);
conversation.index({workspaceId:1,integrationId:1,phone:1},{unique:true});
conversation.index({workspaceId:1,lastMessageAt:-1});

const chatMessage=new Schema({
 workspaceId:{type:Schema.Types.ObjectId,required:true,index:true},
 conversationId:{type:Schema.Types.ObjectId,ref:'ChatConversation',required:true,index:true},
 integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true},
 phone:{type:String,required:true},
 providerMessageId:{type:String,default:''},
 direction:{type:String,enum:['in','out'],required:true},
 type:{type:String,enum:['text','image','video','document','audio','interactive','unknown'],default:'text'},
 text:{type:String,default:''},
 status:{type:String,enum:['received','queued','submitted','sent','delivered','read','failed'],default:'received'},
 source:{type:String,enum:['customer','campaign','agent','chatbot'],default:'customer'},
 campaignId:{type:Schema.Types.ObjectId,ref:'Campaign',default:null},
 deliveryId:{type:Schema.Types.ObjectId,ref:'Delivery',default:null},
 replyToId:{type:String,default:''},
 metaTimestamp:Date,
 error:{type:String,default:''}
},opts);
chatMessage.index({integrationId:1,providerMessageId:1},{unique:true,partialFilterExpression:{providerMessageId:{$gt:''}}});
chatMessage.index({workspaceId:1,conversationId:1,createdAt:1});

const node=new Schema({
 id:{type:String,required:true},
 type:{type:String,enum:['message','buttons','handoff','end'],required:true},
 text:{type:String,default:''},
 nextId:{type:String,default:''},
 choices:[{_id:false,id:String,label:String,nextId:String}]
},{_id:false});

const chatFlow=new Schema({
 workspaceId:{type:Schema.Types.ObjectId,required:true,index:true},
 name:{type:String,required:true,trim:true,maxlength:100},
 integrationId:{type:Schema.Types.ObjectId,ref:'Integration',required:true},
 enabled:{type:Boolean,default:false,index:true},
 triggerType:{type:String,enum:['contains','exact','any'],default:'contains'},
 triggerText:{type:String,default:'',maxlength:100},
 startNodeId:{type:String,required:true},
 nodes:[node],
 priority:{type:Number,default:0},
 lastError:{type:String,default:''}
},opts);
chatFlow.index({workspaceId:1,integrationId:1,enabled:1,priority:-1});

export const ChatConversation=model('ChatConversation',conversation);
export const ChatMessage=model('ChatMessage',chatMessage);
export const ChatFlow=model('ChatFlow',chatFlow);
