import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCarouselPayload,validateCarousel,publicHttpsUrl} from '../src/services/carousel.js';

const cards=[
  {imageUrl:'https://example.com/one.jpg',caption:'*Offer 1*',buttonText:'Shop now',buttonUrl:'https://example.com/a'},
  {imageUrl:'https://example.com/two.png',caption:'_Offer 2_',buttonText:'View item',buttonUrl:'https://example.com/b'}
];

test('Meta carousel sends two CTA URL image cards in official interactive shape',()=>{
  const payload=buildCarouselPayload({to:'919876543210',text:'Hello *friend*',cards});
  assert.equal(payload.type,'interactive');
  assert.equal(payload.interactive.type,'carousel');
  assert.equal(payload.interactive.body.text,'Hello *friend*');
  assert.equal(payload.interactive.action.cards.length,2);
  const [one,two]=payload.interactive.action.cards;
  assert.equal(one.type,'cta_url');
  assert.equal(one.card_index,0);
  assert.equal(two.card_index,1);
  assert.equal(one.header.type,'image');
  assert.equal(one.header.image.link,'https://example.com/one.jpg');
  assert.equal(one.action.name,'cta_url');
  assert.equal(one.action.parameters.url,'https://example.com/a');
  assert.equal(two.body.text,'_Offer 2_');
});

test('carousel must use 2-10 cards',()=>{
  for(const count of [0,1,11])assert.throws(()=>validateCarousel({text:'Hi',cards:Array(count).fill(cards[0])}));
  assert.doesNotThrow(()=>validateCarousel({text:'Hi',cards:Array(10).fill(cards[0])}));
});

test('rejects non-public, insecure, malformed carousel URLs',()=>{
  for(const url of ['http://example.com','https://localhost/test.png','https://127.0.0.1/image.png','https://user:password@example.com/x','javascript:alert(1)','https://[::1]/x','https://host.local/path']){
    assert.throws(()=>publicHttpsUrl(url));
  }
});

test('enforces caption, button label, and text limits',()=>{
  assert.throws(()=>validateCarousel({text:'',cards}));
  assert.throws(()=>validateCarousel({text:'x'.repeat(1025),cards}));
  assert.throws(()=>validateCarousel({text:'Okay',cards:[{...cards[0],caption:'x'.repeat(161)},cards[1]]}));
  assert.throws(()=>validateCarousel({text:'Okay',cards:[{...cards[0],buttonText:'x'.repeat(21)},cards[1]]}));
  assert.throws(()=>validateCarousel({text:'Okay',cards:[{...cards[0],buttonText:' '},cards[1]]}));
  assert.throws(()=>validateCarousel({text:'Okay',cards:[{...cards[0],caption:'1\n2\n3\n4'},cards[1]]}));
});

test('rejects invalid WhatsApp recipient',()=>{
  assert.throws(()=>buildCarouselPayload({to:'123',text:'Hello',cards}));
});
