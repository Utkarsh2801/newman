var fs = require('fs'),
    url = require('url'),

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

    POSTMAN_API_HOST = 'api.getpostman.com',

    POSTMAN_API_URL = 'https://' + POSTMAN_API_HOST,

    /**
     * Map of resource type and its equivalent API pathname.
     *
     * @type {Object}
     */
    POSTMAN_API_PATH_MAP = {
        collection: 'collections',
        environment: 'environments'
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

    API_KEY_HEADER = 'X-Api-Key',

    USER_AGENT_VALUE = 'Newman/' + version,

    // Matches valid Postman UID, case insensitive.
    // Same used for validation on the Postman API side.
    UID_REGEX = /^[0-9A-Z]+-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,

    // localhost mocks the postman-api url during CLI tests
    // eslint-disable-next-line no-process-env
    POSTMAN_API_URL_REGEX = !process.env.NEWMAN_TEST_ENV ? /^https?:\/\/api.(get)?postman.com.*/ :
        /^https?:\/\/(localhost:\d+|api.(get.)?postman.com).*/,

    AUTHORIZATION_DATA_NOT_FOUND = 'authorization data not found',

    SYNC_LOCATION_NOT_FOUND = 'sync location not found';

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
     * Gets JSON data by performing an API request with the specified request-options
     *
     * When the response status code is not of the form 2xx, passes suitable error from the response-body
     *
     * @param {Object} requestOptions - The options pertaining to the request to be passed to the `request` function
     * @param {Function} callback - The function to be invoked after the process
     *
     * @returns {*}
     */
    requestJson: function (requestOptions, callback) {
        let { url: location, method } = requestOptions,
            operation = OPERATION_MAP[method];

        return request(requestOptions, (err, response, body) => {
            if (err) {
                return callback(_.set(err, 'help', `unable to ${operation} data from url "${location}"`));
            }

            try {
                _.isString(body) && (body = liquidJSON.parse(body.trim()));
            }
            catch (e) {
                return callback(_.set(e, 'help', `the url "${location}" did not provide valid JSON data`));
            }

            var error,
                urlObj,
                resource = 'resource';

            if (response.statusCode !== 200) {
                urlObj = url.parse(location);

                (urlObj.hostname === POSTMAN_API_HOST) &&
                    (resource = _(urlObj.path).split('/').get(1).slice(0, -1) || resource);

                error = new Error(_.get(body, 'error.message', `Error during ${resource}-${operation}, ` +
                    `the provided URL returned status code: ${response.statusCode}`));

                return callback(_.assign(error, {
                    name: _.get(body, 'error.name', _.capitalize(resource) + _.capitalize(operation) + 'Error'),
                    help: `Error during ${resource}-${operation}. Ensure that the URL is valid.`
                }));
            }

            return callback(null, body);
        });
    },

    /**
     * Loads JSON data from the given location.
     *
     * @param {String} type - The type of data to load.
     * @param {String} location - Can be an HTTP URL, a local file path or an UID.
     * @param {Object=} options - A set of options for JSON data loading.
     * @param {Object} options.postmanApiKey - API Key used to load the resources via UID from the Postman API.
     * @param {Function} callback - The function whose invocation marks the end of the JSON fetch routine.
     * @returns {*}
     */

    fetchJson: function (type, location, options, callback) {
        !callback && _.isFunction(options) && (callback = options, options = {});

        var postmanApiKey = _.get(options, 'postmanApiKey'),
            headers = { 'User-Agent': USER_AGENT_VALUE };

        // build API URL if `location` is a valid UID and api key is provided.
        // Fetch from file in case a file with valid UID name is present.
        if (!fs.existsSync(location) && POSTMAN_API_PATH_MAP[type] && postmanApiKey && UID_REGEX.test(location)) {
            location = `${POSTMAN_API_URL}/${POSTMAN_API_PATH_MAP[type]}/${location}`;
            headers[API_KEY_HEADER] = postmanApiKey;
        }

        return (/^https?:\/\/.*/).test(location) ?
            // Load from URL
            util.requestJson({
                method: 'GET',
                url: location,
                json: true,
                headers: headers,
                // Temporary fix to fetch the collection from https URL on Node v12
                // @todo find the root cause in postman-request
                // Refer: https://github.com/postmanlabs/newman/issues/1991
                agentOptions: {
                    keepAlive: true
                }
            }, callback) :
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
     * Updates the JSON data in the cloud by sending a PUT request to the required API endpoint
     *
     * @param {String|undefined} location - Can be a URL, Postman-ID or Postman-UID of the resource needed to be updated
     * @param {Object} data - The updated data to be sent to the API
     * @param {Object} options - A set of options related to the sync
     * @param {String} [options.postmanApiKey] - The postmanApiKey for authorizing the request
     * @param {String} [options.type] - The type of data to sync, for eg: collection, environment etc
     * @param {Function} callback - The function to be invoked after the process
     */
    syncJson: function (location, data, options, callback) {
        let { postmanApiKey, type } = options,
            headers = { 'User-Agent': USER_AGENT_VALUE,
                'Content-Type': 'application/json' };

        // format the location to get Postman-API URL if it is Postman-ID or Postman-UID
        if (POSTMAN_API_PATH_MAP[type] && UID_REGEX.test(location)) {
            location = `${POSTMAN_API_URL}/${POSTMAN_API_PATH_MAP[type]}/${location}`;
        }

        if (!(/^https?:\/\/.*/).test(location)) {
            return callback(new Error(SYNC_LOCATION_NOT_FOUND));
        }

        // use the postmanApiKey only for locations not having a query param for apikey
        if (POSTMAN_API_URL_REGEX.test(location) && !(/.apikey=./).test(location)) {
            if (!postmanApiKey) {
                return callback(new Error(AUTHORIZATION_DATA_NOT_FOUND));
            }

            headers[API_KEY_HEADER] = postmanApiKey;
        }

        type && (data = _.set({}, type, data)); // format the data to indicate the field

        return util.requestJson({
            method: 'PUT',
            url: location,
            headers: headers,
            body: JSON.stringify(data)
        }, callback);
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
