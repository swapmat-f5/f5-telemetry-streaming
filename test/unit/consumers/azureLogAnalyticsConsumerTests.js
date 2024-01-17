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
const moduleCache = require('../shared/restoreCache')();

const sinon = require('sinon');

const assert = require('../shared/assert');
const azureLogData = require('./data/azureLogAnalyticsConsumerTestsData');
const sourceCode = require('../shared/sourceCode');
const testUtil = require('../shared/util');

const azureAnalyticsIndex = sourceCode('src/lib/consumers/Azure_Log_Analytics/index');
const azureUtil = sourceCode('src/lib/consumers/shared/azureUtil');
const requestsUtil = sourceCode('src/lib/utils/requests');
const util = sourceCode('src/lib/utils/misc');

moduleCache.remember();

describe('Azure_Log_Analytics', () => {
    let clock;
    let requests;

    const defaultConsumerConfig = {
        workspaceId: 'myWorkspace',
        passphrase: 'secret',
        useManagedIdentity: false,
        allowSelfSignedCert: false
    };

    const propertyBasedConsumerConfig = {
        workspaceId: 'myWorkspace',
        passphrase: 'secret',
        useManagedIdentity: false,
        allowSelfSignedCert: false,
        format: 'propertyBased'
    };

    const getOpsInsightsReq = () => {
        const opInsightsReq = requests.find((r) => r.fullURI === 'https://myWorkspace.ods.opinsights.azure.com/api/logs?api-version=2016-04-01');
        assert.notStrictEqual(opInsightsReq, undefined);
        return opInsightsReq;
    };

    const getAllOpsInsightsReqs = () => {
        const opInsightsReqs = requests.filter((r) => r.fullURI === 'https://myWorkspace.ods.opinsights.azure.com/api/logs?api-version=2016-04-01');
        assert.notStrictEqual(opInsightsReqs, undefined);
        return opInsightsReqs;
    };

    before(() => {
        moduleCache.restore();
    });

    beforeEach(() => {
        requests = [];
        sinon.stub(requestsUtil, 'makeRequest').callsFake((opts) => {
            requests.push(opts);
            return Promise.resolve({ statusCode: 200 });
        });

        sinon.stub(azureUtil, 'getSharedKey').resolves('stubbed-shared-key');
        // Fake the clock to get consistent values in the 'x-ms-date' variable
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        sinon.restore();
        clock.restore();
    });

    describe('process', () => {
        it('should configure default request options', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: defaultConsumerConfig
            });
            context.event.data = {
                new: 'data'
            };

            return azureAnalyticsIndex(context)
                .then(() => {
                    const opInsightsReq = getOpsInsightsReq();
                    assert.deepStrictEqual(opInsightsReq.headers, {
                        Authorization: 'SharedKey myWorkspace:MGiiWY+WTAxB35tyZ1YljyfwMM5QCqr4ge+giSjcgfI=',
                        'Content-Type': 'application/json',
                        'Log-Type': 'F5Telemetry_new',
                        'x-ms-date': 'Thu, 01 Jan 1970 00:00:00 GMT'
                    });
                });
        });

        it('should configure request options with resourceId if available from context metadata', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: defaultConsumerConfig
            });
            context.event.data = {
                new: 'data'
            };
            context.metadata = {
                compute: {
                    location: 'outerspace',
                    resourceId: 'a-galaxy-far-away',
                    someOtherProp: 'made up'
                }
            };

            return azureAnalyticsIndex(context)
                .then(() => {
                    const opInsightsReq = getOpsInsightsReq();
                    assert.deepStrictEqual(opInsightsReq.headers, {
                        Authorization: 'SharedKey myWorkspace:MGiiWY+WTAxB35tyZ1YljyfwMM5QCqr4ge+giSjcgfI=',
                        'Content-Type': 'application/json',
                        'Log-Type': 'F5Telemetry_new',
                        'x-ms-date': 'Thu, 01 Jan 1970 00:00:00 GMT',
                        'x-ms-AzureResourceId': 'a-galaxy-far-away'
                    });
                });
        });

        it('should configure request options with provided values', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: {
                    workspaceId: 'myWorkspace',
                    passphrase: 'secret',
                    logType: 'customLogType',
                    allowSelfSignedCert: true
                }
            });
            context.event.data = {
                new: 'data'
            };

            return azureAnalyticsIndex(context)
                .then(() => {
                    const opInsightsReq = getOpsInsightsReq();
                    assert.deepStrictEqual(opInsightsReq.headers, {
                        Authorization: 'SharedKey myWorkspace:MGiiWY+WTAxB35tyZ1YljyfwMM5QCqr4ge+giSjcgfI=',
                        'Content-Type': 'application/json',
                        'Log-Type': 'customLogType_new',
                        'x-ms-date': 'Thu, 01 Jan 1970 00:00:00 GMT'
                    });
                    assert.deepStrictEqual(opInsightsReq.allowSelfSignedCert, true);
                });
        });

        it('should trace data with secrets redacted', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: {
                    workspaceId: 'myWorkspace',
                    passphrase: 'secret',
                    logType: 'customLogType'
                }
            });
            context.event.data = {
                new: 'data'
            };

            return azureAnalyticsIndex(context)
                .then(() => {
                    const opInsightsReq = getOpsInsightsReq();
                    assert.deepStrictEqual(opInsightsReq.headers, {
                        Authorization: 'SharedKey myWorkspace:MGiiWY+WTAxB35tyZ1YljyfwMM5QCqr4ge+giSjcgfI=',
                        'Content-Type': 'application/json',
                        'Log-Type': 'customLogType_new',
                        'x-ms-date': 'Thu, 01 Jan 1970 00:00:00 GMT'
                    });
                    const traceData = context.tracer.write.firstCall.args[0];
                    assert.strictEqual(traceData[0].headers.Authorization, '*****');
                });
        });

        it('should process systemInfo data', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: defaultConsumerConfig
            });
            return azureAnalyticsIndex(context)
                .then(() => assert.sameDeepMembers(getAllOpsInsightsReqs(), azureLogData.systemData[0].expectedData));
        });

        it('should process systemInfo data with propertyBased setting', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: propertyBasedConsumerConfig
            });
            return azureAnalyticsIndex(context)
                .then(() => assert.sameDeepMembers(getAllOpsInsightsReqs(),
                    azureLogData.propertyBasedSystemData[0].expectedData));
        });

        it('should process event data', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'AVR',
                config: util.deepCopy(defaultConsumerConfig)
            });
            context.config.allowSelfSignedCert = true;
            const expectedData = azureLogData.eventData[0].expectedData;
            context.event.type = 'AVR';

            return azureAnalyticsIndex(context)
                .then(() => assert.deepStrictEqual(getAllOpsInsightsReqs(), expectedData));
        });

        it('should generate sharedKey to use when useManagedIdentity is true', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: {
                    workspaceId: 'myWorkspace',
                    useManagedIdentity: true,
                    logType: 'customLogType'
                }
            });
            context.event.data = {
                type1: { prop: 'data' }
            };
            const expSignedKey = azureUtil.signSharedKey(
                'stubbed-shared-key',
                'Thu, 01 Jan 1970 00:00:00 GMT',
                JSON.stringify([{ prop: 'data' }])
            );
            return azureAnalyticsIndex(context)
                .then(() => {
                    const opInsightsReq = getOpsInsightsReq();
                    assert.strictEqual(opInsightsReq.fullURI, 'https://myWorkspace.ods.opinsights.azure.com/api/logs?api-version=2016-04-01');
                    assert.deepStrictEqual(opInsightsReq.headers, {
                        Authorization: `SharedKey myWorkspace:${expSignedKey}`,
                        'Content-Type': 'application/json',
                        'Log-Type': 'customLogType_type1',
                        'x-ms-date': 'Thu, 01 Jan 1970 00:00:00 GMT'
                    });
                });
        });
    });
});
