var sdk = require('postman-collection'),
    nock = require('nock'),
    sinon = require('sinon'),
    liquidJSON = require('liquid-json'),

    util = require('../../lib/util'),

    POSTMAN_API_URL = 'https://api.getpostman.com',

    SAMPLE_ENVIRONMENT_UID = '1234-931c1484-fd1e-4ceb-81d0-2aa102ca8b5f',
    SAMPLE_ENVIRONMENT_ID = '931c1484-fd1e-4ceb-81d0-2aa102ca8b5f',

    SAMPLE_ENVIRONMENT = {
        id: 'E1',
        name: 'Environment',
        values: [{
            key: 'foo',
            value: 'bar'
        }]
    };

describe('utility helpers', function () {
    describe('getFullName', function () {
        var collection = new sdk.Collection({
                variables: [],
                info: {
                    name: 'multi-level-folders',
                    _postman_id: 'e5f2e9cf-173b-c60a-7336-ac804a87d762',
                    description: 'A simple V2 collection to test out multi level folder flows',
                    schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'
                },
                item: [{
                    name: 'F1',
                    item: [{ name: 'F1.R1' }, { name: 'F1.R2' }, { name: 'F1.R3' }]
                }, {
                    name: 'F2',
                    item: [{
                        name: 'F2.F3',
                        item: [{ name: 'F2.F3.R1' }]
                    },
                    { name: 'F4', item: [] },
                    { name: 'F2.R1' }]
                }, { name: 'R1' }]
            }),
            fullNames = {
                'F1.R1': 'F1 / F1.R1',
                'F1.R2': 'F1 / F1.R2',
                'F1.R3': 'F1 / F1.R3',
                'F2.F3.R1': 'F2 / F2.F3 / F2.F3.R1',
                'F2.R1': 'F2 / F2.R1',
                R1: 'R1',
                F1: 'F1',
                'F2.F3': 'F2 / F2.F3',
                F4: 'F2 / F4',
                F2: 'F2'
            };

        it('should handle empty input correctly', function () {
            expect(util.getFullName(), 'should handle empty input correctly').to.not.be.ok;
            expect(util.getFullName(false), 'should handle `false` input correctly').to.not.be.ok;
            expect(util.getFullName(0), 'should handle `0` input correctly').to.not.be.ok;
            expect(util.getFullName(''), 'should handle `\'\'` input correctly').to.not.be.ok;
            expect(util.getFullName([]), 'should handle `[]` input correctly').to.not.be.ok;
            expect(util.getFullName({}), 'should handle `{}` input correctly').to.not.be.ok;
        });

        it('should handle items correctly', function () {
            collection.forEachItem(function (item) {
                expect(util.getFullName(item)).to.equal(fullNames[item.name]);
            });
        });

        it('should handle item groups correctly', function () {
            collection.forEachItemGroup(function (itemGroup) {
                expect(util.getFullName(itemGroup)).to.equal(fullNames[itemGroup.name]);
            });
        });
    });

    describe('beautifyTime', function () {
        var timings = {
                wait: 1.4010989999997037,
                dns: 0.20460100000036618,
                tcp: 43.05270100000007,
                firstByte: 225.52159900000015,
                download: 7.652700000000095,
                total: 277.628099
            },
            beautifiedTimings = {
                wait: '1ms',
                dns: '204µs',
                tcp: '43ms',
                firstByte: '225ms',
                download: '7ms',
                total: '277ms'
            };

        it('should correctly beautify given timeings object', function () {
            expect(util.beautifyTime(timings)).to.eql(beautifiedTimings);
        });
    });

    describe('syncJson', function () {
        let responseCode,
            response,
            spy;

        before(function () {
            nock('https://api.getpostman.com')
                .persist()
                .put(/^\/environments/)
                .query(true)
                .reply(() => {
                    return [responseCode, response];
                });
        });

        after(function () {
            nock.restore();
        });

        beforeEach(function () {
            // spy the `postman-request` module
            spy = sinon.spy(require.cache[require.resolve('postman-request')], 'exports');

            // reload the util module to use the spied postman-request module
            delete require.cache[require.resolve('../../lib/util')];
            util = require('../../lib/util');
        });

        afterEach(function () {
            spy.restore();
        });

        it('should work with an URL with apikey query param', function (done) {
            let location = `https://api.getpostman.com/environments/${SAMPLE_ENVIRONMENT_UID}?apikey=123456`;

            responseCode = 200;
            response = SAMPLE_ENVIRONMENT;

            util.syncJson(location, SAMPLE_ENVIRONMENT, { type: 'environment' }, (err) => {
                expect(err).to.be.null;

                sinon.assert.calledOnce(spy);

                let requestArg = spy.firstCall.args[0],
                    body;

                expect(requestArg).to.be.an('object').and.include.keys(['method', 'url', 'headers', 'body']);
                expect(requestArg.method).to.equal('PUT');
                expect(requestArg.url).to.equal(location);
                expect(requestArg.headers).to.be.an('object')
                    .that.has.property('Content-Type', 'application/json');

                body = liquidJSON.parse(requestArg.body.trim());
                expect(body).to.eql({ environment: SAMPLE_ENVIRONMENT });

                done();
            });
        });

        it('should work with environment-ID along with postman-api-key', function (done) {
            responseCode = 200;
            response = SAMPLE_ENVIRONMENT;

            util.syncJson(SAMPLE_ENVIRONMENT_ID, SAMPLE_ENVIRONMENT,
                { type: 'environment', postmanApiKey: 1234 }, (err) => {
                    expect(err).to.be.null;

                    sinon.assert.calledOnce(spy);

                    let requestArg = spy.firstCall.args[0],
                        body;

                    expect(requestArg).to.be.an('object').and.include.keys(['method', 'url', 'headers', 'body']);
                    expect(requestArg.method).to.equal('PUT');
                    expect(requestArg.url).to.equal(`${POSTMAN_API_URL}/environments/${SAMPLE_ENVIRONMENT_ID}`);

                    expect(requestArg.headers).to.be.an('object').and.include.keys(['Content-Type', 'X-Api-Key']);
                    expect(requestArg.headers['Content-Type']).to.equal('application/json');
                    expect(requestArg.headers['X-Api-Key']).to.equal(1234);

                    body = liquidJSON.parse(requestArg.body.trim());
                    expect(body).to.eql({ environment: SAMPLE_ENVIRONMENT });

                    done();
                });
        });

        it('should pass an error if the api-key is not available', function (done) {
            responseCode = 200;
            response = SAMPLE_ENVIRONMENT;

            util.syncJson(SAMPLE_ENVIRONMENT_UID, SAMPLE_ENVIRONMENT, { type: 'environment' }, (err) => {
                expect(err).to.be.ok.that.match(/authorization data not found/);
                sinon.assert.notCalled(spy);

                done();
            });
        });

        it('should pass an error for invalid location', function (done) {
            responseCode = 200;
            response = SAMPLE_ENVIRONMENT;

            util.syncJson('1234', SAMPLE_ENVIRONMENT, { type: 'environment', postmanApiKey: 1234 }, (err) => {
                expect(err).to.be.ok.that.match(/sync location not found/);
                sinon.assert.notCalled(spy);

                done();
            });
        });

        it('should pass the error from response-body if the response code is not of the form 2xx', function (done) {
            responseCode = 401;
            response = {
                error: {
                    message: 'Invalid API Key. Every request requires a valid API Key to be sent.'
                }
            };

            util.syncJson(SAMPLE_ENVIRONMENT_UID, SAMPLE_ENVIRONMENT, { type: 'environment', postmanApiKey: 1234 },
                (err) => {
                    expect(err).not.to.be.null;
                    expect(err.message).to.contain(response.error.message);
                    sinon.assert.calledOnce(spy);

                    let requestArg = spy.firstCall.args[0],
                        body;

                    expect(requestArg).to.be.an('object').and.include.keys(['method', 'url', 'headers', 'body']);
                    expect(requestArg.method).to.equal('PUT');
                    expect(requestArg.url).to.equal(`${POSTMAN_API_URL}/environments/${SAMPLE_ENVIRONMENT_UID}`);

                    expect(requestArg.headers).to.be.an('object').and.include.keys(['Content-Type', 'X-Api-Key']);
                    expect(requestArg.headers['Content-Type']).to.equal('application/json');
                    expect(requestArg.headers['X-Api-Key']).to.equal(1234);

                    body = liquidJSON.parse(requestArg.body.trim());
                    expect(body).to.eql({ environment: SAMPLE_ENVIRONMENT });

                    done();
                });
        });
    });
});
