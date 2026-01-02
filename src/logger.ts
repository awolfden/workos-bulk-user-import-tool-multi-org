import chalk from 'chalk';

type LoggerOptions = {
  quiet?: boolean;
};

export function createLogger(options: LoggerOptions) {
  const quiet = Boolean(options.quiet);
  const useColors = process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI;

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
    const message = `Imported record #${recordNumber}`;
    log(useColors ? chalk.green(`✔ ${message}`) : `✔ ${message}`);
  };
  const stepFailure = (recordNumber: number) => {
    const message = `Failed record #${recordNumber} (see summary / errors file)`;
    log(useColors ? chalk.red(`✖ ${message}`) : `✖ ${message}`);
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

