/* eslint-disable no-process-env */
var _ = require('lodash'),
    fs = require('fs'),
    waterfall = require('async/waterfall'),
    join = require('path').join,
    async = require('async'),
    util = require('../util'),
    liquidJSON = require('liquid-json'),
    os = require('os'),

    /**
     * Name of the directory that contains Postman config files.
     *
     * @type {String}
     */
    DIR_NAME = 'postman',

    /**
     * Name of the file that contains Newman compliant configuration information.
     *
     * @type {String}
     */
    FILE_NAME = 'newmanrc',

    /**
     * Folder in the home directory that contains Postman config files.
     *
     * In *nix systems, created with read, write and enter permissions only to the owner
     * In Windows systems, since the directory is in the User directory, it cannot be read by any other user
     *
     * @type {String}
     */
    HOME_CONFIG_DIR = join(os.homedir(), '.' + DIR_NAME),

    /**
     * List of config files across the system
     *
     * In *nix systems, created with read and write permissions only to the owner
     *
     * @type {String[]}
     */
    configFiles = {
        home: join(HOME_CONFIG_DIR, FILE_NAME),
        project: join(process.cwd(), '.' + FILE_NAME)
    },

    // List of possible error messages
    DIR_CREATE_ERROR = (dir) => { return `Couldn't create the config directory at ${dir}.`; },
    INVALID_DATA_ERROR = (file) => { return `The config file at ${file} contains invalid data.`; },
    FILE_WRITE_ERROR = (file) => { return `Couldn't write into the config file at ${file}.`; };

module.exports = {
    /**
     * Configuration loader to acquire and merge settings from the requested config files.
     *
     * Data corresponding to an inexistent file is taken as an empty object
     *
     * @param {Object} [types] - Types of the config files to be read. Assumes 'home' if not provided
     * @param {Boolean} [types.home] - Specifies if the config file in the home directory has to be read
     * @param {Boolean} [types.project] - Specifies if the config file in the current directory has to be read
     * @param {Function} callback - The callback function invoked to mark the completion of the config loading routine
     * @returns {*}
     */
    load: (types, callback) => {
        (!callback && _.isFunction(types)) && (
            (callback = types),
            (types = { home: true })
        );

        var files = [];

        _.forIn(configFiles, (file, type) => {
            _.get(types, type) && file && files.push(file);
        });

        async.mapSeries(files, (path, cb) => {
            fs.readFile(path, (err, data) => {
                if (err) {
                    return cb(null, {}); // err masked to avoid overpopulating terminal with missing .newmanrc messages
                }

                data && data.toString && (data = data.toString(util.detectEncoding(data)).trim());

                try {
                    return cb(null, liquidJSON.parse(data));
                }
                catch (e) {
                    return cb(new Error(INVALID_DATA_ERROR(path)));
                }
            });
        }, (err, fileData) => {
            if (err) {
                return callback(err);
            }

            return callback(null, _.merge.apply(this, fileData));
        });
    },

    /**
     * Updates the config file with the data passed.
     *
     * If the file doesn't exist, creates one with read and write permissions only to the owner.
     *
     * @param {Object} data - The config object to be stored in the file
     * @param {String} [type='home'] - Type of the config file. Assumes 'home' by default
     * @param {Function} callback - The callback which is invoked after the write
     * @returns {*}
     */
    store: (data, type, callback) => {
        (!callback && _.isFunction(type)) && (
            (callback = type),
            (type = 'home')
        );

        let file = _.get(configFiles, type);

        waterfall([
            (next) => {
                // ensure the config directory exists if `type` is home
                return type === 'home' && !fs.existsSync(HOME_CONFIG_DIR) ?
                    fs.mkdir(HOME_CONFIG_DIR, { mode: 0o700 }, (err) => {
                        if (err) {
                            return next(new Error(DIR_CREATE_ERROR(HOME_CONFIG_DIR)));
                        }

                        return next(null);
                    }) :
                    next(null);
            },
            (next) => {
                // it also creates the file with the given permissions if it doesn't exist
                fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 }, (err) => {
                    if (err) {
                        return next(new Error(FILE_WRITE_ERROR(file)));
                    }

                    return next(null);
                });
            }
        ], (err) => {
            callback(err);
        });
    }
};
