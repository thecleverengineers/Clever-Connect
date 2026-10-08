import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMediaUrl,parsePublicMediaUrl,digestToken} from '../src/routes/media.js';

test('opaque campaign media links roundtrip in configured public origin',()=>{
  const id='507f1f77bcf86cd799439011';
  const token='a'.repeat(64);
  const url=publicMediaUrl(id,token);
  assert.match(url,/^https?:\/\//);
  assert.deepEqual(parsePublicMediaUrl(url),{id,token});
});
test('campaign image links cannot be replaced with unrelated or invalid public URLs',()=>{
  const token='b'.repeat(64);
  assert.equal(parsePublicMediaUrl('https://evil.example/media/'+token),null);
  assert.equal(parsePublicMediaUrl(publicMediaUrl('507f1f77bcf86cd799439011','short')),null);
  assert.equal(parsePublicMediaUrl(publicMediaUrl('invalid-id',token)),null);
});
test('image access token is stored only as a digest',()=>{
  const a='a'.repeat(64),b='b'.repeat(64);
  assert.equal(digestToken(a).length,64);
  assert.notEqual(digestToken(a),a);
  assert.notEqual(digestToken(a),digestToken(b));
});
