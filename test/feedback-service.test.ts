import assert from 'node:assert';

const feedbackService: any = require('../src/services/feedback-service');
const { Feedback } = require('../src/models/mongodb');

export async function runTests() {
  await testFeedbackServiceExports();
  await testFeedbackSchemaContainsProcessedByRef();
}

async function testFeedbackServiceExports() {
  assert.strictEqual(typeof feedbackService.listFeedback, 'function');
}

async function testFeedbackSchemaContainsProcessedByRef() {
  const processedByPath = Feedback.schema.path('processedBy');

  assert.ok(processedByPath, 'processedBy path should exist on Feedback schema');
  assert.strictEqual(processedByPath.instance, 'ObjectId');
  assert.strictEqual(processedByPath.options?.ref, 'User');
}