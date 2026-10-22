import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeDeliveryActivity,deliveryAggregationPipeline} from '../src/services/dashboardStats.js';

test('dashboard aggregates 14 days of delivery statuses without fetching recipient rows',()=>{
  const now=new Date('2026-10-22T12:00:00.000Z');
  const summary=summarizeDeliveryActivity([
    {_id:{date:'2026-10-22',status:'submitted'},total:5},
    {_id:{date:'2026-10-22',status:'delivered'},total:4},
    {_id:{date:'2026-10-22',status:'read'},total:1},
    {_id:{date:'2026-10-21',status:'failed'},total:2},
    {_id:{date:'2026-10-21',status:'acceptance_unknown'},total:2},
    {_id:{date:'2026-10-08',status:'sent'},total:99}
  ],now);
  assert.equal(summary.activity.length,14);
  assert.equal(summary.activity[0].date,'2026-10-09');
  assert.equal(summary.activity.at(-1).date,'2026-10-22');
  assert.equal(summary.submitted,10);
  assert.equal(summary.delivered,5);
  assert.equal(summary.read,1);
  assert.equal(summary.failed,2);
  assert.equal(summary.deliveryRate,50);
  assert.deepEqual(
    summary.activity.at(-1),
    {date:'2026-10-22',submitted:10,delivered:5,failed:0}
  );
  assert.equal(summary.activity.at(-2).failed,2);
});

test('empty periods show a complete, zero-valued chart with no divide-by-zero',()=>{
  const result=summarizeDeliveryActivity([],new Date('2026-10-22T00:01:00Z'));
  assert.equal(result.deliveryRate,0);
  assert.equal(result.submitted,0);
  assert.equal(result.activity.length,14);
  assert.ok(result.activity.every(x=>x.submitted===0&&x.delivered===0&&x.failed===0));
});

test('aggregation is restricted to workspace and date with database-side grouping',()=>{
  const workspaceId='test-workspace';
  const since=new Date('2026-10-09T00:00:00Z');
  const stages=deliveryAggregationPipeline(workspaceId,since);
  assert.equal(stages[0].$match.workspaceId,workspaceId);
  assert.equal(stages[0].$match.createdAt.$gte,since);
  assert.equal(stages[1].$group.total.$sum,1);
  assert.equal(stages.some(x=>Boolean(x.$lookup)),false);
});
