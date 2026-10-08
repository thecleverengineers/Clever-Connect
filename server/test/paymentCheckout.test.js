import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderDetails,normalizedPhone,safeReference} from '../src/services/paymentCheckout.js';

test('native Razorpay order uses INR minor units and a merchant payment configuration',()=>{
  const body=buildOrderDetails({
    to:'919876543210',referenceId:'WS123',title:'Invoice 004',
    amountPaise:249900,configurationName:'business-razorpay'
  });
  assert.equal(body.type,'interactive');
  assert.equal(body.interactive.type,'order_details');
  const p=body.interactive.action.parameters;
  assert.equal(p.currency,'INR');
  assert.equal(p.total_amount.value,249900);
  assert.equal(p.total_amount.offset,100);
  assert.equal(p.order.subtotal.value,249900);
  assert.equal(p.order.items[0].amount.value,249900);
  assert.equal(p.payment_settings[0].payment_gateway.type,'razorpay');
  assert.equal(p.payment_settings[0].payment_gateway.configuration_name,'business-razorpay');
});

test('rejects invalid phone, amount, reference and missing payment configuration',()=>{
  const base={to:'919876543210',referenceId:'WS123',title:'Invoice',amountPaise:100,configurationName:'rp-config'};
  for(const edits of [{to:'123'},{amountPaise:0},{amountPaise:NaN},{amountPaise:100.5},{referenceId:'%unsafe'},{configurationName:''}]){
    assert.throws(()=>buildOrderDetails({...base,...edits}));
  }
});

test('reference IDs are unique-looking and fit the Meta length limit',()=>{
  const a=safeReference(),b=safeReference();
  assert.notEqual(a,b);assert.ok(a.length<=35);assert.match(a,/^[A-Za-z0-9_-]+$/);
});

test('normalizes saved contact numbers for Meta',()=>{
  assert.equal(normalizedPhone('+91 98765 43210'),'919876543210');
});
