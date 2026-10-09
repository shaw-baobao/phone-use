import test from 'node:test';
import assert from 'node:assert/strict';
import { inputError } from '../ui/controls.mjs';
const connected={device:{id:'test'},mode:'manual',paused:false,busy:false,live:false};
test('video loss disables coordinate input but leaves Home and Recent apps available',()=>{
  assert.equal(inputError(connected,'home'),null); assert.equal(inputError(connected,'recent'),null);
  assert.match(inputError(connected,'tap'),/fresh screen/); assert.equal(inputError({...connected,live:true},'tap'),null);
});
test('blocked input has an explicit reason and ownership is enforced',()=>{
  assert.match(inputError({},'home'),/Connect/); assert.match(inputError({...connected,mode:'ai'},'home'),/take control/);
  assert.match(inputError({...connected,paused:true},'home'),/Resume/); assert.match(inputError({...connected,busy:true},'home'),/processing/);
});
