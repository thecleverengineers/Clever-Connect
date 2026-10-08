import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import auth from './routes/auth.js';
import contacts from './routes/contacts.js';
import lists from './routes/lists.js';
import templates from './routes/templates.js';
import campaigns from './routes/campaigns.js';
import dashboard from './routes/dashboard.js';
import integrations from './routes/integrations.js';
import webhook from './routes/webhook.js';
import {runDueCampaigns} from './services/scheduler.js';
import {mongoUri} from './db.js';

await mongoose.connect(mongoUri(),{serverSelectionTimeoutMS:12000});

const app=express();
app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(helmet());
const origins=(process.env.CLIENT_URL||'http://localhost:5173').split(',').map(x=>x.trim()).filter(Boolean);
app.use(cors({
  origin(origin,cb){
    if(!origin||origins.includes(origin)) return cb(null,true);
    cb(new Error('Origin not allowed'));
  },
  credentials:true
}));
app.use(express.json({limit:'1mb'}));
app.use(cookieParser());

const authLimiter=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:true,legacyHeaders:false});
const apiLimiter=rateLimit({windowMs:60*1000,limit:600,standardHeaders:true,legacyHeaders:false});
app.use('/api/auth',authLimiter,auth);
app.use('/api/contacts',apiLimiter,contacts);
app.use('/api/lists',apiLimiter,lists);
app.use('/api/templates',apiLimiter,templates);
app.use('/api/campaigns',apiLimiter,campaigns);
app.use('/api/dashboard',apiLimiter,dashboard);
app.use('/api/integrations',apiLimiter,integrations);
app.use('/api/webhooks/meta',webhook);

app.get('/api/health',(req,res)=>res.json({
  ok:mongoose.connection.readyState===1,
  service:'clever-connect-api',
  database:mongoose.connection.readyState===1?'connected':'unavailable',
  scheduler:'in-process-60s',
  time:new Date().toISOString()
}));

app.use('/api',(req,res)=>res.status(404).json({message:'API route not found'}));
app.use((err,req,res,next)=>{
  console.error(err);
  if(err.message==='Origin not allowed') return res.status(403).json({message:'Origin not allowed'});
  res.status(500).json({message:'Unexpected server error'});
});

const port=process.env.PORT||5000;
app.listen(port,()=>console.log('Clever Connect API listening on '+port));
setInterval(()=>runDueCampaigns().catch(console.error),60_000).unref();
