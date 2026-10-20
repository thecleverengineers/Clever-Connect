import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAttributeKey,publicAttribute,renderFlowText} from '../src/services/flowAttributes.js';
import {validateFlow} from '../src/services/liveChat.js';

test('validates workspace attribute keys and reserves built-in fields',()=>{
  assert.equal(validateAttributeKey(' SUPPORT_HOURS '),'support_hours');
  assert.throws(()=>validateAttributeKey('customer_name'),/reserved/);
  assert.throws(()=>validateAttributeKey('$secret'),/key/);
  assert.throws(()=>validateAttributeKey('a'),/key/);
  assert.throws(()=>validateAttributeKey('a'.repeat(49)),/key/);
});

test('redacts global secrets from API responses regardless of value',()=>{
  const safe=publicAttribute({_id:'a',key:'private_key',scope:'global',label:'Secret',isSecret:true,secretEncrypted:'ciphertext',value:'should-not-leak',enabled:true});
  assert.equal(safe.value,'');
  assert.equal(safe.hasValue,true);
  assert.equal(JSON.stringify(safe).includes('should-not-leak'),false);
  assert.equal(JSON.stringify(safe).includes('ciphertext'),false);
});

test('only nonsecret enabled global attributes and supplied user values interpolate',()=>{
  const result=renderFlowText('Hi {{customer_name}} at {{customer_mobile}}. Open {{support_hours}}. VIP: {{tier}}. Secret {{api_key}}!',{
    contact:{name:'Rina',phone:'+919876543210'},
    globals:[
      {key:'support_hours',scope:'global',enabled:true,isSecret:false,value:'9–5'},
      {key:'api_key',scope:'global',enabled:true,isSecret:true,value:'SHOULD_NOT_LEAK'},
      {key:'disabled',scope:'global',enabled:false,isSecret:false,value:'HIDDEN'}
    ],
    values:{tier:'gold'}
  });
  assert.equal(result,'Hi Rina at +919876543210. Open 9–5. VIP: gold. Secret !');
  assert.equal(renderFlowText('{{customer_name}}', {contact:{name:'N'}}),'N');
  assert.equal(renderFlowText('{{constructor}}'), '');
  assert.equal(renderFlowText('{{customer_name}}',{contact:{name:'x'.repeat(2000)}}).length,1024);
});

test('flow graph persists safe bounded positions without changing routing',()=>{
  const value=validateFlow({
    name:'Support',triggerType:'contains',triggerText:'help',startNodeId:'first',
    nodes:[
      {id:'first',type:'message',text:'Hello {{customer_name}}',nextId:'done',position:{x:202,y:155}},
      {id:'done',type:'end',position:{x:540,y:362}}
    ]
  });
  assert.deepEqual(value.nodes[0].position,{x:202,y:155});
  assert.equal(value.nodes[0].nextId,'done');
  const bounded=validateFlow({...value,nodes:value.nodes.map(n=>({...n,position:{x:99999,y:-30}}))});
  assert.deepEqual(bounded.nodes[0].position,{x:4000,y:0});
});
