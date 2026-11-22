'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../render/format.js');
test('Korean 9999/10000/100000000 boundaries and large values',()=>{assert.equal(F.number(9999),'9,999');assert.equal(F.number(10000),'1만');assert.equal(F.number(100000000),'1억');assert.equal(F.number(1e12),'1조');assert.equal(F.number(123456),'12.34만');assert.equal(F.number(0), '0');assert.equal(F.number(Infinity),'아주 많아요');});
test('displayed costs round up without claiming an unaffordable price',()=>{assert.equal(F.cost(20.1),'21');assert.equal(F.cost(10001),'1.01만');assert.equal(F.cost(9999.1),'1만');assert.equal(F.cost(1e8+1),'1.01억');});
