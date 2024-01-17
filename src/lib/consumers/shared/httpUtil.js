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

const util = require('../../utils/misc');
const requestsUtil = require('../../utils/requests');

/**
 * Process request headers
 *
 * @param {Array<Object>} headers - headers
 *
 * @returns {Object} headers
 */
function processHeaders(headers) {
    // assume headers is an array that looks like this:
    // [ { name: 'foo', value: 'foo' }]
    const ret = {};
    if (Array.isArray(headers)) {
        headers.forEach((i) => {
            ret[i.name] = i.value;
        });
    }
    return ret;
}

function getProxy(proxyOpts) {
    return {
        host: proxyOpts.host,
        port: proxyOpts.port,
        protocol: proxyOpts.protocol || 'https',
        username: proxyOpts.username,
        passphrase: proxyOpts.passphrase
    };
}

/**
 * Send data to Consumer(s)
 *
 * Note:
 * - see requestsUtil.makeRequest for available options
 * - all options will be passed through directly to requestsUtil.makeRequest except options below
 * - request will be sent to the next host if response code is >= 500 or another error occurs
 *
 * @param {Object} config               - config
 * @param {Array<String>} config.hosts  - list of hosts
 * @param {Logger} config.logger        - logger
 * @param {Object} [config.proxy]       - proxy settings
 * @param {String} [config.uri]         - URI
 *
 * @returns {Promise<Array<Any, Object>} resolves with array of
 *  2 items - response data and response object
 */
function sendToConsumer(config) {
    const hostIdx = config.hostIdx || 0;
    const host = config.hosts[hostIdx];
    const requestOptions = Object.assign({
        continueOnErrorCode: true
    }, config);
    ['hosts', 'hostIdx', 'logger', 'proxy', 'uri'].forEach((prop) => {
        delete requestOptions[prop];
    });
    if (!util.isObjectEmpty(config.proxy)) {
        requestOptions.proxy = getProxy(config.proxy);
    }
    requestOptions.includeResponseObject = true;

    let response;
    let requestError;

    return requestsUtil.makeRequest(host, config.uri, requestOptions)
        .then((ret) => {
            response = ret;
            config.logger.verbose(`request to '${host}${config.uri}' returned HTTP ${response[1].statusCode}`);
            if (response[1].statusCode >= 500) {
                requestError = new Error(`Bad status code: ${response[1].statusCode} ${response[1].statusMessage} for '${host}'`);
            }
        })
        .catch((err) => {
            config.logger.exception(`Error caught on attempt to send request to '${host}${config.uri}'`, err);
            requestError = err;
        })
        .then(() => {
            if (!requestError) {
                config.logger.verbose(`response: ${response[1].statusCode} ${response[1].statusMessage}`);
                if (response[0]) {
                    config.logger.verbose(`response body: ${typeof response[0] === 'object' ? JSON.stringify(response[0]) : response[0]}`);
                }
                return Promise.resolve(response);
            }
            const nextHostIdx = hostIdx + 1;
            if (nextHostIdx < config.hosts.length) {
                // fallback to next host
                config.logger.verbose(`Trying next host - ${config.hosts[nextHostIdx]}`);
                config.hostIdx = nextHostIdx;
                return sendToConsumer(config);
            }
            return Promise.reject(requestError);
        });
}

module.exports = {
    sendToConsumer,
    processHeaders
};
