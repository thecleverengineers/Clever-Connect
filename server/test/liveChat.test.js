import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlow,inboundText,inboundValue,digits} from '../src/services/liveChat.js';

const flow={
 name:'Welcome',triggerType:'contains',triggerText:'hello',startNodeId:'start',enabled:true,
 nodes:[
  {id:'start',type:'buttons',text:'Choose an option',choices:[
   {id:'sales',label:'Sales',nextId:'handoff'},
   {id:'help',label:'Help',nextId:'finish'}
  ]},
  {id:'handoff',type:'handoff'},
  {id:'finish',type:'end'}
 ]
};
test('validates branch targets and Meta 3-button maximum',()=>{
 const got=validateFlow(flow);
 assert.equal(got.nodes.length,3);
 assert.equal(got.nodes[0].choices[0].nextId,'handoff');
 assert.equal(got.enabled,true);
});
test('rejects unsafe graph configurations',()=>{
 assert.throws(()=>validateFlow({...flow,startNodeId:'missing'}));
 assert.throws(()=>validateFlow({...flow,nodes:[...flow.nodes,{...flow.nodes[0]}]}));
 assert.throws(()=>validateFlow({...flow,nodes:[{...flow.nodes[0],choices:[...flow.nodes[0].choices,{id:'a',label:'A'},{id:'b',label:'B'}]},...flow.nodes.slice(1)]}));
 assert.throws(()=>validateFlow({...flow,nodes:[{...flow.nodes[0],choices:[{id:'bad',label:'X',nextId:'missing'}]},...flow.nodes.slice(1)]}));
 assert.throws(()=>validateFlow({...flow,name:''}));
 assert.throws(()=>validateFlow({...flow,triggerText:''}));
});
test('extracts customer text and interactive quick replies',()=>{
 assert.equal(inboundText({text:{body:'Hello!'}}),'Hello!');
 assert.equal(inboundValue({interactive:{button_reply:{id:'sales',title:'Sales'}}}),'sales');
 assert.equal(inboundText({interactive:{button_reply:{id:'sales',title:'Sales'}}}),'Sales');
 assert.equal(digits('+91 98765 43210'),'919876543210');
});
