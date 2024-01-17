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

const AWS = require('aws-sdk');
const sinon = require('sinon');

const assert = require('../shared/assert');
const sourceCode = require('../shared/sourceCode');
const testUtil = require('../shared/util');

const awsS3Index = sourceCode('src/lib/consumers/AWS_S3/index');

moduleCache.remember();

describe('AWS_S3', () => {
    let clock;
    let awsConfigUpdate;
    let s3PutObjectParams;
    let s3ConstructorParams;

    const defaultConsumerConfig = {
        region: 'us-west-1',
        bucket: 'dataBucket',
        username: 'awsuser',
        passphrase: 'awssecret'
    };

    before(() => {
        moduleCache.restore();
    });

    beforeEach(() => {
        awsConfigUpdate = sinon.stub(AWS.config, 'update').resolves();
        sinon.stub(AWS, 'S3').callsFake((s3Params) => {
            s3ConstructorParams = s3Params;
            return {
                putObject: (params, cb) => {
                    s3PutObjectParams = params;
                    cb(null, '');
                }
            };
        });

        // stub getDate() since it attempts to convert into 'local' time.
        sinon.stub(Date.prototype, 'getDate').returns('4');
        // Fake the clock to get a consistent S3 object Key value (which are partitioned by time)
        clock = sinon.useFakeTimers({
            now: new Date('Feb 4, 2019 01:02:03 GMT+00:00'),
            shouldAdvanceTime: true,
            advanceTimeDelta: 20
        });
    });

    afterEach(() => {
        clock.restore();
        sinon.restore();
    });

    it('should configure AWS access when credentials present', () => {
        let optionsParam;
        awsConfigUpdate.callsFake((options) => {
            optionsParam = options;
        });
        const context = testUtil.buildConsumerContext({
            config: defaultConsumerConfig
        });

        return awsS3Index(context)
            .then(() => {
                assert.strictEqual(optionsParam.region, 'us-west-1');
                assert.deepStrictEqual(
                    optionsParam.credentials,
                    new AWS.Credentials({ accessKeyId: 'awsuser', secretAccessKey: 'awssecret' })
                );
            });
    });

    it('should configure AWS access without credentials (IAM role-based permissions)', () => {
        let optionsParam;
        awsConfigUpdate.callsFake((options) => {
            optionsParam = options;
        });
        const context = testUtil.buildConsumerContext({
            config: {
                region: 'us-east-1',
                bucket: 'dataBucket'
            }
        });

        return awsS3Index(context)
            .then(() => {
                assert.strictEqual(optionsParam.region, 'us-east-1');
                assert.strictEqual(optionsParam.credentials, undefined);
            });
    });

    it('should supply endpointUrl to AWS client', () => {
        sinon.stub(AWS, 'Endpoint').callsFake((params) => ({ params }));

        const context = testUtil.buildConsumerContext({
            config: {
                endpointUrl: 'full-endpoint-url'
            }
        });

        return awsS3Index(context)
            .then(() => {
                assert.deepStrictEqual(s3ConstructorParams.endpoint, { params: 'full-endpoint-url' });
            });
    });

    it('should configure AWS access with custom agent', () => {
        let optionsParam;
        awsConfigUpdate.callsFake((options) => {
            optionsParam = options;
        });
        const context = testUtil.buildConsumerContext({
            config: defaultConsumerConfig
        });

        return awsS3Index(context)
            .then(() => {
                assert.ok(optionsParam.httpOptions.agent.options, 'AWS should have custom Agent');
            });
    });

    describe('process', () => {
        const expectedParams = {
            Body: '',
            Bucket: 'dataBucket',
            ContentType: 'application/json',
            Key: '2019/2/4/2019-02-04T01:02:03.000Z.log',
            Metadata: {
                f5telemetry: 'true'
            }
        };

        it('should process systemInfo data', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'systemInfo',
                config: defaultConsumerConfig
            });
            expectedParams.Body = JSON.stringify(testUtil.deepCopy(context.event.data));

            return awsS3Index(context)
                .then(() => assert.deepStrictEqual(s3PutObjectParams, expectedParams));
        });

        it('should process event data', () => {
            const context = testUtil.buildConsumerContext({
                eventType: 'AVR',
                config: defaultConsumerConfig
            });
            expectedParams.Body = JSON.stringify(testUtil.deepCopy(context.event.data));

            return awsS3Index(context)
                .then(() => assert.deepStrictEqual(s3PutObjectParams, expectedParams));
        });

        it('should log error when encountered and not reject', () => {
            const context = testUtil.buildConsumerContext(defaultConsumerConfig);
            const error = new Error('simulated error');
            AWS.S3.restore();
            sinon.stub(AWS, 'S3').returns({
                putObject: (params, cb) => {
                    s3PutObjectParams = params;
                    cb(error, '');
                }
            });
            return awsS3Index(context)
                .then(() => assert.deepStrictEqual(
                    context.logger.exception.args[0],
                    ['Error encountered while processing for AWS S3', error]
                ));
        });
    });
});
