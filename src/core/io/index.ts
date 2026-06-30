/** Public surface of the `io` module. */
export { getString, getStringOrEnv, getBool, getNumber, getMultiline, getKeyValues } from './inputs';
export { setOutput, exportEnv, fail, normalizeError } from './outputs';
export { log, mask } from './log';
