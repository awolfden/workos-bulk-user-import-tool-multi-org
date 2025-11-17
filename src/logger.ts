type LoggerOptions = {
  quiet?: boolean;
};

export function createLogger(options: LoggerOptions) {
  const quiet = Boolean(options.quiet);
  const log = (...args: unknown[]) => {
    if (!quiet) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  };
  const warn = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn(...args);
  };
  const error = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error(...args);
  };
  const stepStart = (recordNumber: number) => {
    log(`▶ Processing record #${recordNumber}`);
  };
  const stepSuccess = (recordNumber: number) => {
    log(`✔ Imported record #${recordNumber}`);
  };
  const stepFailure = (recordNumber: number) => {
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

