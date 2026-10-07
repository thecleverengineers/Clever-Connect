import 'dotenv/config';import mongoose from'mongoose';import{runDueCampaigns}from'../src/services/scheduler.js';
if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is required');await mongoose.connect(process.env.MONGODB_URI);const count=await runDueCampaigns();console.log(`Processed ${count} due campaign(s)`);await mongoose.disconnect();
