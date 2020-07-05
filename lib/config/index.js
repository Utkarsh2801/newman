var _ = require('lodash'),
    async = require('async'),

    env = require('./process-env'),
    rcfile = require('./rc-file');

/**
 * Reads configuration from config file, environment variables and CLI arguments. The CLI arguments override environment
 * variables and environment variables override the configuration read from a file.
 *
 * @param {Object} overrides - Configuration overrides (these usually come from the CLI).
 * @param {Object} options - The wrapper object of settings used for selective configuration loading.
 * @param {String} options.command - Command name. Used for loading the required options from the config file.
 * @param {Boolean=} options.ignoreRcFile - If true, the RC file is ignored.
 * @param {Boolean=} options.ignoreProcessEnvironment - If true, the process environment variables are ignored.
 * @param {Object=} options.loaders - Custom loaders for specific configuration options.
 * @param {Function} callback - Is called after merging values from the overrides with the values from the rc file and
 * environment variables.
 * @returns {*}
 */
module.exports.get = (overrides, options, callback) => {
    !callback && _.isFunction(options) && (callback = options, options = {});

    var { loaders, command } = options;

    async.parallel([
        // Load RC Files.
        (cb) => {
            if (options.ignoreRcFile) {
                return cb(null, {});
            }

            return rcfile.load(['home', 'cwd'], cb);
        },
        // Load Process Environment overrides
        !options.ignoreProcessEnvironment ? env.load : (cb) => {
            return cb(null, {});
        }
    ], (err, options) => {
        if (err) {
            return callback(err);
        }

        // get options specific to the command
        options = _.map(options, (obj) => {
            return obj && obj[command] ? obj[command] : {};
        });

        options = _.mergeWith({}, ...options, overrides, (dest, src) => {
            // If the newer value is a null, do not override it.
            return (src === null) ? dest : undefined;
        });

        if (_.isEmpty(loaders)) {
            return callback(null, options);
        }
        // sanitize environment option
        if (!options.environment) {
            options.environment = {};
        }
        // sanitize globals option
        if (!options.globals) {
            options.globals = {};
        }

        let commonOptions = _.pick(options, ['postmanApiKey']);

        async.mapValues(options, (value, name, cb) => {
            return (value && _.isFunction(loaders[name])) ? loaders[name](value, commonOptions, cb) : cb(null, value);
        }, callback);
    });
};
