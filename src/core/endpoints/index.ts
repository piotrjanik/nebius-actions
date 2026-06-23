/** Public surface of the `endpoints` module. */
export {
  deployEndpoint,
  getEndpoint,
  deleteEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  buildDeployEndpointArgs,
  mapEndpointJson,
  type EndpointSpec,
  type Endpoint,
} from './endpoints';
