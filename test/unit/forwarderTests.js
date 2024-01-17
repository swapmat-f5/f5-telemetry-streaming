/**
 * Copyright 2024 F5, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/* eslint-disable import/order */
const moduleCache = require('./shared/restoreCache')();

const sinon = require('sinon');

const assert = require('./shared/assert');
const sourceCode = require('./shared/sourceCode');

const actionProcessor = sourceCode('src/lib/actionProcessor');
const DataFilter = sourceCode('src/lib/dataFilter').DataFilter;
const forwarder = sourceCode('src/lib/forwarder');
const consumers = sourceCode('src/lib/consumers');

moduleCache.remember();

describe('Forwarder', () => {
    const config = {
        type: 'consumerType',
        traceName: 'testConsumer'
    };
    const type = 'dataType';
    const data = { foo: 'bar' };
    const metadata = { compute: { onlyWhenAvailable: true } };

    before(() => {
        moduleCache.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should forward to correct consumers', () => {
        let actualContext;
        const consumersCalled = [];
        sinon.stub(consumers, 'getConsumers').returns([
            {
                consumer: (context) => {
                    actualContext = context;
                    consumersCalled.push('uuid1');
                },
                id: 'uuid1',
                config,
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            },
            {
                consumer: (context) => {
                    actualContext = { orig: context, modified: true };
                    consumersCalled.push('uuid2');
                },
                id: 'uuid2',
                config,
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            },
            {
                consumer: (context) => {
                    actualContext = context;
                    consumersCalled.push('uuid3');
                },
                id: 'uuid3',
                config,
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            }
        ]);
        const mockContext = { type, data, destinationIds: ['uuid1', 'uuid3'] };
        return assert.isFulfilled(forwarder.forward(mockContext)
            .then(() => {
                assert.deepStrictEqual(actualContext.event.data, data);
                assert.deepStrictEqual(actualContext.config, config);
                assert.deepStrictEqual(actualContext.metadata, metadata);
                assert.deepStrictEqual(consumersCalled, ['uuid1', 'uuid3']);
            }));
    });

    it('should process any defined actions', () => {
        const consumersCalled = [];
        const processActionsStub = sinon.stub(actionProcessor, 'processActions');
        sinon.stub(consumers, 'getConsumers').returns([
            {
                consumer: () => {
                    consumersCalled.push('uuid1');
                },
                id: 'uuid1',
                config: {
                    type: 'consumerType',
                    traceName: 'testConsumer',
                    actions: [{
                        enable: true,
                        JMESPath: {},
                        expression: '{ message: @ }'
                    }]
                },
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            }
        ]);
        const mockContext = { type, data, destinationIds: ['uuid1'] };
        return assert.isFulfilled(forwarder.forward(mockContext)
            .then(() => {
                assert.strictEqual(processActionsStub.calledOnce, true, 'should be called only once');
                assert.deepStrictEqual(
                    processActionsStub.firstCall.args[1],
                    [
                        {
                            enable: true,
                            JMESPath: {},
                            expression: '{ message: @ }'
                        }
                    ]
                );
                assert.deepStrictEqual(consumersCalled, ['uuid1'], 'should still call consumer when actions are used');
            }));
    });

    it('should still forward the data if the action processor fails', () => {
        const consumersCalled = [];
        const processActionsStub = sinon.stub(actionProcessor, 'processActions').throws(new Error('ERROR'));
        sinon.stub(consumers, 'getConsumers').returns([
            {
                consumer: () => {
                    consumersCalled.push('uuid1');
                },
                id: 'uuid1',
                config: {
                    type: 'consumerType',
                    traceName: 'testConsumer',
                    actions: [{
                        enable: true,
                        JMESPath: {},
                        expression: 'badexpression'
                    }]
                },
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            }
        ]);
        const mockContext = { type, data, destinationIds: ['uuid1'] };
        return assert.isFulfilled(forwarder.forward(mockContext)
            .then(() => {
                assert.strictEqual(processActionsStub.calledOnce, true, 'should be called only once');
                assert.deepStrictEqual(
                    processActionsStub.firstCall.args[1],
                    [
                        {
                            enable: true,
                            JMESPath: {},
                            expression: 'badexpression'
                        }
                    ]
                );
                assert.deepStrictEqual(processActionsStub.exceptions[0].message, 'ERROR');
                assert.deepStrictEqual(consumersCalled, ['uuid1'], 'should still call consumer when actions are used');
            }));
    });

    it('should not allow consumer actions to modify another consumer\'s data', () => {
        const consumerContexts = [];
        const processActionsStub = sinon.stub(actionProcessor, 'processActions').callsFake((event, actions) => {
            actions = actions || [];
            actions.forEach((action) => {
                if (action.JMESPath) {
                    event.data = 'modifiedData';
                }
            });
        });
        sinon.stub(consumers, 'getConsumers').returns([
            {
                consumer: (context) => {
                    consumerContexts.push({ id: 'uuid1', data: context.event.data });
                },
                id: 'uuid1',
                config: {
                    type: 'consumerType',
                    traceName: 'testConsumer',
                    actions: [{
                        enable: true,
                        JMESPath: {},
                        expression: '{ message: @ }'
                    }]
                },
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            },
            {
                consumer: (context) => {
                    consumerContexts.push({ id: 'uuid2', data: context.event.data });
                },
                id: 'uuid2',
                config,
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata
            }
        ]);
        const mockContext = { type, data, destinationIds: ['uuid1', 'uuid2'] };
        return assert.isFulfilled(forwarder.forward(mockContext)
            .then(() => {
                assert.strictEqual(processActionsStub.calledTwice, true, 'should be called for each consumer');
                assert.deepStrictEqual(consumerContexts, [
                    { id: 'uuid1', data: 'modifiedData' },
                    { id: 'uuid2', data: { foo: 'bar' } }
                ], 'should only modify first consumer\'s data');
            }));
    });

    it('should resolve with no consumers', () => {
        sinon.stub(consumers, 'getConsumers').returns(null);
        return assert.isFulfilled(forwarder.forward({ type, data, destinationIds: [] }));
    });

    it('should resolve on consumer error', () => {
        sinon.stub(consumers, 'getConsumers').returns([
            {
                consumer: () => {
                    throw new Error('foo');
                },
                config,
                id: 'uuid123',
                tracer: null,
                filter: new DataFilter({}),
                logger: {},
                metadata: {}
            }
        ]);
        return assert.isFulfilled(forwarder.forward({ type, data, destinationIds: ['uuid123'] }));
    });
});
