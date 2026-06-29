/** Public surface of the `endpoints` module. */
export {
  deployEndpoint,
  getEndpoint,
  getEndpointByName,
  deleteEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  buildEndpointSpec,
  buildEndpointMetadata,
  mapSdkEndpoint,
  type EndpointSpec,
  type Endpoint,
  type EndpointServiceLike,
  type OperationLike,
} from './endpoints';
