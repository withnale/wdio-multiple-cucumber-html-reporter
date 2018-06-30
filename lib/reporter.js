import events from 'events'
import {generateJson} from './generateJson';
import {generate} from 'multiple-cucumber-html-reporter';

const suites = {};
const debug = false;
const FEATURE = 'Feature';
const SCENARIO = 'Scenario';
const NOT_KNOWN = 'not known';
let instanceData = {};

class MultipleCucumberHtmlReporter extends events.EventEmitter {
    constructor(baseReporter, config, options = {}) {
        super();

        this.baseReporter = baseReporter;
        this.config = config;
        this.isMultiremote = false;
        this.options = options;

        const {epilogue} = this.baseReporter;

        this.on('hook:start', ::this.hookStart);
        this.on('hook:end', ::this.hookEnd);
        // Test framework events
        this.on('suite:start', ::this.suiteStart);
        this.on('suite:end', ::this.suiteEnd);
        this.on('test:start', ::this.testStart);
        this.on('test:pass', ::this.testPass);
        this.on('test:fail', ::this.testFail);
        this.on('test:pending', ::this.testPending);

        // Runner events (webdriver)
        // this.on('start', ::this.start);
        this.on('runner:command', ::this.runnerCommand);
        this.on('runner:result', ::this.runnerResult);
        this.on('end', ::this.onEnd);

        // this.on('end', () => {
        //     console.log('this.baseReporter = ', this.baseReporter.stats.runners['0-0'].capabilities)
        // })
    }

    hookStart(payload) {
        if (debug) {
            console.log('hook:start');
            console.log('payload = ', payload);
            console.log('\n');
        }
    }

    hookEnd(payload) {
        if (debug) {
            console.log('hook:end');
            console.log('payload = ', payload);
            console.log('\n');
        }
    }

    suiteStart(suite) {
        if (debug) {
            console.log('suite:start');
            console.log('suite = ', suite);
            console.log('\n');
        }

        const cid = suite.cid;
        if (!suites[cid]) {
            suites[cid] = feature(suite);
        }
    }

    suiteEnd(suite) {
        if (debug) {
            console.log('suite:end');
            console.log('suite = ', suite);
            console.log('\n');
        }

        // Attach an Afterhook if there are embeddings
        attachAfterHook(suite);
    }

    testStart(test) {
        if (debug) {
            console.log('test:start');
            console.log('test = ', test);
            console.log('\n');
        }

        if (!suites[test.cid]._elements[test.parent]) {
            suites[test.cid]._elements[test.parent] = scenario(test);
        }
    }

    testPass(test) {
        if (debug) {
            console.log('test:pass');
            console.log('test = ', test);
            console.log('\n');
        }

        suites[test.cid]._elements[test.parent].steps.push(steps(test, 'passed'));
    }

    testFail(test) {
        if (debug) {
            console.log('test:fail');
            console.log('test = ', test);
            console.log('\n');
        }

        suites[test.cid]._elements[test.parent].steps.push(steps(test, 'failed'));
    }

    testPending(test) {
        if (debug) {
            console.log('test:pending');
            console.log('test = ', test);
            console.log('\n');
        }
        suites[test.cid]._elements[test.parent].steps.push(steps(test, 'pending'));
    }

    // Runner
    runnerCommand(command) {
        if (debug) {
            console.log('runner:command');
            console.log('command.data = ', command.data);
            console.log('\n');
        }
    }

    runnerResult(result) {       // This runner is also for the screenshots, need to figure this one out
        if (debug) {
            console.log('runner:result');
            console.log('command = ', result);
            console.log('\n');
        }
        // Save browserdata so it can be used later
        const cid = result.cid;
        if (!instanceData[cid]) {
            instanceData[cid] = determineMetadata(result);
        }

        // attach the screenshot to the report
        attachScreenshot(result);
    }

    onEnd(payload) {
        if (debug) {
            console.log('end');
            console.log('payload = ', payload);
            console.log('\n');
        }

        // console.log('suites = ', suites);
        // console.log('_elements = ', suites['0-0']._elements);
        // console.log('steps = ', suites['0-0']._elements['Open website5'].steps);

        // Generate the jsons
        generateJson(suites);

        // generate the report
        generate({
            jsonDir: './.tmp/new/',
            reportPath: './.tmp/multiple-cucumber-html-reporter/',
            saveCollectedJSON: true
        });

        // epilogue.call(baseReporter)
    }
}

