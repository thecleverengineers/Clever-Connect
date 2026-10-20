import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTemplate,createMetaTemplatePayload,remoteTemplateFields,
  isTemplateUsable,recommendTemplate,draftRecommendation
} from '../src/services/metaTemplateManager.js';

const base={name:'Appointment Reminder',language:'en_US',category:'UTILITY',body:'Hello {{1}}, your appointment is {{2}}.',
  bodyExamples:['Alex','tomorrow'],headerFormat:'NONE',buttons:[]};
test('build Meta body examples and interactive buttons',()=>{
  const p=createMetaTemplatePayload({...base,headerFormat:'TEXT',headerText:'Appointment',footerText:'Thank you',buttons:[
    {type:'QUICK_REPLY',text:'Confirm'},{type:'URL',text:'Details',url:'https://example.com/order'}
  ]});
  assert.equal(p.name,'appointment_reminder');
  assert.equal(p.components[0].type,'HEADER');
  assert.deepEqual(p.components.find(x=>x.type==='BODY').example,{body_text:[['Alex','tomorrow']]});
  assert.equal(p.components.find(x=>x.type==='BUTTONS').buttons[1].url,'https://example.com/order');
});
test('require uploaded Meta sample handle and public HTTPS send URL for media headers',()=>{
  assert.throws(()=>createMetaTemplatePayload({...base,headerFormat:'IMAGE'}),/Upload a Meta sample/);
  assert.throws(()=>createMetaTemplatePayload({...base,headerFormat:'VIDEO',headerHandle:'sample-handle'}),/public HTTPS/);
  const p=createMetaTemplatePayload({...base,headerFormat:'DOCUMENT',headerHandle:'sample-handle',headerMediaUrl:'https://cdn.example.com/sample.pdf'});
  assert.deepEqual(p.components[0],{type:'HEADER',format:'DOCUMENT',example:{header_handle:['sample-handle']}});
  assert.throws(()=>normalizeTemplate({...base,headerMediaUrl:'http://example.com/x'}),/public HTTPS/);
});
test('contiguous body examples required for submitted Meta templates',()=>{
  assert.throws(()=>createMetaTemplatePayload({...base,body:'{{2}} only'}),/contiguous/);
  assert.throws(()=>createMetaTemplatePayload({...base,body:'Hi {{1}}',bodyExamples:[]}),/sample/);
});
test('preserve remote rejection feedback and nonstandard statuses',()=>{
  const remote=remoteTemplateFields({id:'123',name:'hello',language:'en_US',status:'IN_APPEAL',category:'MARKETING',
    rejected_reason:'VARIABLE_FORMAT',quality_score:{score:'LOW'},components:[{type:'BODY',text:'Hi'}]});
  assert.equal(remote.metaStatus,'IN_APPEAL');
  assert.equal(remote.metaRejectedReason,'VARIABLE_FORMAT');
  assert.equal(remote.metaQualityScore,'LOW');
});
test('only approved connected non-authentication templates with required media are usable',()=>{
  const profile={id:'1',provider:'meta',enabled:true,planAllowed:true,connectionStatus:'connected'};
  const template={integrationId:'1',metaStatus:'APPROVED',metaTemplateName:'hello',metaTemplateId:'22',category:'UTILITY',headerFormat:'NONE'};
  assert.equal(isTemplateUsable(template,profile),true);
  assert.equal(isTemplateUsable({...template,metaStatus:'PAUSED'},profile),false);
  assert.equal(isTemplateUsable({...template,headerFormat:'IMAGE'},profile),false);
  assert.equal(isTemplateUsable({...template,headerFormat:'IMAGE',headerMediaUrl:'https://cdn.example.com/x.jpg'},profile),true);
  assert.equal(isTemplateUsable(template,{...profile,planAllowed:false}),false);
});
test('recommend matches existing approved content before proposing review-only draft',()=>{
  assert.equal(recommendTemplate([{name:'appointment_confirm',body:'Confirm appointment tomorrow',category:'UTILITY',metaStatus:'APPROVED'},
    {name:'promo',body:'appointment tomorrow',category:'MARKETING',metaStatus:'PENDING'}],'appointment')[0].name,'appointment_confirm');
  const d=draftRecommendation('Confirm tomorrow service appointment');
  assert.equal(d.isSuggestedDraft,true);
  assert.match(d.body,/\{\{1\}\}/);
});
