import test from 'node:test';
import assert from 'node:assert/strict';
import {
  singleSendMode,resolveSingleRecipientText,
  singleTemplateValues,previewSingleTemplate
} from '../src/services/singleMessage.js';

test('FreeForm and approved-template modes cannot silently switch between formats',()=>{
  assert.equal(singleSendMode({sendMode:'freeform'}),'freeform');
  assert.equal(singleSendMode({sendMode:'template',templateId:'abc'}),'template');
  assert.equal(singleSendMode({templateId:'abc'}),'template');
  assert.equal(singleSendMode({message:'Hello'}),'freeform');
  assert.throws(()=>singleSendMode({sendMode:'freeform',templateId:'abc'}),/Switch to Meta Approved Template/);
  assert.throws(()=>singleSendMode({sendMode:'template'}),/Choose a Meta-approved template/);
  assert.throws(()=>singleSendMode({sendMode:'unsupported'}),/Choose FreeForm Message/);
});

test('FreeForm personalization interpolates only allowed customer attributes',()=>{
  const text=resolveSingleRecipientText('Hello {{name}}! Reach {{phone}} or {{email}}. {{other}}',
    {name:'Rina',phone:'+919000001234',email:'rina@example.com'});
  assert.equal(text,'Hello Rina! Reach +919000001234 or rina@example.com. {{other}}');
  assert.equal(resolveSingleRecipientText('Hello {{name}}',{}),'Hello ');
});

test('approved template variable values require exact count and retain order',()=>{
  const customer={name:'Rina',phone:'+919000001234',email:'rina@example.com'};
  const template='Hi {{1}}. Your order {{2}} arrives soon.';
  const values=singleTemplateValues(template,['{{name}}','ORDER-44'],customer);
  assert.deepEqual(values,['Rina','ORDER-44']);
  assert.equal(previewSingleTemplate(template,values),'Hi Rina. Your order ORDER-44 arrives soon.');
  assert.throws(()=>singleTemplateValues(template,['Rina'],customer),/2 variable/);
  assert.throws(()=>singleTemplateValues(template,['Rina',''],customer),/Fill every/);
  assert.deepEqual(singleTemplateValues('Plain template',[],customer),[]);
  assert.throws(()=>singleTemplateValues('Plain template',['extra'],customer),/0 variable/);
  assert.throws(()=>singleTemplateValues('Hello {{21}}',Array(21).fill('x'),customer),/Maximum 20/);
});
