export function createLogger(options) {
    const quiet = Boolean(options.quiet);
    const log = (...args) => {
        if (!quiet) {
            // eslint-disable-next-line no-console
            console.log(...args);
        }
    };
    const warn = (...args) => {
        // eslint-disable-next-line no-console
        console.warn(...args);
    };
    const error = (...args) => {
        // eslint-disable-next-line no-console
        console.error(...args);
    };
    const stepStart = (recordNumber) => {
        log(`▶ Processing record #${recordNumber}`);
    };
    const stepSuccess = (recordNumber) => {
        log(`✔ Imported record #${recordNumber}`);
    };
    const stepFailure = (recordNumber) => {
        log(`✖ Failed record #${recordNumber} (see summary / errors file)`);
    };
    return {
        log,
        warn,
        error,
        stepStart,
        stepSuccess,
        stepFailure
    };
}