MultipleCucumberHtmlReporter.reporterName = 'multiple-cucumber-html-reporter';
export default MultipleCucumberHtmlReporter;

/**
 * All functions
 */


function feature(feature) {
    return {
        keyword: FEATURE,
        line: parseInt(feature.uid.substring(feature.title.length, feature.uid.length)),
        name: feature.title,
        tags: feature.tags,
        uri: feature.specs[0],
        _elements: {},  // Temporary. All data will be copied to the `elements` when done
        elements: [],
        id: feature.title.replace(/ /g, '-').toLowerCase(),
        _screenshots: [], // Temporary, screenshots will be added here and removed per step...
        ...instanceData[feature.cid],
    }
}

function scenario(scenario) {
    return {
        keyword: SCENARIO,
        line: parseInt(scenario.parent.substring(scenario.scenarioName.length, scenario.parent.length)),
        name: scenario.scenarioName,
        tags: scenario.tags,
        id: `${suites[scenario.cid].id};${scenario.scenarioName.replace(/ /g, '-').toLowerCase()}`,
        steps: []
    }
}

function steps(testObject, status) {
    const stepResult = {
            arguments: [],
            keyword: ' ',
            name: testObject.title,
            result: {
                status: status,
                duration: testObject.duration,
                ...failedMessage(testObject, status)
            },
            line: parseInt(testObject.uid.substring(testObject.title.length, testObject.uid.length)),
            // Add the screenshot embeddings if there are screenshots
            ...addEmbeddings(testObject.cid),
            match: {
                location: 'can not be determined with webdriver.io'
            }
        }
    ;

    // Empty the _screenshots because there is no data anymore, test has finished
    suites[testObject.cid]._screenshots = [];

    return stepResult;
}

function failedMessage(testObject, status) {
    if (status === 'failed') {
        return {
            error_message: testObject.err.stack
        }
    }

    return {}
}

/**
 * Determine the metadata that needs to be added
 *
 * @TODO: Need to look at the implementation, is not that nice
 *
 * @param {object} data instance data
 *
 * @returns {
 *  {
 *      metadata: {
 *          browser: {
 *              name: string,
 *              version: string
 *          },
 *          device: string,
 *          platform: {
 *              name: string,
 *              version: string
 *          }
 *      }
 *  }
 * }
 */
function determineMetadata(data) {
    const metadata = data.requestData.desiredCapabilities.metadata;
    const currentBrowserName = data.body.value.browserName;
    const currentBrowserVersion = data.body.value.version || data.body.value.browserVersion;
    const browser = {
        name: metadata && metadata.browser && metadata.browser.name ? metadata.browser.name : currentBrowserName,
        version: metadata && metadata.browser && metadata.browser.version ? metadata.browser.version : currentBrowserVersion,
    };
    const device = metadata && metadata.device  ? metadata.device : NOT_KNOWN;
    const platform = {
        name: metadata && metadata.platform && metadata.platform.name ? metadata.platform.name : NOT_KNOWN,
        version: metadata && metadata.platform && metadata.platform.version ? metadata.platform.version : NOT_KNOWN
    };

    return {
        metadata: {
            browser,
            device,
            platform,
        }
    }
}

function attachScreenshot(data) {
    if (data.requestOptions.uri.path.match(/\/session\/[^/]*\/screenshot/) && data.body.value) {
        suites[data.cid]._screenshots.push({
            data: data.body.value,
            mime_type: 'image/png',
        });
    }
}

function attachAfterHook(suite) {
    if (suites[suite.cid]._screenshots.length > 0) {
        // Add an After hook if there are screenshots. Defaulted most of the values because they are not available
        // in webdriverio
        suites[suite.cid]._elements[suite.uid].steps.push({
            arguments: [],
            keyword: 'After',
            result: {
                status: 'passed',
                duration: 0
            },
            hidden: true,
            // Add the screenshot embeddings if there are screenshots
            ...addEmbeddings(suite.cid),
            match: {
                location: 'can not be determined with webdriver.io'
            }
        });
    }

    // Empty the _screenshots because there is no data anymore, test has finished
    suites[suite.cid]._screenshots = [];
}

function addEmbeddings(cid) {
    return {
        // Add the screenshot embeddings if there are screenshots
        ...(suites[cid]._screenshots.length > 0
                ? {embeddings: [...suites[cid]._screenshots]}
                : {}
        ),
    };
}