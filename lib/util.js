var fs = require('fs'),

    _ = require('lodash'),
    chardet = require('chardet'),
    filesize = require('filesize'),
    prettyms = require('pretty-ms'),
    liquidJSON = require('liquid-json'),
    request = require('postman-request'),

    util,
    version = require('../package.json').version,

    SEP = ' / ',

    /**
     * The auxiliary character used to prettify file sizes from raw byte counts.
     *
     * @type {Object}
     */
    FILESIZE_OPTIONS = { spacer: '' },

    /**
     * Maps the charset returned by chardet to node buffer ones
     *
     * @constant
     * @type {Object}
     */
    CHARDET_BUFF_MAP = {
        ASCII: 'ascii',
        'UTF-8': 'utf8',
        'UTF-16LE': 'utf16le',
        'ISO-8859-1': 'latin1'
    },

    /**
     * Map of request-method to its operation name
     *
     * @type {Object}
     */
    OPERATION_MAP = {
        GET: 'fetch',
        PUT: 'sync'
    },

    USER_AGENT_VALUE = 'Newman/' + version;

util = {

    /**
     * The raw newman version, taken from package.json in the root directory
     *
     * @type {String}
     */
    version: version,

    /**
     * The user agent that this newman identifies as.
     *
     * @type {String}
     */
    userAgent: USER_AGENT_VALUE,

    /**
     * Regular expression for all Postman-API URLs
     *
     * @type {RegExp}
     */
    // eslint-disable-next-line no-process-env
    POSTMAN_API_URL_REGEX: !process.env.NEWMAN_TEST_ENV ? /^https?:\/\/api.(get)?postman.com.*/ :
        /^https?:\/\/(localhost:\d+|api.(get)?postman.com).*/, // since localhost mocks Postman-API URLs during testing

    /**
     * Regular expression matching valid Postman ID/UID, case insensitive.
     *
     * @type {RegExp}
     */
    POSTMAN_ID_REGEX: /^([0-9A-Z]+-|)[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,

    /**
     * Sends a message to the parent process if it is listening.
     * Used for testing using child process module
     *
     * @param {String} message - The message
     * @returns {*}
     */
    signal: (message) => { process.send && process.send(message); },

    /**
     * A utility helper method that prettifies and returns raw millisecond counts.
     *
     * @param {Number} ms - The raw millisecond count, usually from response times.
     * @returns {String} - The prettified time, scaled to units of time, depending on the input value.
     */
    prettyms: function (ms) {
        if (ms < 1) {
            return `${parseInt(ms * 1000, 10)}µs`;
        }

        return (ms < 1998) ? `${parseInt(ms, 10)}ms` : prettyms(ms || 0);
    },

    /**
     * Returns the time  object with all values in largest time unit possible as strings.
     *
     * @param {Object} obj - {event1: time1, event2: time2, ...} (time in milliseconds)
     * @returns {Object} - {event1: time1, event2: time2, ...} (time in string with appropriate unit)
     */
    beautifyTime: function (obj) {
        return _.forEach(obj, (value, key) => {
            // convert only non-zero values
            value && (obj[key] = this.prettyms(value));
        });
    },

    /**
     * A utility helper method to prettify byte counts into human readable strings.
     *
     * @param {Number} bytes - The raw byte count, usually from computed response sizes.
     * @returns {String} - The prettified size, suffixed with scaled units, depending on the actual value provided.
     */
    filesize: function (bytes) {
        return filesize(bytes || 0, FILESIZE_OPTIONS);
    },

    /**
     * A utility helper method to add a set of query-params to a given URL
     *
     * @param {String} url - The URL to which the query param has to be added
     * @param {Object} queryParams - An object with keys and their respective values to be added as query-params
     * @returns {String} - The updated URL
     */
    addQueryParams: function (url, queryParams) {
        let urlObj = new URL(url);

        _.forEach(queryParams, (value, key) => {
            urlObj.searchParams.set(key, value);
        });

        return urlObj.href;
    },

    /**
     * Resolves the fully qualified name for the provided item
     *
     * @param {PostmanItem|PostmanItemGroup} item The item for which to resolve the full name
     * @param {?String} [separator=SEP] The separator symbol to join path name entries with
     * @returns {String} The full name of the provided item, including prepended parent item names
     * @private
     */
    getFullName: function (item, separator) {
        if (_.isEmpty(item) || !_.isFunction(item.parent) || !_.isFunction(item.forEachParent)) { return; }

        var chain = [];

        item.forEachParent(function (parent) { chain.unshift(parent.name || parent.id); });

        item.parent() && chain.push(item.name || item.id); // Add the current item only if it is not the collection

        return chain.join(_.isString(separator) ? separator : SEP);
    },

    /**
     * Given a buffer, it tries to match relevant encoding of the buffer.
     *
     * @param {Buffer} buff - Buffer for which encoding needs to be determined
     * @returns {String|undefined} - Detected encoding of the given buffer
     */
    detectEncoding: function (buff) {
        return CHARDET_BUFF_MAP[chardet.detect(buff)];
    },

    /**
     * Performs an API request with specified request-options and parses the response-body to JSON
     *
     * When the response status code is not of the form 2xx, gets suitable error from the response-body
     *
     * @param {Object} requestOptions - The options pertaining to the request to be passed to the `request` function
     * @param {String} [type] - The type of resource to be fetched/updated/deleted with the API request,
     * for eg: 'collection', 'environment'
     * @param {Function} callback - The function to be invoked after the process
     *
     * @returns {*}
     */
    apiRequest: function (requestOptions, type, callback) {
        if (!callback && _.isFunction(type)) {
            callback = type;
            type = 'resource';
        }

        let { url, method } = requestOptions,
            operation = OPERATION_MAP[method];

        return request(requestOptions, (err, response, body) => {
            if (err) {
                return callback(_.set(err, 'help', `unable to ${operation} data from url "${url}"`));
            }

            try {
                _.isString(body) && (body = liquidJSON.parse(body.trim()));
            }
            catch (e) {
                return callback(_.set(e, 'help', `the url "${url}" did not provide valid JSON data`));
            }

            // if the status code is not in 200s, get the error from the body
            if (!(/2../).test(response.statusCode)) {
                var error;

                error = new Error(_.get(body, 'error.message', `Error during ${type}-${operation}, ` +
                    `the provided URL returned status code: ${response.statusCode}`));

                return callback(_.assign(error, {
                    name: _.get(body, 'error.name', _.capitalize(type) + _.capitalize(operation) + 'Error'),
                    help: `Error during ${type}-${operation}. Ensure that the URL is valid.`
                }));
            }

            return callback(null, body);
        });
    },

    /**
     * Loads JSON data from the given location.
     *
     * @param {String} location - Can be an HTTP URL or a local file path.
     * @param {String} [type] - The type of data to load, eg: 'collection', 'environment'
     * @param {Function} callback - The function whose invocation marks the end of the JSON fetch routine.
     * @returns {*}
     */

    fetchJson: function (location, type, callback) {
        if (!callback && _.isFunction(type)) {
            callback = type;
            type = 'resource';
        }
        console.log(location, type);

        return (/^https?:\/\/.*/).test(location) ?
            // Load from URL
            util.apiRequest({
                url: location,
                json: true,
                // Temporary fix to fetch the collection from https URL on Node v12
                // @todo find the root cause in postman-request
                // Refer: https://github.com/postmanlabs/newman/issues/1991
                agentOptions: {
                    keepAlive: true
                }
            }, type, callback) :
            fs.readFile(location, function (err, value) {
                if (err) {
                    return callback(_.set(err, 'help', `unable to read data from file "${location}"`));
                }

                try {
                    value = liquidJSON.parse(value.toString(util.detectEncoding(value)).trim());
                }
                catch (e) {
                    return callback(_.set(e, 'help', `the file at "${location}" does not contain valid JSON data`));
                }

                return callback(null, value);
            });
    },

    /**
     * Loads raw data from a location, useful for working with non JSON data such as CSV files.
     *
     * @param {String} location - The relative path / URL to the raw data file.
     * @param {Object=} options - A set of load options for the raw data file.
     * @param {Function} callback - The callback function whose invocation marks the end of the fetch routine.
     * @returns {*}
     */
    fetch: function (location, options, callback) {
        !callback && _.isFunction(options) && (callback = options, options = {});

        return (/^https?:\/\/.*/).test(location) ?
            // Load from URL
            request.get({ url: location }, (err, response, body) => {
                if (err) {
                    return callback(err);
                }

                return callback(null, body);
            }) :
            fs.readFile(String(location), function (err, value) {
                if (err) {
                    return callback(err);
                }

                return callback(null, value.toString(util.detectEncoding(value)));
            });
    },

    /**
     * Checks whether the given object is a v1 collection
     *
     * Reference: https://github.com/postmanlabs/postman-collection-transformer/blob/v2.6.2/lib/index.js#L44
     *
     * @param {Object} object - The Object to check for v1 collection compliance.
     * @returns {Boolean} - A boolean result indicating whether or not the passed object was a v1 collection.
     */
    isV1Collection: function (object) {
        return Boolean(object && object.name && object.order && object.requests);
    },

    /**
     * Helper function to test if a given string is an integer.
     * Reference: [node-csv-parse]: https://github.com/adaltas/node-csv-parse/blob/v2.5.0/lib/index.js#L207
     *
     * @param {String} value - The string to test for.
     * @returns {Boolean}
     */
    isInt: function (value) {
        return (/^(-|\+)?([1-9]+[0-9]*)$/).test(value);
    },

    /**
     * Helper function to test if a given string is a float.
     * Reference: [node-csv-parse]: https://github.com/adaltas/node-csv-parse/blob/v2.5.0/lib/index.js#L210
     *
     * @param {String} value - The string to test for.
     * @returns {Boolean}
     */
    isFloat: function (value) {
        return (value - parseFloat(value) + 1) >= 0;
    }
};

module.exports = util;
